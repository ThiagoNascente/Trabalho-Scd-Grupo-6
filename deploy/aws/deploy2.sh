#!/usr/bin/env bash
# ==========================================================================
# deploy2.sh — Máquina spaceship-data2: Kafka + PostgreSQL RÉPLICA (item 10).
#
# Kafka é o barramento de eventos assíncrono (tópico match-completed, itens
# 4/5): os engines publicam e o Score consome. A RÉPLICA é uma cópia
# somente-leitura do primário (deploy1) — é ela que demonstra a replicação
# Primary-Replica em streaming.
#
# ATENÇÃO À ORDEM: a réplica faz `pg_basebackup` do primário, então o deploy1
# (spaceship-data1) PRECISA já estar no ar antes de rodar este script. Por isso
# o Kafka (que não depende de ninguém) sobe primeiro e a réplica por último.
#
#   sudo bash deploy/aws/deploy2.sh
#
# Variáveis no env.aws: KAFKA_HOST_PRIVATE = IP PRIVADO desta máquina;
# PG_HOST_PRIVATE = IP do primário (deploy1); PG_REPL_PASSWORD. Preencha também
# PG_REPLICA_HOST_PRIVATE com o IP desta máquina. Alvo: Ubuntu 22.04/24.04.
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/common.sh"
need_root "$@"
LIB="$SCRIPT_DIR/lib"

log "===== deploy2 (spaceship-data2): Kafka + PostgreSQL réplica ====="
bash "$LIB/kafka.sh"
log "subindo a RÉPLICA — ela COPIA o primário (deploy1). Se falhar aqui, confirme"
log "que o deploy1 já está no ar e rode 'sudo bash deploy/aws/deploy2.sh' de novo"
log "(o Kafka já estará no ar; o script é idempotente)."
bash "$LIB/postgres.sh" replica
log "===== deploy2 OK: Kafka (TCP 9092) + PostgreSQL réplica (TCP 5432, somente-leitura) ====="
