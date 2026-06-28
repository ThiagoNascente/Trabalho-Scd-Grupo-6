#!/usr/bin/env bash
# ==========================================================================
# engine.sh — UM Game Engine (Node) NATIVO. Física de um jogo + Kafka.
#   sudo bash engine.sh jogo1     (Socket.io :4001)
#   sudo bash engine.sh jogo2     (Socket.io :4002)
#   sudo bash engine.sh jogo3     (Socket.io :4003)
# O cliente NÃO fala direto com o engine: quem conecta é o gateway (spaceship-app)
# pela porta interna 4001/4002/4003, na rede privada da VPC. Particionamento
# Funcional: cada engine na SUA EC2 — derrubar um não afeta os outros.
# Alvo: Ubuntu 22.04/24.04.
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/../common.sh"
need_root "$@"

GAME="${1:-}"
case "$GAME" in
  jogo1) PORT=4001 ;;
  jogo2) PORT=4002 ;;
  jogo3) PORT=4003 ;;
  *) die "uso: sudo bash engine.sh jogo1|jogo2|jogo3" ;;
esac
require_env JWT_SECRET AUTH_HOST_PRIVATE KAFKA_HOST_PRIVATE

ensure_node
APP="$REPO_ROOT/game-engine"
log "instalando deps do engine ($GAME)…"
( cd "$APP" && npm install --omit=dev --no-audit --no-fund )
NODE_BIN="$(command -v node)"

install_systemd_unit "spaceship-engine-${GAME}" "[Unit]
Description=Spaceship Game Engine ${GAME} (Node)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP}
ExecStart=${NODE_BIN} ${APP}/server.js
Environment=GAME=${GAME}
Environment=PORT=${PORT}
Environment=JWT_SECRET=${JWT_SECRET}
Environment=AUTH_API_URL=${AUTH_API_URL_DERIVED}
Environment=KAFKA_BROKER=${KAFKA_BROKER_DERIVED}
Environment=MATCH_TOPIC=${MATCH_TOPIC}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target"
log "Engine ${GAME} no ar (Socket.io :${PORT}; acesso interno — quem conecta é o gateway pela rede privada)."
