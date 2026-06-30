// ==========================================================================
// JOGO 3 — Invasão Alienígena (Cooperativo + boss, 1 a 4 jogadores).
// Identidade do jogador por playerId (id do cliente no gateway). Tudo trafega
// por Socket.io via gateway-relay: inputs j3_move/j3_shoot, estado j3_gameState
// e os demais eventos da sala.
// Tipos de inimigo (nome interno => GDD): 'batalha' = Caçador, 'tanque' = Destruidor, 'mae' = Leviatã (chefe).
// ==========================================================================
const {
  TICK_RATE, SHIP_SPEED, PROJECTILE_SPEED, SHOOT_COOLDOWN, PROJECTILE_RADIUS, PLAYER_COLORS, DEG_TO_RAD,
} = require('../shared/constants');

const BOSS_TRIGGER_TIME = 2400; // ~40s a 60Hz: tempo a partir do qual o chefe pode surgir
const BOSS_WARNING_TICKS = 180; // ~3s de alerta congelado antes da batalha

module.exports = function createJogo3(io, deps) {
  deps = deps || {};
  const emitState = deps.emitState || ((ids, event, payload) => ids.forEach(id => io.to(id).emit(event, payload)));
  // Publica o fim de partida no Kafka (item 4). No-op tolerante se indisponível.
  const publishMatch = deps.publishMatchCompleted || (async () => false);
  // Resultado cooperativo: a pontuação da run vai para cada jogador da sala.
  function j3_publishResult(room, won) {
      publishMatch({
          game: 'jogo3', finishedAt: new Date().toISOString(),
          players: Object.values(room.players).map(p => ({ username: p.username, score: room.score, won })),
      });
  }
  const salasJogo3 = {};

  function j3_getRoomByPlayer(pid) {
    for (const name in salasJogo3) { if (salasJogo3[name].players[pid]) return name; }
    return null;
  }

  function j3_enviarListaSalas() {
    const listaDisponivel = Object.keys(salasJogo3)
        .filter(r => !salasJogo3[r].isGameRunning)
        .map(r => ({ id: r, hostName: salasJogo3[r].hostName }));
    io.emit('j3_updateRoomList', listaDisponivel);
  }

  function j3_handleDisconnect(socket, pid) {
      const roomName = socket.roomNameJ3;
      if (roomName && salasJogo3[roomName]) {
          delete salasJogo3[roomName].players[pid];
          salasJogo3[roomName].playerCount--;
          socket.leave(roomName); socket.roomNameJ3 = null;
          if (salasJogo3[roomName].playerCount <= 0) {
              if(salasJogo3[roomName].intervalId) clearInterval(salasJogo3[roomName].intervalId);
              delete salasJogo3[roomName];
          } else {
              io.to(roomName).emit('j3_roomJoined', { roomName: roomName, playerCount: salasJogo3[roomName].playerCount });
          }
          j3_enviarListaSalas();
      }
  }

  // Encerra a partida: avisa o resultado, publica no Kafka e LIBERA a sala —
  // remove todos do canal (socketsLeave) e apaga a sala do mapa. Sem isso a sala
  // ficava "viva" com os jogadores presos: ao reiniciá-la, um jogador que já tinha
  // voltado ao menu reaparecia no jogo do outro (bug relatado). Espelha o Jogo 1/2.
  function j3_finishMatch(roomName, won) {
      const room = salasJogo3[roomName];
      if (!room) return;
      if (room.intervalId) clearInterval(room.intervalId);
      room.isGameRunning = false;
      io.to(roomName).emit('j3_gameOver', { won, score: room.score });
      j3_publishResult(room, won);
      io.in(roomName).socketsLeave(roomName);
      delete salasJogo3[roomName];
      j3_enviarListaSalas();
  }

  function j3_updateGameLogic(roomName) {
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
          emitState(Object.keys(room.players), 'j3_gameState', { players: room.players, enemies: room.enemies, playerBullets: [], enemyBullets: [], score: room.score, phase: 'warning' });
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
          // Tipos de inimigo (nome interno => GDD): 'batalha' = Caçador, 'tanque' = Destruidor, 'mae' = Leviatã (chefe).
          switch(enemy.type) {
              case 'batalha':
                  enemy.y += 2; if (Math.random() < 0.01) room.enemyBullets.push({ x: enemy.x, y: enemy.y, vx: 0, vy: 5, radius: 3 }); break;
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

      j3_checkCollisions(room, roomName);
      // A partida pode ter terminado dentro do checkCollisions (sala liberada);
      // nesse caso não há mais estado a transmitir.
      if (!salasJogo3[roomName]) return;

      emitState(Object.keys(room.players), 'j3_gameState', { players: room.players, enemies: room.enemies, playerBullets: room.playerBullets, enemyBullets: room.enemyBullets, score: room.score, phase: room.waveManager.phase });
  }

  function j3_checkCollisions(room, roomName) {
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
                          room.enemies.splice(j, 1);
                          j3_finishMatch(roomName, true); // vitória: encerra e libera a sala
                          return;
                      }
                      room.score += (enemy.type === 'tanque' ? 50 : 10);
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
          j3_finishMatch(roomName, false); // derrota: encerra e libera a sala
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

  // --- Aplicação de inputs ---
  function applyMove(pid, direction) {
      const roomName = j3_getRoomByPlayer(pid);
      if (roomName && salasJogo3[roomName].players[pid]) {
          salasJogo3[roomName].players[pid].dir = (direction === 'left' || direction === 'right') ? direction : 'stop';
      }
  }
  function applyShoot(pid) {
      const roomName = j3_getRoomByPlayer(pid);
      if (roomName && salasJogo3[roomName].players[pid]) {
          const player = salasJogo3[roomName].players[pid];
          const now = Date.now();
          if (player.isAlive && now - (player.lastShot || 0) > SHOOT_COOLDOWN) {
              player.lastShot = now;
              salasJogo3[roomName].playerBullets.push({ x: player.x, y: player.y - 15, vx: 0, vy: PROJECTILE_SPEED, radius: PROJECTILE_RADIUS, color: player.color });
          }
      }
  }

  function register(socket) {
    const pid = (socket.data && socket.data.playerId) || socket.id;
    socket.on('j3_createRoom', (roomName) => {
        if (salasJogo3[roomName]) { socket.emit('j3_errorMsg', 'Já existe uma sala com este nome.'); return; }
        // donoId = quem criou; só ele pode iniciar a partida (ver 'j3_startGame').
        salasJogo3[roomName] = { hostName: socket.user.sub, donoId: pid, players: {}, enemies: [], playerBullets: [], enemyBullets: [], isGameRunning: false, playerCount: 0, score: 0, waveManager: { time: 0, phase: 'combat', bossWarningTimer: 0 } };
        socket.emit('j3_roomCreated', roomName); j3_enviarListaSalas();
    });
    socket.on('j3_joinRoom', (roomName) => {
        const room = salasJogo3[roomName];
        if (!room) { socket.emit('j3_errorMsg', 'Sala não encontrada.'); return; }
        if (room.playerCount >= 4) { socket.emit('j3_errorMsg', 'A sala está cheia.'); return; }
        socket.join(roomName); socket.roomNameJ3 = roomName;
        room.players[pid] = { username: socket.user.sub, x: 400, y: 500, color: PLAYER_COLORS[room.playerCount % 4], isAlive: true, dir: 'stop', lastShot: 0 };
        room.playerCount++;
        io.to(roomName).emit('j3_roomJoined', { roomName: roomName, playerCount: room.playerCount });
        j3_enviarListaSalas();
    });
    socket.on('j3_startGame', () => {
        const roomName = socket.roomNameJ3; const room = salasJogo3[roomName];
        // Só o DONO (quem criou) inicia — mesma trava do jogo2. Validação
        // autoritativa: um jogador que só entrou não começa a missão pelos outros.
        if (roomName && room && !room.isGameRunning && room.donoId === pid) {
            room.isGameRunning = true; io.to(roomName).emit('j3_gameStarted');
            room.intervalId = setInterval(() => j3_updateGameLogic(roomName), TICK_RATE); j3_enviarListaSalas();
        }
    });
    socket.on('j3_move', (direction) => applyMove(pid, direction));
    socket.on('j3_shoot', () => applyShoot(pid));
    socket.on('j3_leaveRoom', () => { j3_handleDisconnect(socket, pid); });
  }

  return {
    register,
    sendRoomList: () => j3_enviarListaSalas(),
    handleDisconnect: (socket) => j3_handleDisconnect(socket, (socket.data && socket.data.playerId) || socket.id),
  };
};
