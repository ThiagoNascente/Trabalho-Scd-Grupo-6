// ==========================================================================
// GAME GATEWAY (relay) — ponto de entrada do cliente. Faz autenticação (JWT),
// lobby e ROTEAMENTO. NÃO roda física: para cada cliente, abre uma conexão-
// proxy a cada Game Engine e repassa os inputs do cliente para o engine dono
// do jogo e o estado do engine de volta para o cliente.
//
// Tudo trafega por Socket.io: cliente ↔ gateway e gateway ↔ engines (relay).
// Endereços dos engines vêm de variável de ambiente (ENGINE1/2/3_URL).
//
// Validação de sessão (item 8): na conexão, o gateway valida o JWT via gRPC
// SÍNCRONO no Auth (AUTH_GRPC_URL) — ver authClient.js. Sem AUTH_GRPC_URL ou com
// o Auth fora do ar, cai para validação local (jwt.verify), sem quebrar a v1.
// ==========================================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const { validateToken } = require('./authClient');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Segredo do JWT vem SEMPRE de variável de ambiente (sem default chumbado).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("[FATAL] JWT_SECRET não definido. Configure a variável de ambiente (veja .env.example).");
  process.exit(1);
}

// Endereço de cada Game Engine (1 por jogo). Em produção (AWS) aponta para a
// EC2/Load Balancer de cada engine; localmente, para as portas padrão.
const ENGINES = {
  jogo1: process.env.ENGINE1_URL || "http://localhost:4001",
  jogo2: process.env.ENGINE2_URL || "http://localhost:4002",
  jogo3: process.env.ENGINE3_URL || "http://localhost:4003",
};

// Mapa de evento do cliente -> jogo de destino (qual engine deve recebê-lo).
const EVENT_TO_GAME = {
  createRoom: 'jogo1', joinRoom: 'jogo1', playerMovement: 'jogo1', shoot: 'jogo1', leaveRoom: 'jogo1',
  criarSala: 'jogo2', entrarSala: 'jogo2', iniciarPartida: 'jogo2', acao: 'jogo2', sairDaSala: 'jogo2',
  j3_createRoom: 'jogo3', j3_joinRoom: 'jogo3', j3_startGame: 'jogo3', j3_move: 'jogo3', j3_shoot: 'jogo3', j3_leaveRoom: 'jogo3',
};

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error: No token provided"));
  // RPC síncrono ao Auth (com fallback local) — ver authClient.js.
  const result = await validateToken(token);
  if (!result.valid) return next(new Error("Authentication error: " + (result.reason || "Invalid token")));
  socket.user = { sub: result.username };
  socket.token = token; // repassado aos engines no handshake do relay
  next();
});

io.on('connection', (clientSocket) => {
  console.log(`[+] User connected: ${clientSocket.user.sub} (Socket ID: ${clientSocket.id})`);

  // Abre uma conexão-proxy autenticada a cada engine. O id do cliente no gateway
  // viaja como playerId para o engine usar como identidade do jogador.
  const proxies = {};
  for (const game of Object.keys(ENGINES)) {
    const proxy = ioClient(ENGINES[game], {
      auth: { token: clientSocket.token, playerId: clientSocket.id },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
    // Engine -> cliente: repassa qualquer evento emitido pelo engine a este jogador.
    proxy.onAny((event, ...args) => clientSocket.emit(event, ...args));
    proxy.on('connect_error', (e) => console.error(`[gateway] engine ${game} indisponível: ${e.message}`));
    proxies[game] = proxy;
  }

  // Cliente -> engine: roteia cada evento para o engine dono do jogo.
  clientSocket.onAny((event, ...args) => {
    if (event === 'join_game_lobby') {
      const gameId = args[0] && args[0].gameId;
      if (proxies[gameId]) proxies[gameId].emit(event, ...args);
      return;
    }
    const game = EVENT_TO_GAME[event];
    if (game && proxies[game]) proxies[game].emit(event, ...args);
  });

  clientSocket.on('disconnect', () => {
    console.log(`[-] User disconnected: ${clientSocket.user.sub}`);
    for (const game of Object.keys(proxies)) proxies[game].close();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Game Gateway (relay) running on port ${PORT}`); });
