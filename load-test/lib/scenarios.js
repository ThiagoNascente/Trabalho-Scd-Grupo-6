// ==========================================================================
// Cenários de jogo para os bots — falam o MESMO protocolo Socket.io do cliente
// real (ver game-engine/games/jogo1|2|3.js). Cada cenário:
//   1) entra no lobby do jogo, cria/entra numa sala e inicia a partida;
//   2) reage ao estado por tick enviando inputs (exercita o hot path);
//   3) encerra ao receber o evento de fim (ou por timeout).
// As estratégias buscam LEVAR A PARTIDA AO FIM para exercitar o ciclo completo
// (fim de partida -> publicação no Kafka), mas o foco é a CARGA concorrente.
// ==========================================================================
const { onceWithin, TIMEOUT } = require('./bot');

function rid(prefix, bot) {
  return `${prefix}-${String(bot.id).slice(0, 5)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

// ---- Estratégias de input (reagem ao estado) ----------------------------

// Jogo 1 (PvP): alinhar o x ao do oponente. Só o "agressor" atira: como a
// vitória exige 3 acertos CONSECUTIVOS (um acerto do outro zera a sequência),
// deixar ambos atirando faz o duelo oscilar sem fechar. Com um único atirador,
// ele varre 3–0 de forma determinística — e os dois bots ainda movem (inputs)
// e recebem estado (carga no relay/broadcast).
function driveJogo1(bot, room, metrics, canShoot) {
  const players = room && room.players;
  if (!players) return;
  const me = players[bot.id];
  const oppId = Object.keys(players).find((id) => id !== bot.id);
  if (!me || !oppId) return;
  const opp = players[oppId];
  const dir = opp.x < me.x - 4 ? 'left' : opp.x > me.x + 4 ? 'right' : 'stop';
  if (dir !== bot._lastDir) { bot._lastDir = dir; bot.emit('playerMovement', { dir }); metrics.input(); }
  if (!canShoot) return;
  const now = Date.now();
  if (now - bot._lastShot > 300) { bot._lastShot = now; bot.emit('shoot'); metrics.input(); }
}

// Jogo 2 (survival): perseguir o asteroide mais baixo (para encerrar a run).
function driveJogo2(bot, st, metrics) {
  const me = (st.jogadores || []).find((j) => j.id === bot.id);
  const asts = st.asteroides || [];
  if (!me || !asts.length) return;
  const target = asts.reduce((a, b) => (b.y > a.y ? b : a));
  const dir = target.x < me.x - 6 ? 'esquerda' : target.x > me.x + 6 ? 'direita' : 'parar';
  if (dir !== bot._lastDir) { bot._lastDir = dir; bot.emit('acao', { tipo: 'mover', direcao: dir }); metrics.input(); }
  // Tiro esporádico: exercita o input sem limpar todos os asteroides perseguidos.
  const now = Date.now();
  if (now - bot._lastShot > 1500) { bot._lastShot = now; bot.emit('acao', { tipo: 'atirar' }); metrics.input(); }
}

// Jogo 3 (co-op + boss): perseguir a bala inimiga mais baixa (para encerrar).
function driveJogo3(bot, st, metrics) {
  const me = st.players && st.players[bot.id];
  if (!me || me.isAlive === false) return;
  const bullets = st.enemyBullets || [];
  const enemies = st.enemies || [];
  let targetX = null;
  if (bullets.length) targetX = bullets.reduce((a, b) => (b.y > a.y ? b : a)).x;
  else if (enemies.length) targetX = enemies[0].x;
  if (targetX != null) {
    const dir = targetX < me.x - 6 ? 'left' : targetX > me.x + 6 ? 'right' : 'stop';
    if (dir !== bot._lastDir) { bot._lastDir = dir; bot.emit('j3_move', dir); metrics.input(); }
  }
  const now = Date.now();
  if (now - bot._lastShot > 320) { bot._lastShot = now; bot.emit('j3_shoot'); metrics.input(); }
}

// ---- Cenários completos --------------------------------------------------

async function playJogo1(botA, botB, cfg, metrics) {
  const game = 'jogo1';
  botA.emit('join_game_lobby', { gameId: game });
  botB.emit('join_game_lobby', { gameId: game });
  const t0 = Date.now();
  let firstA = false, firstB = false;
  const hA = (room) => { metrics.state(); if (!firstA) { firstA = true; metrics.firstState(Date.now() - t0); } driveJogo1(botA, room, metrics, true); };
  const hB = (room) => { metrics.state(); if (!firstB) { firstB = true; metrics.firstState(Date.now() - t0); } driveJogo1(botB, room, metrics, false); };
  botA.socket.on('gameUpdate', hA);
  botB.socket.on('gameUpdate', hB);
  try {
    botA.emit('createRoom');
    const created = await onceWithin([botA], 'roomJoined', cfg.startTimeoutMs);
    if (created === TIMEOUT) { metrics.error('jogo1:create-timeout'); return; }
    const roomId = created[0] && created[0].id;
    botB.emit('joinRoom', roomId);
    const joined = await onceWithin([botB], 'roomJoined', cfg.startTimeoutMs);
    if (joined === TIMEOUT) { metrics.error('jogo1:join-timeout'); return; }
    metrics.matchStart(game);
    const over = await onceWithin([botA, botB], 'matchOver', cfg.matchTimeoutMs);
    metrics.matchEnd(game, over !== TIMEOUT, Date.now() - t0);
  } finally {
    botA.socket.off('gameUpdate', hA);
    botB.socket.off('gameUpdate', hB);
    botA.emit('leaveRoom'); botB.emit('leaveRoom');
  }
}

async function playJogo2(bot, cfg, metrics) {
  const game = 'jogo2';
  bot.emit('join_game_lobby', { gameId: game });
  const t0 = Date.now();
  let first = false;
  const h = (st) => { metrics.state(); if (!first) { first = true; metrics.firstState(Date.now() - t0); } driveJogo2(bot, st, metrics); };
  bot.socket.on('estadoDoJogo', h);
  try {
    const roomId = rid('J2', bot);
    bot.emit('criarSala', roomId);
    await onceWithin([bot], 'atualizarLobby', cfg.startTimeoutMs);
    bot.emit('iniciarPartida');
    const started = await onceWithin([bot], 'partidaIniciada', cfg.startTimeoutMs);
    if (started === TIMEOUT) { metrics.error('jogo2:start-timeout'); return; }
    metrics.matchStart(game);
    const over = await onceWithin([bot], 'fimDeJogo', cfg.matchTimeoutMs);
    metrics.matchEnd(game, over !== TIMEOUT, Date.now() - t0);
  } finally {
    bot.socket.off('estadoDoJogo', h);
    bot.emit('sairDaSala');
  }
}

async function playJogo3(bot, cfg, metrics) {
  const game = 'jogo3';
  bot.emit('join_game_lobby', { gameId: game });
  const t0 = Date.now();
  let first = false;
  const h = (st) => { metrics.state(); if (!first) { first = true; metrics.firstState(Date.now() - t0); } driveJogo3(bot, st, metrics); };
  bot.socket.on('j3_gameState', h);
  try {
    const roomName = rid('J3', bot);
    bot.emit('j3_createRoom', roomName);
    const created = await onceWithin([bot], 'j3_roomCreated', cfg.startTimeoutMs);
    if (created === TIMEOUT) { metrics.error('jogo3:create-timeout'); return; }
    bot.emit('j3_joinRoom', roomName);
    const joined = await onceWithin([bot], 'j3_roomJoined', cfg.startTimeoutMs);
    if (joined === TIMEOUT) { metrics.error('jogo3:join-timeout'); return; }
    bot.emit('j3_startGame');
    const started = await onceWithin([bot], 'j3_gameStarted', cfg.startTimeoutMs);
    if (started === TIMEOUT) { metrics.error('jogo3:start-timeout'); return; }
    metrics.matchStart(game);
    const over = await onceWithin([bot], 'j3_gameOver', cfg.matchTimeoutMs);
    metrics.matchEnd(game, over !== TIMEOUT, Date.now() - t0);
  } finally {
    bot.socket.off('j3_gameState', h);
    bot.emit('j3_leaveRoom');
  }
}

module.exports = { playJogo1, playJogo2, playJogo3 };
