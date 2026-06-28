// ==========================================================================
// JOGO 1 — Duelo (PvP 1v1). Lógica e estado isolados em um módulo próprio.
// Identidade do jogador: usa socket.data.playerId (id do cliente no gateway,
// repassado no handshake) quando presente; senão, o socket.id local. Assim o
// estado do jogo casa com o socket.id que o cliente conhece.
//
// Transporte: tudo por Socket.io via gateway-relay. Os INPUTS (movimento/tiro),
// o ESTADO por tick (gameUpdate) e os eventos de CONTROLE (roomJoined,
// countdown, matchOver, roomList) trafegam pelo mesmo canal.
// ==========================================================================
const {
  TICK_RATE, SHIP_SPEED, PROJECTILE_SPEED, SHOOT_COOLDOWN, PROJECTILE_RADIUS, PLAYER_COLORS,
} = require('../shared/constants');

// Regra de vitória do Jogo 1 (Duelo): placar ACUMULATIVO — cada round vencido soma
// 1 ponto ao vencedor (o adversário NÃO é zerado). Vence quem abrir WIN_MARGIN
// pontos de vantagem (menor partida possível: 2 x 0).
const WIN_MARGIN = 2;

module.exports = function createJogo1(io, deps) {
  const { playerStats, AUTH_API_URL } = deps;
  // Publica o fim de partida no Kafka (item 4). No-op tolerante se indisponível.
  const publishMatch = deps.publishMatchCompleted || (async () => false);
  // emitState envia o estado por tick a cada jogador da sala (io.to(playerId)).
  const emitState = deps.emitState || ((ids, event, payload) => ids.forEach(id => io.to(id).emit(event, payload)));

  const rooms = {};
  function generateRoomId() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

  function getOpenRooms() { return Object.values(rooms).filter(r => r.status === 'waiting').map(r => ({ id: r.id, host: r.hostName || r.hostId })); }
  function getRoomByPlayer(playerId) { return Object.values(rooms).find(r => r.players[playerId]); }
  function handlePlayerLeave(playerId) {
    const room = getRoomByPlayer(playerId);
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
        emitState(Object.keys(room.players), 'gameUpdate', room);
    }, TICK_RATE);
  }
  function handleHit(room, shooterId) {
    clearInterval(room.interval);
    // Placar ACUMULATIVO: quem vence o round soma 1 ponto; o adversário mantém o seu.
    if (shooterId === room.hostId) { room.p1Score++; }
    else { room.p2Score++; }
    if (Math.abs(room.p1Score - room.p2Score) >= WIN_MARGIN) {
        const winnerId = room.p1Score > room.p2Score ? room.hostId : room.guestId;
        const loserId = winnerId === room.hostId ? room.guestId : room.hostId;
        const winnerScore = Math.max(room.p1Score, room.p2Score);
        const loserScore = Math.min(room.p1Score, room.p2Score);
        if (playerStats[winnerId]) {
            playerStats[winnerId].wins++;
            fetch(`${AUTH_API_URL}/wins/${playerStats[winnerId].username}/increment`, { method: 'POST' }).catch(err => console.error("Erro ao incrementar wins", err));
            io.to(winnerId).emit('updateWins', playerStats[winnerId].wins);
        }
        const winnerName = playerStats[winnerId] ? playerStats[winnerId].username : 'Comandante';
        const loserName = playerStats[loserId] ? playerStats[loserId].username : 'Comandante';
        // Evento de fim de partida (Kafka): no Jogo 1 o ranking conta VITÓRIAS
        // (o Score Service só olha `won`); `score` guarda o placar final no histórico.
        publishMatch({
            game: 'jogo1', finishedAt: new Date().toISOString(),
            players: [
                { username: winnerName, score: winnerScore, won: true },
                { username: loserName, score: loserScore, won: false },
            ],
        });
        io.to(room.id).emit('matchOver', { reason: `${winnerName} Venceu a Partida!`, winnerId: winnerId });
        io.in(room.id).socketsLeave(room.id); delete rooms[room.id]; io.emit('roomList', getOpenRooms());
    } else {
        room.round++; resetPositions(room); emitState(Object.keys(room.players), 'gameUpdate', room); room.status = 'countdown'; startCountdown(room);
    }
  }

  // --- Aplicação de inputs ---
  function applyMovement(pid, data) {
    const room = getRoomByPlayer(pid);
    if (room && room.players[pid]) room.players[pid].dir = (data && data.dir) || 'stop';
  }
  function applyShoot(pid) {
    const room = getRoomByPlayer(pid);
    if (room && room.status === 'playing' && !room.inputLocked) {
        const player = room.players[pid]; const now = Date.now();
        if (now - player.lastShot > SHOOT_COOLDOWN) {
            player.lastShot = now;
            const laserDy = player.isP1 ? -PROJECTILE_SPEED : PROJECTILE_SPEED;
            const laserStartY = player.isP1 ? player.y - 20 : player.y + 20;
            room.lasers.push({ x: player.x, y: laserStartY, dy: laserDy, owner: pid, color: player.color, radius: PROJECTILE_RADIUS });
        }
    }
  }

  function register(socket) {
    const pid = (socket.data && socket.data.playerId) || socket.id;
    socket.on('createRoom', () => {
        handlePlayerLeave(pid);
        const roomId = generateRoomId();
        rooms[roomId] = { id: roomId, status: 'waiting', hostId: pid, hostName: socket.user.sub, guestId: null, players: {}, lasers: [], round: 1, p1Score: 0, p2Score: 0, interval: null, inputLocked: true };
        rooms[roomId].players[pid] = { x: 500, y: 550, color: PLAYER_COLORS[0], isP1: true, lastShot: 0, dir: 'stop' };
        socket.join(roomId);
        socket.emit('roomJoined', rooms[roomId]);
        io.emit('roomList', getOpenRooms());
    });
    socket.on('joinRoom', (roomId) => {
        handlePlayerLeave(pid);
        const room = rooms[roomId];
        if (room && room.status === 'waiting') {
            room.guestId = pid; room.status = 'countdown';
            room.players[pid] = { x: 500, y: 50, color: PLAYER_COLORS[1], isP1: false, lastShot: 0, dir: 'stop' };
            socket.join(roomId); io.to(roomId).emit('roomJoined', room); io.emit('roomList', getOpenRooms()); startCountdown(room);
        }
    });
    socket.on('playerMovement', (data) => applyMovement(pid, data));
    socket.on('shoot', () => applyShoot(pid));
    socket.on('leaveRoom', () => { handlePlayerLeave(pid); });
  }

  return {
    register,
    sendRoomList: (socket) => socket.emit('roomList', getOpenRooms()),
    handleDisconnect: (playerId) => handlePlayerLeave(playerId),
  };
};
