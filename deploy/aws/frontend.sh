#!/usr/bin/env bash
# ==========================================================================
# frontend.sh — publica o Frontend (Nginx) NATIVO e GERA o config.js com os
# DNS PÚBLICOS de cada serviço (é o navegador que acessa, então usa o público).
# Alvo: Ubuntu 22.04/24.04.   Uso:  sudo bash frontend.sh
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/common.sh"
need_root "$@"
require_env AUTH_HOST_PUBLIC GATEWAY_HOST_PUBLIC SCORE_HOST_PUBLIC \
            ENGINE1_HOST_PUBLIC ENGINE2_HOST_PUBLIC ENGINE3_HOST_PUBLIC

log "instalando Nginx…"
apt-get update -y
apt-get install -y nginx
WEB="/var/www/html"

cp "$REPO_ROOT/frontend/index.html" "$WEB/index.html"
# Bundle do WebRTC (geckos client) — sem ele o cliente fica só no Socket.io.
mkdir -p "$WEB/vendor"
cp "$REPO_ROOT/frontend/vendor/geckos.client.iife.js" "$WEB/vendor/"
# Remove a página padrão do Nginx para o nosso index.html ter prioridade.
rm -f "$WEB/index.nginx-debian.html"

# config.js gerado com os hosts PÚBLICOS (o navegador conecta direto em cada EC2).
cat > "$WEB/config.js" <<EOF
// GERADO por deploy/aws/frontend.sh — hosts PÚBLICOS de cada EC2 (1 serviço por máquina).
// Reexecute o script para regenerar se algum DNS público mudar.
window.APP_CONFIG = {
  HOST: "",
  AUTH_HOST: "${AUTH_HOST_PUBLIC}",
  GATEWAY_HOST: "${GATEWAY_HOST_PUBLIC}",
  SCORE_HOST: "${SCORE_HOST_PUBLIC}",
  AUTH_PORT: ${AUTH_PORT},
  GATEWAY_PORT: ${GATEWAY_PORT},
  SCORE_PORT: ${SCORE_PORT},
  USE_WEBRTC: true,
  ENGINE_HOSTS: { jogo1: "${ENGINE1_HOST_PUBLIC}", jogo2: "${ENGINE2_HOST_PUBLIC}", jogo3: "${ENGINE3_HOST_PUBLIC}" },
  ENGINE_GECKOS_PORTS: { jogo1: 5001, jogo2: 5002, jogo3: 5003 }
};
EOF

systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx
SELF_PUBLIC="$(curl -fsS http://169.254.169.254/latest/meta-data/public-hostname 2>/dev/null || echo "<DNS_PÚBLICO_DESTA_EC2>")"
log "Frontend publicado. Abra no navegador:  http://${SELF_PUBLIC}"
log "Confira o config gerado:  cat ${WEB}/config.js"
