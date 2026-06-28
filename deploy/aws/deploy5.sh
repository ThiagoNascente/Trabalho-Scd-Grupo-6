#!/usr/bin/env bash
# ==========================================================================
# deploy5.sh — Máquina spaceship-engine2: Game Engine do jogo2 (Node).
#
# Cada engine na SUA máquina (deploy4 = jogo1, deploy5 = jogo2, deploy6 = jogo3)
# => PARTICIONAMENTO FUNCIONAL (item 1): derrubar esta máquina tira do ar SÓ o
# jogo2; os jogos 1 e 3 seguem normais.
#
# ORDEM: rode depois do deploy1/2/3.
#
#   sudo bash deploy/aws/deploy5.sh
#
# Variáveis no env.aws: JWT_SECRET; AUTH_HOST_PRIVATE = deploy3; KAFKA_HOST_PRIVATE
# = deploy2. Preencha ENGINE2_HOST_PRIVATE com o IP PRIVADO desta máquina (é por
# ele que o gateway abre a conexão-relay). Alvo: Ubuntu 22.04/24.04.
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/common.sh"
need_root "$@"
LIB="$SCRIPT_DIR/lib"

log "===== deploy5 (spaceship-engine2): Game Engine jogo2 ====="
bash "$LIB/engine.sh" jogo2
log "===== deploy5 OK: engine jogo2 (Socket.io 4002, acesso interno pelo gateway) ====="
