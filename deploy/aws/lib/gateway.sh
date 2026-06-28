#!/usr/bin/env bash
# ==========================================================================
# gateway.sh — Game Gateway (Node) NATIVO. Lobby + roteamento (relay).
# Valida a sessão via gRPC SÍNCRONO no Auth (item 8). Alvo: Ubuntu 22.04/24.04.
#   sudo bash gateway.sh
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/../common.sh"
need_root "$@"
require_env JWT_SECRET AUTH_HOST_PRIVATE ENGINE1_HOST_PRIVATE ENGINE2_HOST_PRIVATE ENGINE3_HOST_PRIVATE

ensure_node
APP="$REPO_ROOT/game-gateway"
log "instalando deps do gateway (npm)…"
( cd "$APP" && npm install --omit=dev --no-audit --no-fund )
NODE_BIN="$(command -v node)"

install_systemd_unit "spaceship-gateway" "[Unit]
Description=Spaceship Game Gateway (Node)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP}
ExecStart=${NODE_BIN} ${APP}/index.js
Environment=PORT=${GATEWAY_PORT}
Environment=JWT_SECRET=${JWT_SECRET}
Environment=AUTH_GRPC_URL=${AUTH_GRPC_URL_DERIVED}
Environment=ENGINE1_URL=http://${ENGINE1_HOST_PRIVATE}:4001
Environment=ENGINE2_URL=http://${ENGINE2_HOST_PRIVATE}:4002
Environment=ENGINE3_URL=http://${ENGINE3_HOST_PRIVATE}:4003
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target"
log "Gateway no ar :${GATEWAY_PORT} (valida sessão via gRPC em ${AUTH_GRPC_URL_DERIVED})."
