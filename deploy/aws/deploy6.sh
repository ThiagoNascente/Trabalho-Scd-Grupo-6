#!/usr/bin/env bash
# ==========================================================================
# deploy6.sh — Máquina spaceship-engine3: Game Engine do jogo3 (Node).
#
# Cada engine na SUA máquina (deploy4 = jogo1, deploy5 = jogo2, deploy6 = jogo3)
# => PARTICIONAMENTO FUNCIONAL (item 1): derrubar esta máquina tira do ar SÓ o
# jogo3; os jogos 1 e 2 seguem normais.
#
# ORDEM: rode depois do deploy1/2/3. É a última máquina — quando este terminar,
# a stack está completa nas 6 EC2.
#
#   sudo bash deploy/aws/deploy6.sh
#
# Variáveis no env.aws: JWT_SECRET; AUTH_HOST_PRIVATE = deploy3; KAFKA_HOST_PRIVATE
# = deploy2. Preencha ENGINE3_HOST_PRIVATE com o IP PRIVADO desta máquina (é por
# ele que o gateway abre a conexão-relay). Alvo: Ubuntu 22.04/24.04.
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/common.sh"
need_root "$@"
LIB="$SCRIPT_DIR/lib"

log "===== deploy6 (spaceship-engine3): Game Engine jogo3 ====="
bash "$LIB/engine.sh" jogo3
log "===== deploy6 OK: engine jogo3 (Socket.io 4003, acesso interno pelo gateway) ====="
