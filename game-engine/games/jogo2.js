// ==========================================================================
// JOGO 2 — Chuva de Asteroides (Survival, 1 a 4 jogadores).
// Identidade do jogador por playerId (id do cliente no gateway). Tudo trafega
// por Socket.io via gateway-relay: input 'acao', estado 'estadoDoJogo' e os
// demais eventos da sala.
// ==========================================================================
const {
  TICK_RATE, SHIP_SPEED, PROJECTILE_SPEED, SHOOT_COOLDOWN, PROJECTILE_RADIUS, PLAYER_COLORS,
} = require('../shared/constants');

const VELOCIDADE_ASTEROIDE_BASE = 3;

module.exports = function createJogo2(io, deps) {
  deps = deps || {};
  const emitState = deps.emitState || ((ids, event, payload) => ids.forEach(id => io.to(id).emit(event, payload)));
  // Publica o fim de partida no Kafka (item 4). No-op tolerante se indisponível.
  const publishMatch = deps.publishMatchCompleted || (async () => false);
  const salasJogo2 = {};

  function j2_getSalaByPlayer(pid) { return Object.values(salasJogo2).find(s => s.jogadores[pid]); }

  function j2_enviarListaSalas() {
    const listaDisponivel = Object.keys(salasJogo2)
        .filter(id => Object.keys(salasJogo2[id].jogadores).length < 4 && !salasJogo2[id].emAndamento)
        .map(id => ({ id: id, hostName: salasJogo2[id].hostName, jogadores: Object.keys(salasJogo2[id].jogadores).length }));
    io.emit('listaSalas', listaDisponivel);
  }

  function j2_entrarNaSala(socket, pid, idSala) {
      socket.join(idSala); socket.idSalaJ2 = idSala;
      const qtd = Object.keys(salasJogo2[idSala].jogadores).length;
      salasJogo2[idSala].jogadores[pid] = { id: pid, nome: socket.user.sub, cor: PLAYER_COLORS[qtd % 4], x: 200 + (qtd * 130), y: 550, movimento: 'parar', lastShot: 0 };
      io.to(idSala).emit('atualizarLobby', Object.values(salasJogo2[idSala].jogadores));
      j2_enviarListaSalas();
  }

  function j2_lidarComSaida(socket, pid) {
      const idSala = socket.idSalaJ2;
      if (idSala && salasJogo2[idSala]) {
          delete salasJogo2[idSala].jogadores[pid];
          if (Object.keys(salasJogo2[idSala].jogadores).length === 0) {
              if (salasJogo2[idSala].loop) clearInterval(salasJogo2[idSala].loop);
              delete salasJogo2[idSala];
          } else if (!salasJogo2[idSala].emAndamento) {
              io.to(idSala).emit('atualizarLobby', Object.values(salasJogo2[idSala].jogadores));
          }
          j2_enviarListaSalas();
      }
  }

  function j2_iniciarLoopServidor(idSala) {
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
              clearInterval(sala.loop); io.to(idSala).emit('fimDeJogo', sala.pontos);
              // Survival cooperativo: pontuação compartilhada da run vai para cada jogador.
              publishMatch({
                  game: 'jogo2', finishedAt: new Date().toISOString(),
                  players: Object.values(sala.jogadores).map(j => ({ username: j.nome, score: sala.pontos, won: false })),
              });
              // Encerra a sala: tira todos do canal (socketsLeave) e libera o nome.
              // Sem isso, um jogador seguia preso ao canal da sala já finalizada — se
              // alguém recriasse uma sala com o MESMO nome (o nome é digitado), esse
              // jogador era puxado para a tela de combate junto (jogador "fantasma").
              // Espelha o encerramento do Jogo 1/3.
              io.in(idSala).socketsLeave(idSala);
              delete salasJogo2[idSala];
          } else {
              emitState(Object.keys(sala.jogadores), 'estadoDoJogo', { jogadores: Object.values(sala.jogadores), projeteis: sala.projeteis, asteroides: sala.asteroides, pontos: sala.pontos });
          }
      }, TICK_RATE);
  }

  // --- Aplicação de input ---
  function applyAcao(pid, acao) {
      const sala = j2_getSalaByPlayer(pid); if (!sala || !sala.emAndamento) return;
      const jogador = sala.jogadores[pid]; if (!jogador) return;
      if (acao.tipo === 'mover') jogador.movimento = acao.direcao;
      if (acao.tipo === 'atirar') {
          const now = Date.now();
          if (now - (jogador.lastShot || 0) > SHOOT_COOLDOWN) {
              jogador.lastShot = now;
              sala.projeteis.push({ x: jogador.x, y: jogador.y - 20, dono: pid, cor: jogador.cor, raio: PROJECTILE_RADIUS });
          }
      }
  }

  function register(socket) {
    const pid = (socket.data && socket.data.playerId) || socket.id;
    socket.on('criarSala', (idSala) => {
        // Nome de sala é ÚNICO: se já existe, NÃO entra na sala alheia — recusa
        // (espelha o jogo3). Sem isso, "criar" uma sala com nome repetido caía na
        // sala de outro grupo e você era arrastado quando ELES iniciavam.
        if (salasJogo2[idSala]) { socket.emit('erroSala', 'Já existe uma sala com esse nome.'); return; }
        // donoId = quem criou; só ele pode iniciar a partida (ver 'iniciarPartida').
        salasJogo2[idSala] = { hostName: socket.user.sub, donoId: pid, jogadores: {}, projeteis: [], asteroides: [], emAndamento: false, pontos: 0, loop: null };
        j2_entrarNaSala(socket, pid, idSala);
    });
    socket.on('entrarSala', (idSala) => {
        if (salasJogo2[idSala] && Object.keys(salasJogo2[idSala].jogadores).length < 4 && !salasJogo2[idSala].emAndamento) j2_entrarNaSala(socket, pid, idSala);
        else socket.emit('erroSala', 'Sala indisponível ou cheia.');
    });
    socket.on('iniciarPartida', () => {
        const idSala = socket.idSalaJ2;
        const sala = salasJogo2[idSala];
        // Só o DONO da sala (quem criou) inicia. Sem essa trava, um jogador que
        // acabou de ENTRAR conseguia começar a partida pelos outros — pro host
        // parecia "começar sozinha". Validação autoritativa no servidor.
        if (sala && !sala.emAndamento && sala.donoId === pid) {
            sala.emAndamento = true; io.to(idSala).emit('partidaIniciada'); j2_enviarListaSalas(); j2_iniciarLoopServidor(idSala);
        }
    });
    socket.on('acao', (acao) => applyAcao(pid, acao));
    socket.on('sairDaSala', () => { j2_lidarComSaida(socket, pid); socket.leave(socket.idSalaJ2); socket.idSalaJ2 = null; });
  }

  return {
    register,
    sendRoomList: () => j2_enviarListaSalas(),
    handleDisconnect: (socket) => j2_lidarComSaida(socket, (socket.data && socket.data.playerId) || socket.id),
  };
};
