const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_key_that_should_be_long_enough_for_hmac_sha256_in_production";

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error: No token provided"));
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error("Authentication error: Invalid token"));
    socket.user = decoded;
    next();
  });
});

// ==========================================
// ESTADO GERAL E DO JOGO 1
// ==========================================
const rooms = {};
const playerStats = {};
const LASER_SPEED = 40;
function generateRoomId() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

// ==========================================
// ESTADO DO JOGO 2 (ASTEROIDES)
// ==========================================
const salasJogo2 = {};
const VELOCIDADE_PROJETIL = 15;
const VELOCIDADE_NAVE = 10;
const VELOCIDADE_ASTEROIDE_BASE = 3;
function j2_enviarListaSalas(io) {
    const listaDisponivel = Object.keys(salasJogo2)
        .filter(id => Object.keys(salasJogo2[id].jogadores).length < 4 && !salasJogo2[id].emAndamento)
        .map(id => ({ id: id, jogadores: Object.keys(salasJogo2[id].jogadores).length }));
    io.emit('listaSalas', listaDisponivel);
}

// ==========================================
// ESTADO DO JOGO 3 (DEFESA DE FROTA)
// ==========================================
const salasJogo3 = {};
const DEG_TO_RAD = Math.PI / 180;
const j3_getPlayerColor = (index) => ['#00ff00', '#0000ff', '#ffff00', '#ff00ff'][index % 4];
function j3_enviarListaSalas(io) {
    io.emit('j3_updateRoomList', Object.keys(salasJogo3).filter(r => !salasJogo3[r].isGameRunning));
}

