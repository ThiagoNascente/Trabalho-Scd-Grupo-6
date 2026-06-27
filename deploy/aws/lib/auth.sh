#!/usr/bin/env bash
# ==========================================================================
# auth.sh — Auth Service (C#) NATIVO: REST :5000 + gRPC :5005 (item 8).
# Publica com `dotnet publish` e roda via systemd. Alvo: Ubuntu 22.04/24.04.
#   sudo bash auth.sh
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/../common.sh"
need_root "$@"
require_env JWT_SECRET POSTGRES_PASSWORD PG_HOST_PRIVATE

ensure_dotnet
APP_SRC="$REPO_ROOT/auth-service"
PUB="/opt/spaceship/auth"
log "publicando o Auth (dotnet publish -c Release)…"
mkdir -p "$PUB"
dotnet publish "$APP_SRC/AuthService.csproj" -c Release -o "$PUB"

CONN="Host=${PG_HOST_PRIVATE};Port=${PG_PORT};Database=${POSTGRES_DB:-authdb};Username=${POSTGRES_USER:-postgres};Password=${POSTGRES_PASSWORD}"

install_systemd_unit "spaceship-auth" "[Unit]
Description=Spaceship Auth Service (C# / REST + gRPC)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PUB}
ExecStart=/usr/local/bin/dotnet ${PUB}/AuthService.dll
Environment=ConnectionStrings__DefaultConnection=${CONN}
Environment=JwtSettings__Secret=${JWT_SECRET}
Environment=GRPC_PORT=${AUTH_GRPC_PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target"
log "Auth no ar: REST :${AUTH_PORT} (fixa no código) + gRPC :${AUTH_GRPC_PORT}."
log "Teste local:  curl -s -o /dev/null -w 'auth %{http_code}\\n' http://localhost:${AUTH_PORT}/api/auth/wins/x"
