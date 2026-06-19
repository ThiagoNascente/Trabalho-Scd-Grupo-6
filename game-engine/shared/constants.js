// ==========================================================================
// CONSTANTES PADRONIZADAS (ajuste pós-QA) — compartilhadas pelos 3 jogos.
// Velocidade das naves, física e visual do projétil unificados nos 3 jogos.
// Movimento sempre autoritativo no servidor a 60 Hz => independente do FPS do cliente.
// ==========================================================================
module.exports = {
  TICK_RATE: 1000 / 60,        // 60 Hz em todos os jogos
  SHIP_SPEED: 7,               // px por tick — velocidade base padronizada das naves
  PROJECTILE_SPEED: 14,        // px por tick — física padronizada do projétil
  SHOOT_COOLDOWN: 280,         // ms — cadência de tiro padronizada
  PROJECTILE_RADIUS: 4,        // raio padronizado do projétil
  // Paleta única de cores por jogador. O projétil herda a cor da nave que o disparou.
  PLAYER_COLORS: ['#00FFFF', '#FF00FF', '#00FF88', '#FFE600'],
  DEG_TO_RAD: Math.PI / 180,
};