io.on('connection', (socket) => {
  console.log(`[+] User connected: ${socket.user.sub} (Socket ID: ${socket.id})`);

  playerStats[socket.id] = { wins: 0, username: socket.user.sub };
  socket.emit('updateWins', playerStats[socket.id].wins);

  socket.on('join_game_lobby', (data) => {
      if (data.gameId === 'jogo1') {
          socket.emit('roomList', getOpenRooms());
          socket.emit('updateWins', playerStats[socket.id].wins);
      } else if (data.gameId === 'jogo2') {
          j2_enviarListaSalas(io);
      } else if (data.gameId === 'jogo3') {
          j3_enviarListaSalas(io);
      }
  });

  // ---------------- EVENTOS DO JOGO 1 ----------------
  socket.on('createRoom', () => {
      handlePlayerLeave(socket.id);
      const roomId = generateRoomId();
      rooms[roomId] = { id: roomId, status: 'waiting', hostId: socket.id, hostName: socket.user.sub, guestId: null, players: {}, lasers: [], round: 1, p1Score: 0, p2Score: 0, interval: null, inputLocked: true };
      rooms[roomId].players[socket.id] = { x: 500, y: 550, color: '#00ffff', isP1: true, lastShot: 0 };
      socket.join(roomId);
      socket.emit('roomJoined', rooms[roomId]);
      io.emit('roomList', getOpenRooms()); 
  });
  socket.on('joinRoom', (roomId) => {
      handlePlayerLeave(socket.id);
      const room = rooms[roomId];
      if (room && room.status === 'waiting') {
          room.guestId = socket.id; room.status = 'countdown';
          room.players[socket.id] = { x: 500, y: 50, color: '#ff00ff', isP1: false, lastShot: 0 };
          socket.join(roomId); io.to(roomId).emit('roomJoined', room); io.emit('roomList', getOpenRooms()); startCountdown(room);
      }
  });
  socket.on('playerMovement', (data) => {
      const room = getRoomByPlayer(socket.id);
      if (room && room.status === 'playing' && !room.inputLocked) {
          const player = room.players[socket.id]; player.x += data.dx;
          if (player.x < 30) player.x = 30; if (player.x > 970) player.x = 970;
      }
  });
  socket.on('shoot', () => {
      const room = getRoomByPlayer(socket.id);
      if (room && room.status === 'playing' && !room.inputLocked) {
          const player = room.players[socket.id]; const now = Date.now();
          if (now - player.lastShot > 300) {
              player.lastShot = now;
              const laserDy = player.isP1 ? -LASER_SPEED : LASER_SPEED;
              const laserStartY = player.isP1 ? player.y - 20 : player.y + 20;
              room.lasers.push({ x: player.x, y: laserStartY, dy: laserDy, owner: socket.id });
          }
      }
  });
  socket.on('leaveRoom', () => { handlePlayerLeave(socket.id); });

  // ---------------- EVENTOS DO JOGO 2 ----------------
  socket.on('criarSala', (idSala) => {
      if (!salasJogo2[idSala]) salasJogo2[idSala] = { jogadores: {}, projeteis: [], asteroides: [], emAndamento: false, pontos: 0, loop: null };
      j2_entrarNaSala(socket, idSala);
  });
  socket.on('entrarSala', (idSala) => {
      if (salasJogo2[idSala] && Object.keys(salasJogo2[idSala].jogadores).length < 4 && !salasJogo2[idSala].emAndamento) j2_entrarNaSala(socket, idSala);
      else socket.emit('erroSala', 'Sala indisponível ou cheia.');
  });
  function j2_entrarNaSala(socket, idSala) {
      socket.join(idSala); socket.idSalaJ2 = idSala;
      const cores = ['#FF5733', '#33FF57', '#3357FF', '#F033FF'];
      const qtd = Object.keys(salasJogo2[idSala].jogadores).length;
      salasJogo2[idSala].jogadores[socket.id] = { id: socket.id, cor: cores[qtd], x: 200 + (qtd * 130), y: 550, movimento: 'parar' };
      io.to(idSala).emit('atualizarLobby', Object.values(salasJogo2[idSala].jogadores));
      j2_enviarListaSalas(io);
  }
  socket.on('iniciarPartida', () => {
      const idSala = socket.idSalaJ2;
      if (salasJogo2[idSala] && !salasJogo2[idSala].emAndamento) {
          salasJogo2[idSala].emAndamento = true; io.to(idSala).emit('partidaIniciada'); j2_enviarListaSalas(io); j2_iniciarLoopServidor(idSala, io);
      }
  });
  socket.on('acao', (acao) => {
      const sala = salasJogo2[socket.idSalaJ2]; if (!sala || !sala.emAndamento) return;
      const jogador = sala.jogadores[socket.id]; if (!jogador) return;
      if (acao.tipo === 'mover') jogador.movimento = acao.direcao;
      if (acao.tipo === 'atirar') sala.projeteis.push({ x: jogador.x, y: jogador.y - 20, dono: socket.id });
  });
  function j2_lidarComSaida(socket) {
      const idSala = socket.idSalaJ2;
      if (idSala && salasJogo2[idSala]) {
          delete salasJogo2[idSala].jogadores[socket.id];
          if (Object.keys(salasJogo2[idSala].jogadores).length === 0) {
              if (salasJogo2[idSala].loop) clearInterval(salasJogo2[idSala].loop);
              delete salasJogo2[idSala];
          } else if (!salasJogo2[idSala].emAndamento) {
              io.to(idSala).emit('atualizarLobby', Object.values(salasJogo2[idSala].jogadores));
          }
          j2_enviarListaSalas(io);
      }
  }
  socket.on('sairDaSala', () => { j2_lidarComSaida(socket); socket.leave(socket.idSalaJ2); socket.idSalaJ2 = null; });

  // ---------------- EVENTOS DO JOGO 3 ----------------
  socket.on('j3_createRoom', (roomName) => {
      if (salasJogo3[roomName]) { socket.emit('j3_errorMsg', 'Já existe uma sala com este nome.'); return; }
      salasJogo3[roomName] = { players: {}, enemies: [], playerBullets: [], enemyBullets: [], isGameRunning: false, playerCount: 0, waveManager: { time: 0, bossSpawned: false } };
      socket.emit('j3_roomCreated', roomName); j3_enviarListaSalas(io);
  });
  socket.on('j3_joinRoom', (roomName) => {
      const room = salasJogo3[roomName];
      if (!room) { socket.emit('j3_errorMsg', 'Sala não encontrada.'); return; }
      if (room.playerCount >= 4) { socket.emit('j3_errorMsg', 'A sala está cheia.'); return; }
      socket.join(roomName); socket.roomNameJ3 = roomName;
      room.players[socket.id] = { x: 400, y: 500, color: j3_getPlayerColor(room.playerCount), isAlive: true };
      room.playerCount++;
      io.to(roomName).emit('j3_roomJoined', { roomName: roomName, playerCount: room.playerCount });
      j3_enviarListaSalas(io);
  });
  socket.on('j3_startGame', () => {
      const roomName = socket.roomNameJ3; const room = salasJogo3[roomName];
      if (roomName && room && !room.isGameRunning) {
          room.isGameRunning = true; io.to(roomName).emit('j3_gameStarted');
          room.intervalId = setInterval(() => j3_updateGameLogic(roomName, io), 1000 / 60); j3_enviarListaSalas(io);
      }
  });
  socket.on('j3_move', (direction) => {
      const roomName = socket.roomNameJ3;
      if (roomName && salasJogo3[roomName] && salasJogo3[roomName].players[socket.id]) {
          const player = salasJogo3[roomName].players[socket.id];
          if (direction === 'left' && player.x > 15) player.x -= 5;
          if (direction === 'right' && player.x < 785) player.x += 5;
      }
  });
  socket.on('j3_shoot', () => {
      const roomName = socket.roomNameJ3;
      if (roomName && salasJogo3[roomName] && salasJogo3[roomName].players[socket.id]) {
          const player = salasJogo3[roomName].players[socket.id];
          if (player.isAlive) salasJogo3[roomName].playerBullets.push({ x: player.x, y: player.y - 15, vx: 0, vy: 10, radius: 3 });
      }
  });
  socket.on('j3_leaveRoom', () => { j3_handleDisconnect(socket, io); });
  
  function j3_handleDisconnect(socket, io) {
      const roomName = socket.roomNameJ3;
      if (roomName && salasJogo3[roomName]) {
          delete salasJogo3[roomName].players[socket.id];
          salasJogo3[roomName].playerCount--;
          socket.leave(roomName); socket.roomNameJ3 = null;
          if (salasJogo3[roomName].playerCount <= 0) {
              if(salasJogo3[roomName].intervalId) clearInterval(salasJogo3[roomName].intervalId);
              delete salasJogo3[roomName];
          } else {
              io.to(roomName).emit('j3_roomJoined', { roomName: roomName, playerCount: salasJogo3[roomName].playerCount });
          }
          j3_enviarListaSalas(io);
      }
  }

  // ---------------- DISCONNECT GERAL ----------------
  socket.on('disconnect', () => {
      console.log(`[-] User disconnected: ${socket.user.sub}`);
      handlePlayerLeave(socket.id); 
      j2_lidarComSaida(socket); 
      j3_handleDisconnect(socket, io);
      delete playerStats[socket.id];
  });
});

