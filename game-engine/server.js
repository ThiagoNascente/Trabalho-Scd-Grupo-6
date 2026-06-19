// ==========================================================================
// GAME ENGINE — processo independente que roda a FÍSICA de UM jogo.
// A mesma imagem serve os 3 jogos; GAME (jogo1|jogo2|jogo3) escolhe o módulo.
// Particionamento Funcional: derrubar um engine não afeta os demais.
//
// Transportes:
//  - Socket.io (via Gateway-relay): lobby, controle e FALLBACK do hot path.
//  - WebRTC DataChannel (geckos.io): hot path direto cliente↔engine (inputs +
//    estado por tick), de baixa latência (UDP). O cliente abre o DataChannel
//    direto neste engine; o id do jogador no gateway viaja como playerId.
// ==========================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const GAME = process.env.GAME;
if (!['jogo1', 'jogo2', 'jogo3'].includes(GAME)) {
  console.error("[FATAL] Defina GAME=jogo1|jogo2|jogo3 na variável de ambiente.");
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("[FATAL] JWT_SECRET não definido. Configure a variável de ambiente (veja .env.example).");
  process.exit(1);
}
const AUTH_API_URL = process.env.AUTH_API_URL || "http://localhost:5000/api/auth";
const DEFAULT_PORTS = { jogo1: 4001, jogo2: 4002, jogo3: 4003 };
const PORT = process.env.PORT || DEFAULT_PORTS[GAME];
// Porta de SINALIZAÇÃO do WebRTC (geckos). Por padrão = PORT + 1000.
const GECKOS_PORT = parseInt(process.env.GECKOS_PORT || (parseInt(PORT, 10) + 1000), 10);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// O engine também valida o JWT (o gateway repassa o token do cliente).
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error: No token provided"));
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error("Authentication error: Invalid token"));
    socket.user = decoded;
    next();
  });
});

// ==========================================================================
// Transporte de estado por tick: DataChannel (WebRTC) se o jogador tiver canal
// aberto; senão, Socket.io (fallback). channels: playerId -> canal geckos.
// ==========================================================================
const channels = {};
function emitState(participantIds, event, payload) {
  for (const pid of participantIds) {
    const ch = channels[pid];
    if (ch) { try { ch.emit(event, payload); continue; } catch (_) { /* cai para socket.io */ } }
    io.to(pid).emit(event, payload);
  }
}

// Produtor Kafka (item 4): publica 'match-completed' ao fim de cada partida.
// init() é tolerante a falha; sem KAFKA_BROKER ou com o broker fora, vira no-op.
const kafka = require('./kafka');
kafka.init();

const createGame = require(`./games/${GAME}`);
const playerStats = {}; // usado pelo Jogo 1 para a contagem de vitórias (Wins)
const game = createGame(io, {
  playerStats, AUTH_API_URL, emitState,
  publishMatchCompleted: kafka.publishMatchCompleted,
});

io.on('connection', (socket) => {
  // Identidade do jogador = id do cliente no gateway (repassado na sinalização).
  socket.data.playerId = socket.handshake.auth.playerId || socket.id;
  socket.join(socket.data.playerId); // habilita io.to(playerId) (fallback)

  if (GAME === 'jogo1') {
    playerStats[socket.data.playerId] = { wins: 0, username: socket.user.sub };
    fetch(`${AUTH_API_URL}/wins/${socket.user.sub}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.wins !== undefined) {
          playerStats[socket.data.playerId].wins = data.wins;
          socket.emit('updateWins', data.wins);
        }
      })
      .catch(err => console.error("Erro ao buscar wins", err));
  }

  socket.on('join_game_lobby', (data) => {
    if (!data || data.gameId !== GAME) return;
    game.sendRoomList(socket);
    if (GAME === 'jogo1') {
      const ps = playerStats[socket.data.playerId];
      socket.emit('updateWins', ps ? ps.wins : 0);
    }
  });

  game.register(socket);

  socket.on('disconnect', () => {
    if (GAME === 'jogo1') {
      game.handleDisconnect(socket.data.playerId);
      delete playerStats[socket.data.playerId];
    } else {
      game.handleDisconnect(socket);
    }
  });
});

server.listen(PORT, () => { console.log(`Game Engine [${GAME}] (Socket.io) running on port ${PORT}`); });

// ==========================================================================
// Canal de jogo em tempo real via WebRTC (geckos.io). Isolado em try/catch:
// se a stack WebRTC falhar, o engine continua 100% funcional pelo Socket.io.
// ==========================================================================
try {
  const { geckos } = require('@geckos.io/server');
  const geckosIo = geckos({
    cors: { origin: '*', allowAuthorization: true },
    // Faixa de portas UDP/ICE (abrir no Security Group/Docker na AWS — item 3).
    portRange: (process.env.GECKOS_UDP_MIN && process.env.GECKOS_UDP_MAX)
      ? { min: parseInt(process.env.GECKOS_UDP_MIN, 10), max: parseInt(process.env.GECKOS_UDP_MAX, 10) }
      : undefined,
    // Valida o JWT na abertura do canal (mesmo segredo do Socket.io).
    authorization: async (auth) => {
      try {
        const token = (auth || '').replace(/^Bearer\s+/i, '');
        const decoded = jwt.verify(token, JWT_SECRET);
        return { sub: decoded.sub };
      } catch (_) {
        return false; // rejeita o canal
      }
    },
  });

  geckosIo.onConnection((channel) => {
    // O cliente informa sua identidade do gateway (playerId) e a sala.
    channel.on('rt-init', (data) => {
      if (!data || !data.playerId) return;
      channel.userData.playerId = data.playerId;
      channels[data.playerId] = channel;
    });

    // Inputs (hot path) chegam pelo DataChannel e chamam as MESMAS funções
    // apply* usadas pelo Socket.io — independentes do transporte.
    if (GAME === 'jogo1') {
      channel.on('playerMovement', (d) => { if (channel.userData.playerId) game.applyMovement(channel.userData.playerId, d); });
      channel.on('shoot', () => { if (channel.userData.playerId) game.applyShoot(channel.userData.playerId); });
    } else if (GAME === 'jogo2') {
      channel.on('acao', (a) => { if (channel.userData.playerId) game.applyAcao(channel.userData.playerId, a); });
    } else if (GAME === 'jogo3') {
      channel.on('j3_move', (dir) => { if (channel.userData.playerId) game.applyMove(channel.userData.playerId, dir); });
      channel.on('j3_shoot', () => { if (channel.userData.playerId) game.applyShoot(channel.userData.playerId); });
    }

    channel.onDisconnect(() => {
      const pid = channel.userData && channel.userData.playerId;
      if (pid && channels[pid] === channel) delete channels[pid];
    });
  });

  geckosIo.listen(GECKOS_PORT);
  console.log(`Game Engine [${GAME}] (WebRTC/geckos) signaling on port ${GECKOS_PORT}`);
} catch (err) {
  console.error(`[engine ${GAME}] WebRTC indisponível (${err.message}); seguindo só com Socket.io.`);
}
