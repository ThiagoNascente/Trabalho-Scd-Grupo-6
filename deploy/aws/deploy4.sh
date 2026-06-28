#!/usr/bin/env bash
# ==========================================================================
# deploy4.sh — Máquina spaceship-engine1: Game Engine do jogo1 (Node).
#
# Cada engine roda na SUA própria máquina (deploy4 = jogo1, deploy5 = jogo2,
# deploy6 = jogo3) => PARTICIONAMENTO FUNCIONAL (item 1): derrubar esta máquina
# tira do ar SÓ o jogo1; os jogos 2 e 3 seguem normais. É a demonstração de
# isolamento/tolerância a falha mais importante da entrega — por isso os três
# engines NÃO são condensados juntos.
#
# ORDEM: rode depois do deploy1/2/3 (o engine valida o jogador no Auth e
# publica o fim de partida no Kafka).
#
#   sudo bash deploy/aws/deploy4.sh
#
# Variáveis no env.aws: JWT_SECRET; AUTH_HOST_PRIVATE = deploy3; KAFKA_HOST_PRIVATE
# = deploy2. Preencha ENGINE1_HOST_PRIVATE com o IP PRIVADO desta máquina (é por
# ele que o gateway abre a conexão-relay). Alvo: Ubuntu 22.04/24.04.
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/common.sh"
need_root "$@"
LIB="$SCRIPT_DIR/lib"

log "===== deploy4 (spaceship-engine1): Game Engine jogo1 ====="
bash "$LIB/engine.sh" jogo1
log "===== deploy4 OK: engine jogo1 (Socket.io 4001, acesso interno pelo gateway) ====="