// ==========================================
// FUNÇÕES DE FÍSICA E LOOP
// ==========================================
// --- JOGO 1 ---
function getOpenRooms() { return Object.values(rooms).filter(r => r.status === 'waiting').map(r => ({ id: r.id, host: r.hostName || r.hostId })); }
function getRoomByPlayer(socketId) { return Object.values(rooms).find(r => r.players[socketId]); }
function handlePlayerLeave(socketId) {
  const room = getRoomByPlayer(socketId);
  if (room) {
      if (room.interval) clearInterval(room.interval);
      io.to(room.id).emit('matchOver', { reason: 'Oponente abandonou a partida.' }); io.in(room.id).socketsLeave(room.id);
      delete rooms[room.id]; io.emit('roomList', getOpenRooms());
  }
}
function startCountdown(room) {
  let counter = 3; room.inputLocked = true;
  const interval = setInterval(() => {
      io.to(room.id).emit('countdown', counter);
      if (counter === 0) { clearInterval(interval); room.status = 'playing'; setTimeout(() => { room.inputLocked = false; }, 1000); startGameLoop(room); }
      counter--;
  }, 1000);
}
function resetPositions(room) {
  if (room.players[room.hostId]) room.players[room.hostId].x = 500;
  if (room.players[room.guestId]) room.players[room.guestId].x = 500;
  room.lasers = [];
}
function startGameLoop(room) {
  room.interval = setInterval(() => {
      for (let i = room.lasers.length - 1; i >= 0; i--) {
          const laser = room.lasers[i]; laser.y += laser.dy;
          if (laser.y < -50 || laser.y > 650) { room.lasers.splice(i, 1); continue; }
          for (const targetId in room.players) {
              if (targetId !== laser.owner) {
                  const target = room.players[targetId]; const dist = Math.hypot(laser.x - target.x, laser.y - target.y);
                  if (dist < 25) { room.lasers.splice(i, 1); handleHit(room, laser.owner); return; }
              }
          }
      }
      io.to(room.id).emit('gameUpdate', room);
  }, 1000 / 30);
}
function handleHit(room, shooterId) {
  clearInterval(room.interval);
  if (shooterId === room.hostId) room.p1Score++; else room.p2Score++;
  if (room.p1Score >= 2 || room.p2Score >= 2) {
      const winnerId = room.p1Score >= 2 ? room.hostId : room.guestId;
      if (playerStats[winnerId]) { playerStats[winnerId].wins++; io.to(winnerId).emit('updateWins', playerStats[winnerId].wins); }
      const winnerName = playerStats[winnerId] ? playerStats[winnerId].username : 'Comandante';
      io.to(room.id).emit('matchOver', { reason: `${winnerName} Venceu a Partida!`, winnerId: winnerId });
      io.in(room.id).socketsLeave(room.id); delete rooms[room.id]; io.emit('roomList', getOpenRooms());
  } else {
      room.round++; resetPositions(room); io.to(room.id).emit('gameUpdate', room); room.status = 'countdown'; startCountdown(room);
  }
}

