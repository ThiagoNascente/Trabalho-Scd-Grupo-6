// ==========================================================================
// GAME ENGINE — processo independente que roda a FÍSICA de UM jogo.
// A mesma imagem serve os 3 jogos; GAME (jogo1|jogo2|jogo3) escolhe o módulo.
// Particionamento Funcional: derrubar um engine não afeta os demais.
//
// Transporte: Socket.io via Gateway-relay — lobby, controle e estado de jogo.
// O id do jogador no gateway viaja como `playerId` no handshake e identifica o
// jogador no estado da partida (o cliente não fala direto com o engine).
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
// Transporte de estado por tick: Socket.io por jogador (io.to(playerId)). Cada
// jogador entra numa sala com o seu próprio playerId (ver io.on('connection')),
// então o estado vai a cada participante da partida individualmente.
// ==========================================================================
function emitState(participantIds, event, payload) {
  for (const pid of participantIds) io.to(pid).emit(event, payload);
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
  // Identidade do jogador = id do cliente no gateway (repassado no handshake).
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
