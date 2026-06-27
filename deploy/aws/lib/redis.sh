#!/usr/bin/env bash
# ==========================================================================
# redis.sh — Redis NATIVO (cache do leaderboard, item 6).
# Sem senha: o acesso é restrito pelo Security Group (só a EC2 do Score alcança
# a 6379). Alvo: Ubuntu 22.04/24.04.   Uso:  sudo bash redis.sh
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/../common.sh"
need_root "$@"

log "instalando Redis…"
apt-get update -y
apt-get install -y redis-server

# Escuta em todas as interfaces (o Security Group/VPC controla o acesso).
sed -ri 's/^bind .*/bind 0.0.0.0 -::1/' /etc/redis/redis.conf
sed -ri 's/^protected-mode .*/protected-mode no/' /etc/redis/redis.conf

systemctl enable redis-server >/dev/null 2>&1 || true
systemctl restart redis-server
sleep 1
redis-cli ping || warn "redis-cli ping falhou — confira 'systemctl status redis-server'."
log "Redis no ar na porta ${REDIS_PORT}. De outra EC2:  redis-cli -h <IP_PRIVADO_REDIS> ping"