// --- JOGO 2 ---
function j2_iniciarLoopServidor(idSala, io) {
    salasJogo2[idSala].loop = setInterval(() => {
        const sala = salasJogo2[idSala]; if (!sala) return;
        sala.projeteis.forEach(p => p.y -= VELOCIDADE_PROJETIL); sala.projeteis = sala.projeteis.filter(p => p.y > 0);
        const chanceAsteroide = 0.015 + (sala.pontos * 0.0005); 
        if (Math.random() < chanceAsteroide) sala.asteroides.push({ x: Math.random() * 750 + 25, y: -30, raio: Math.random() * 20 + 15 });
        sala.asteroides.forEach(a => a.y += VELOCIDADE_ASTEROIDE_BASE + (sala.pontos * 0.005));
        Object.values(sala.jogadores).forEach(j => {
            if (j.movimento === 'esquerda' && j.x > 25) j.x -= VELOCIDADE_NAVE;
            if (j.movimento === 'direita' && j.x < 775) j.x += VELOCIDADE_NAVE;
        });
        sala.projeteis.forEach((p, pIndex) => {
            sala.asteroides.forEach((a, aIndex) => {
                if (Math.hypot(p.x - a.x, p.y - a.y) < a.raio) { sala.asteroides.splice(aIndex, 1); sala.projeteis.splice(pIndex, 1); sala.pontos++; }
            });
        });
        let perdeu = false;
        sala.asteroides.forEach(a => {
            Object.values(sala.jogadores).forEach(j => { if (Math.hypot(j.x - a.x, j.y - a.y) < a.raio + 15) perdeu = true; });
        });
        if (perdeu) {
            clearInterval(sala.loop); io.to(idSala).emit('fimDeJogo', sala.pontos); delete salasJogo2[idSala];
        } else {
            io.to(idSala).emit('estadoDoJogo', { jogadores: Object.values(sala.jogadores), projeteis: sala.projeteis, asteroides: sala.asteroides, pontos: sala.pontos });
        }
    }, 1000 / 60);
}

