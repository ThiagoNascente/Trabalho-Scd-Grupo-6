#!/usr/bin/env bash
# ==========================================================================
# deploy1.sh — Máquina spaceship-data1: PostgreSQL PRIMÁRIO + Redis.
#
# É o "estado primário" do sistema distribuído: o banco autoritativo de ESCRITA
# (tabela Users do Auth + tabela scores PARTICIONADA do Score, item 11) e o
# cache do ranking (Redis, item 6). Rode esta máquina PRIMEIRO — todas as
# outras dependem dela (a réplica do deploy2 copia este primário).
#
#   sudo bash deploy/aws/deploy1.sh
#
# Variáveis usadas no env.aws (preencha com o IP PRIVADO desta máquina em
# PG_HOST_PRIVATE e REDIS_HOST_PRIVATE): POSTGRES_PASSWORD, VPC_CIDR,
# PG_REPL_USER, PG_REPL_PASSWORD. Alvo: Ubuntu 22.04/24.04.
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/common.sh"
need_root "$@"
LIB="$SCRIPT_DIR/lib"

log "===== deploy1 (spaceship-data1): PostgreSQL primário + Redis ====="
bash "$LIB/postgres.sh" primary
bash "$LIB/redis.sh"
log "===== deploy1 OK: PostgreSQL primário (TCP 5432) + Redis (TCP 6379) no ar ====="
