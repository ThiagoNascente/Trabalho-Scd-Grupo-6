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
const AUTH_API_URL = process.env.AUTH_API_URL || "http://localhost:5000/api/auth";

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
// CONSTANTES PADRONIZADAS (ajuste pós-QA)
// Velocidade das naves, física e visual do projétil unificados nos 3 jogos.
// Movimento sempre autoritativo no servidor a 60 Hz => independente do FPS do cliente.
// ==========================================
const TICK_RATE = 1000 / 60;        // 60 Hz em todos os jogos
const SHIP_SPEED = 7;               // px por tick — velocidade base padronizada das naves
const PROJECTILE_SPEED = 14;        // px por tick — física padronizada do projétil
const SHOOT_COOLDOWN = 280;         // ms — cadência de tiro padronizada
const PROJECTILE_RADIUS = 4;        // raio padronizado do projétil
// Paleta única de cores por jogador. O projétil herda a cor da nave que o disparou.
const PLAYER_COLORS = ['#00FFFF', '#FF00FF', '#00FF88', '#FFE600'];

// ==========================================
// ESTADO GERAL E DO JOGO 1
// ==========================================
const rooms = {};
const playerStats = {};
function generateRoomId() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

// ==========================================
// ESTADO DO JOGO 2 (ASTEROIDES)
// ==========================================
const salasJogo2 = {};
const VELOCIDADE_ASTEROIDE_BASE = 3;
function j2_enviarListaSalas(io) {
    const listaDisponivel = Object.keys(salasJogo2)
        .filter(id => Object.keys(salasJogo2[id].jogadores).length < 4 && !salasJogo2[id].emAndamento)
        .map(id => ({ id: id, hostName: salasJogo2[id].hostName, jogadores: Object.keys(salasJogo2[id].jogadores).length }));
    io.emit('listaSalas', listaDisponivel);
}

// ==========================================
// ESTADO DO JOGO 3 (DEFESA DE FROTA)
// ==========================================
const salasJogo3 = {};
const DEG_TO_RAD = Math.PI / 180;
const BOSS_TRIGGER_TIME = 2400; // ~40s a 60Hz: tempo a partir do qual o chefe pode surgir
const BOSS_WARNING_TICKS = 180; // ~3s de alerta congelado antes da batalha
function j3_enviarListaSalas(io) {
    const listaDisponivel = Object.keys(salasJogo3)
        .filter(r => !salasJogo3[r].isGameRunning)
        .map(r => ({ id: r, hostName: salasJogo3[r].hostName }));
    io.emit('j3_updateRoomList', listaDisponivel);
}