// --- JOGO 3 ---
function j3_updateGameLogic(roomName, io) {
    const room = salasJogo3[roomName];
    if (!room || !room.isGameRunning) return;
    room.waveManager.time++;

    for (let i = room.playerBullets.length - 1; i >= 0; i--) {
        let bullet = room.playerBullets[i]; bullet.y -= bullet.vy; 
        if (bullet.y < 0) room.playerBullets.splice(i, 1);
    }
    for (let i = room.enemyBullets.length - 1; i >= 0; i--) {
        let bullet = room.enemyBullets[i]; bullet.x += bullet.vx; bullet.y += bullet.vy; 
        if (bullet.y > 600 || bullet.x < 0 || bullet.x > 800) room.enemyBullets.splice(i, 1);
    }

    j3_spawnEnemies(room);

    for (let i = room.enemies.length - 1; i >= 0; i--) {
        let enemy = room.enemies[i];
        switch(enemy.type) {
            case 'batalha': 
                enemy.y += 2; if (Math.random() < 0.01) room.enemyBullets.push({ x: enemy.x, y: enemy.y, vx: 0, vy: 5, radius: 3 }); break;
            case 'formacao': 
                enemy.y += 3; enemy.x += Math.sin(room.waveManager.time * 0.05) * 4; break;
            case 'tanque': 
                enemy.y += 1; enemy.timer++;
                if (enemy.timer % 120 === 0) { 
                    const speed = 4;
                    room.enemyBullets.push({ x: enemy.x, y: enemy.y, vx: 0, vy: speed, radius: 4 });
                    room.enemyBullets.push({ x: enemy.x, y: enemy.y, vx: speed * Math.sin(30 * DEG_TO_RAD), vy: speed * Math.cos(30 * DEG_TO_RAD), radius: 4 });
                    room.enemyBullets.push({ x: enemy.x, y: enemy.y, vx: speed * Math.sin(-30 * DEG_TO_RAD), vy: speed * Math.cos(-30 * DEG_TO_RAD), radius: 4 });
                } break;
            case 'mae': 
                enemy.x = 400 + Math.sin(room.waveManager.time * 0.02) * 300;
                if (enemy.timer++ % 30 === 0) room.enemyBullets.push({ x: enemy.x, y: enemy.y + 50, vx: (Math.random() - 0.5) * 4, vy: 5, radius: 6 }); break;
        }
        if (enemy.y > 650 && enemy.type !== 'mae') room.enemies.splice(i, 1);
    }

    j3_checkCollisions(room, roomName, io);

    io.to(roomName).emit('j3_gameState', { players: room.players, enemies: room.enemies, playerBullets: room.playerBullets, enemyBullets: room.enemyBullets });
}

function j3_checkCollisions(room, roomName, io) {
    for (let i = room.playerBullets.length - 1; i >= 0; i--) {
        let pBullet = room.playerBullets[i];
        for (let j = room.enemies.length - 1; j >= 0; j--) {
            let enemy = room.enemies[j];
            let enemyRadius = enemy.type === 'mae' ? 50 : (enemy.type === 'tanque' ? 20 : 15);
            if (Math.hypot(pBullet.x - enemy.x, pBullet.y - enemy.y) < pBullet.radius + enemyRadius) {
                room.playerBullets.splice(i, 1); enemy.hp--; 
                if (enemy.hp <= 0) {
                    if (enemy.type === 'mae') {
                        io.to(roomName).emit('j3_gameOver', { won: true });
                        clearInterval(room.intervalId); room.isGameRunning = false;
                    }
                    room.enemies.splice(j, 1); 
                }
                break; 
            }
        }
    }
    for (let i = room.enemyBullets.length - 1; i >= 0; i--) {
        let eBullet = room.enemyBullets[i];
        Object.values(room.players).forEach(player => {
            if (!player.isAlive) return; 
            if (Math.hypot(eBullet.x - player.x, eBullet.y - player.y) < eBullet.radius + 15) {
                room.enemyBullets.splice(i, 1); player.isAlive = false; 
            }
        });
    }
    const allPlayersDead = Object.values(room.players).every(p => p.isAlive === false);
    if (allPlayersDead && Object.keys(room.players).length > 0) {
        io.to(roomName).emit('j3_gameOver', { won: false });
        clearInterval(room.intervalId); room.isGameRunning = false;
    }
}

function j3_spawnEnemies(room) {
    if (room.waveManager.time % 120 === 0 && !room.waveManager.bossSpawned) room.enemies.push({ id: Date.now(), type: 'batalha', x: Math.random() * 700 + 50, y: -20, hp: 1, timer: 0 });
    if (room.waveManager.time % 480 === 0 && !room.waveManager.bossSpawned) room.enemies.push({ id: Date.now(), type: 'tanque', x: Math.random() * 600 + 100, y: -20, hp: 5, timer: 0 });
    if (room.waveManager.time > 3600 && !room.waveManager.bossSpawned) {
        room.waveManager.bossSpawned = true; room.enemies = []; room.enemies.push({ id: 'boss', type: 'mae', x: 400, y: 100, hp: 100, timer: 0 });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Game Gateway running on port ${PORT}`); });
