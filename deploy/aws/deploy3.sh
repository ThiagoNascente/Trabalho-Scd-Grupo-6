#!/usr/bin/env bash
# ==========================================================================
# deploy3.sh — Máquina spaceship-app: Auth (REST+gRPC) + Gateway + Score +
# Frontend.
#
# É a CAMADA DE BORDA: tudo que o navegador acessa direto — login/cadastro
# (Auth REST :5000), lobby/matchmaking (Gateway :3000), ranking global
# (Score :8000) e o site (Frontend :80). Como Auth e Gateway ficam na MESMA
# máquina, a validação de sessão via gRPC SÍNCRONO (item 8) acontece aqui (o
# gateway chama o Auth em :5005 pelo IP privado desta máquina).
#
# ORDEM: rode depois do deploy1 e deploy2 (precisa do Postgres, Redis e Kafka
# no ar). Os engines (deploy4/5/6) podem subir antes ou depois — o gateway só
# se conecta a eles quando uma partida começa.
#
#   sudo bash deploy/aws/deploy3.sh
#
# Variáveis no env.aws: JWT_SECRET, POSTGRES_PASSWORD; PG_HOST_PRIVATE e
# REDIS_HOST_PRIVATE = deploy1; KAFKA_HOST_PRIVATE = deploy2; AUTH_HOST_PRIVATE
# = IP PRIVADO desta máquina; ENGINE{1,2,3}_HOST_PRIVATE = deploy4/5/6 (o gateway
# alcança os engines pela rede interna). AUTH_HOST_PUBLIC = GATEWAY_HOST_PUBLIC =
# SCORE_HOST_PUBLIC = o DNS PÚBLICO desta máquina.
# Alvo: Ubuntu 22.04/24.04.
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/common.sh"
need_root "$@"
LIB="$SCRIPT_DIR/lib"

log "===== deploy3 (spaceship-app): Auth + Gateway + Score + Frontend ====="
bash "$LIB/auth.sh"      # REST :5000 + gRPC :5005 — sobe antes do gateway (item 8)
bash "$LIB/gateway.sh"   # :3000 — valida a sessão no Auth via gRPC
bash "$LIB/score.sh"     # :8000 — consome o Kafka, materializa o ranking no Redis/PG
bash "$LIB/frontend.sh"  # :80 — gera o config.js com os DNS públicos
log "===== deploy3 OK: Auth (5000/5005) + Gateway (3000) + Score (8000) + Frontend (80) ====="
log "Abra o jogo no navegador pelo DNS público desta máquina (porta 80)."