io.on('connection', (socket) => {
  console.log(`[+] User connected: ${socket.user.sub} (Socket ID: ${socket.id})`);

  playerStats[socket.id] = { wins: 0, username: socket.user.sub };
  fetch(`${AUTH_API_URL}/wins/${socket.user.sub}`)
      .then(res => res.json())
      .then(data => {
          if (data && data.wins !== undefined) {
              playerStats[socket.id].wins = data.wins;
              socket.emit('updateWins', data.wins);
          }
      })
      .catch(err => console.error("Erro ao buscar wins", err));

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
      rooms[roomId].players[socket.id] = { x: 500, y: 550, color: PLAYER_COLORS[0], isP1: true, lastShot: 0, dir: 'stop' };
      socket.join(roomId);
      socket.emit('roomJoined', rooms[roomId]);
      io.emit('roomList', getOpenRooms());
  });
  socket.on('joinRoom', (roomId) => {
      handlePlayerLeave(socket.id);
      const room = rooms[roomId];
      if (room && room.status === 'waiting') {
          room.guestId = socket.id; room.status = 'countdown';
          room.players[socket.id] = { x: 500, y: 50, color: PLAYER_COLORS[1], isP1: false, lastShot: 0, dir: 'stop' };
          socket.join(roomId); io.to(roomId).emit('roomJoined', room); io.emit('roomList', getOpenRooms()); startCountdown(room);
      }
  });
  // Movimento por direção mantida (held-key). O deslocamento é aplicado no loop do servidor.
  socket.on('playerMovement', (data) => {
      const room = getRoomByPlayer(socket.id);
      if (room && room.players[socket.id]) {
          room.players[socket.id].dir = (data && data.dir) || 'stop';
      }
  });
  socket.on('shoot', () => {
      const room = getRoomByPlayer(socket.id);
      if (room && room.status === 'playing' && !room.inputLocked) {
          const player = room.players[socket.id]; const now = Date.now();
          if (now - player.lastShot > SHOOT_COOLDOWN) {
              player.lastShot = now;
              const laserDy = player.isP1 ? -PROJECTILE_SPEED : PROJECTILE_SPEED;
              const laserStartY = player.isP1 ? player.y - 20 : player.y + 20;
              room.lasers.push({ x: player.x, y: laserStartY, dy: laserDy, owner: socket.id, color: player.color, radius: PROJECTILE_RADIUS });
          }
      }
  });
  socket.on('leaveRoom', () => { handlePlayerLeave(socket.id); });

  // ---------------- EVENTOS DO JOGO 2 ----------------
  socket.on('criarSala', (idSala) => {
      if (!salasJogo2[idSala]) salasJogo2[idSala] = { hostName: socket.user.sub, jogadores: {}, projeteis: [], asteroides: [], emAndamento: false, pontos: 0, loop: null };
      j2_entrarNaSala(socket, idSala);
  });
  socket.on('entrarSala', (idSala) => {
      if (salasJogo2[idSala] && Object.keys(salasJogo2[idSala].jogadores).length < 4 && !salasJogo2[idSala].emAndamento) j2_entrarNaSala(socket, idSala);
      else socket.emit('erroSala', 'Sala indisponível ou cheia.');
  });
  function j2_entrarNaSala(socket, idSala) {
      socket.join(idSala); socket.idSalaJ2 = idSala;
      const qtd = Object.keys(salasJogo2[idSala].jogadores).length;
      salasJogo2[idSala].jogadores[socket.id] = { id: socket.id, nome: socket.user.sub, cor: PLAYER_COLORS[qtd % 4], x: 200 + (qtd * 130), y: 550, movimento: 'parar', lastShot: 0 };
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
      if (acao.tipo === 'atirar') {
          const now = Date.now();
          if (now - (jogador.lastShot || 0) > SHOOT_COOLDOWN) {
              jogador.lastShot = now;
              sala.projeteis.push({ x: jogador.x, y: jogador.y - 20, dono: socket.id, cor: jogador.cor, raio: PROJECTILE_RADIUS });
          }
      }
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
      salasJogo3[roomName] = { hostName: socket.user.sub, players: {}, enemies: [], playerBullets: [], enemyBullets: [], isGameRunning: false, playerCount: 0, score: 0, waveManager: { time: 0, phase: 'combat', bossWarningTimer: 0 } };
      socket.emit('j3_roomCreated', roomName); j3_enviarListaSalas(io);
  });
  socket.on('j3_joinRoom', (roomName) => {
      const room = salasJogo3[roomName];
      if (!room) { socket.emit('j3_errorMsg', 'Sala não encontrada.'); return; }
      if (room.playerCount >= 4) { socket.emit('j3_errorMsg', 'A sala está cheia.'); return; }
      socket.join(roomName); socket.roomNameJ3 = roomName;
      room.players[socket.id] = { x: 400, y: 500, color: PLAYER_COLORS[room.playerCount % 4], isAlive: true, dir: 'stop', lastShot: 0 };
      room.playerCount++;
      io.to(roomName).emit('j3_roomJoined', { roomName: roomName, playerCount: room.playerCount });
      j3_enviarListaSalas(io);
  });
  socket.on('j3_startGame', () => {
      const roomName = socket.roomNameJ3; const room = salasJogo3[roomName];
      if (roomName && room && !room.isGameRunning) {
          room.isGameRunning = true; io.to(roomName).emit('j3_gameStarted');
          room.intervalId = setInterval(() => j3_updateGameLogic(roomName, io), TICK_RATE); j3_enviarListaSalas(io);
      }
  });
  // Movimento por direção mantida (held-key). O deslocamento é aplicado no loop do servidor.
  socket.on('j3_move', (direction) => {
      const roomName = socket.roomNameJ3;
      if (roomName && salasJogo3[roomName] && salasJogo3[roomName].players[socket.id]) {
          salasJogo3[roomName].players[socket.id].dir = (direction === 'left' || direction === 'right') ? direction : 'stop';
      }
  });
  socket.on('j3_shoot', () => {
      const roomName = socket.roomNameJ3;
      if (roomName && salasJogo3[roomName] && salasJogo3[roomName].players[socket.id]) {
          const player = salasJogo3[roomName].players[socket.id];
          const now = Date.now();
          if (player.isAlive && now - (player.lastShot || 0) > SHOOT_COOLDOWN) {
              player.lastShot = now;
              salasJogo3[roomName].playerBullets.push({ x: player.x, y: player.y - 15, vx: 0, vy: PROJECTILE_SPEED, radius: PROJECTILE_RADIUS, color: player.color });
          }
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
  if (room.players[room.hostId]) { room.players[room.hostId].x = 500; room.players[room.hostId].dir = 'stop'; }
  if (room.players[room.guestId]) { room.players[room.guestId].x = 500; room.players[room.guestId].dir = 'stop'; }
  room.lasers = [];
}
function startGameLoop(room) {
  room.interval = setInterval(() => {
      // Movimento autoritativo (velocidade base padronizada, independente do FPS do cliente)
      if (!room.inputLocked) {
          for (const id in room.players) {
              const p = room.players[id];
              if (p.dir === 'left') p.x -= SHIP_SPEED;
              else if (p.dir === 'right') p.x += SHIP_SPEED;
              if (p.x < 30) p.x = 30; if (p.x > 970) p.x = 970;
          }
      }
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
  }, TICK_RATE);
}
function handleHit(room, shooterId) {
  clearInterval(room.interval);
  if (shooterId === room.hostId) room.p1Score++; else room.p2Score++;
  if (room.p1Score >= 2 || room.p2Score >= 2) {
      const winnerId = room.p1Score >= 2 ? room.hostId : room.guestId;
      if (playerStats[winnerId]) {
          playerStats[winnerId].wins++;
          fetch(`${AUTH_API_URL}/wins/${playerStats[winnerId].username}/increment`, { method: 'POST' }).catch(err => console.error("Erro ao incrementar wins", err));
          io.to(winnerId).emit('updateWins', playerStats[winnerId].wins);
      }
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
        sala.projeteis.forEach(p => p.y -= PROJECTILE_SPEED); sala.projeteis = sala.projeteis.filter(p => p.y > 0);
        const chanceAsteroide = 0.015 + (sala.pontos * 0.0005);
        if (Math.random() < chanceAsteroide) sala.asteroides.push({ x: Math.random() * 750 + 25, y: -30, raio: Math.random() * 20 + 15 });
        sala.asteroides.forEach(a => a.y += VELOCIDADE_ASTEROIDE_BASE + (sala.pontos * 0.005));
        Object.values(sala.jogadores).forEach(j => {
            if (j.movimento === 'esquerda' && j.x > 25) j.x -= SHIP_SPEED;
            if (j.movimento === 'direita' && j.x < 775) j.x += SHIP_SPEED;
        });
        // Pontuação ativa por destruição de asteroides
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
    }, TICK_RATE);
}

// --- JOGO 3 ---
function j3_updateGameLogic(roomName, io) {
    const room = salasJogo3[roomName];
    if (!room || !room.isGameRunning) return;

    // --- Fase de ALERTA do chefe: congela o gameplay e exibe contagem regressiva ---
    if (room.waveManager.phase === 'warning') {
        room.waveManager.bossWarningTimer--;
        const seconds = Math.max(1, Math.ceil(room.waveManager.bossWarningTimer / 60));
        io.to(roomName).emit('j3_bossWarning', { seconds });
        if (room.waveManager.bossWarningTimer <= 0) {
            room.waveManager.phase = 'boss';
            // Chefe entra em cena descendo do topo (animação de entrada)
            room.enemies = [{ id: 'boss', type: 'mae', x: 400, y: -60, targetY: 100, hp: 100, maxHp: 100, timer: 0 }];
        }
        // Congelado: nenhuma física é processada, apenas o estado atual é reenviado.
        io.to(roomName).emit('j3_gameState', { players: room.players, enemies: room.enemies, playerBullets: [], enemyBullets: [], score: room.score, phase: 'warning' });
        return;
    }

    room.waveManager.time++;

    // Movimento autoritativo das naves (velocidade base padronizada, independente do FPS do cliente)
    Object.values(room.players).forEach(p => {
        if (!p.isAlive) return;
        if (p.dir === 'left' && p.x > 15) p.x -= SHIP_SPEED;
        if (p.dir === 'right' && p.x < 785) p.x += SHIP_SPEED;
    });

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
                if (enemy.y < enemy.targetY) {
                    // Animação de entrada: o chefe desce até a posição de combate antes de atacar
                    enemy.y += 4;
                } else {
                    enemy.x = 400 + Math.sin(room.waveManager.time * 0.02) * 300;
                    if (enemy.timer++ % 30 === 0) room.enemyBullets.push({ x: enemy.x, y: enemy.y + 50, vx: (Math.random() - 0.5) * 4, vy: 5, radius: 6 });
                } break;
        }
        if (enemy.y > 650 && enemy.type !== 'mae') room.enemies.splice(i, 1);
    }

    j3_checkCollisions(room, roomName, io);

    io.to(roomName).emit('j3_gameState', { players: room.players, enemies: room.enemies, playerBullets: room.playerBullets, enemyBullets: room.enemyBullets, score: room.score, phase: room.waveManager.phase });
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
                    // Pontuação ativa por destruição de inimigos
                    if (enemy.type === 'mae') {
                        room.score += 500;
                        io.to(roomName).emit('j3_gameOver', { won: true, score: room.score });
                        clearInterval(room.intervalId); room.isGameRunning = false;
                    } else {
                        room.score += (enemy.type === 'tanque' ? 50 : 10);
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
        io.to(roomName).emit('j3_gameOver', { won: false, score: room.score });
        clearInterval(room.intervalId); room.isGameRunning = false;
    }
}

function j3_spawnEnemies(room) {
    const wm = room.waveManager;
    if (wm.phase !== 'combat') return;
    if (wm.time < BOSS_TRIGGER_TIME) {
        if (wm.time % 120 === 0) room.enemies.push({ id: Date.now(), type: 'batalha', x: Math.random() * 700 + 50, y: -20, hp: 1, timer: 0 });
        if (wm.time % 480 === 0) room.enemies.push({ id: Date.now() + 1, type: 'tanque', x: Math.random() * 600 + 100, y: -20, hp: 5, timer: 0 });
    } else if (room.enemies.length === 0) {
        // Última nave inimiga comum eliminada => inicia o alerta de chegada do chefe
        wm.phase = 'warning';
        wm.bossWarningTimer = BOSS_WARNING_TICKS;
        room.enemyBullets = [];
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Game Gateway running on port ${PORT}`); });
