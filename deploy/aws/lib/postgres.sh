#!/usr/bin/env bash
# ==========================================================================
# postgres.sh — PostgreSQL NATIVO (sem Docker).
#   sudo bash postgres.sh primary   # primário (escritas) — PADRÃO
#   sudo bash postgres.sh replica    # réplica somente-leitura (item 10)
#
# As TABELAS (Users do Auth, scores particionada do Score) são criadas pelos
# próprios serviços no 1º boot — aqui só preparamos o banco, o acesso e a
# replicação (item 10). Alvo: Ubuntu 22.04/24.04.
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/../common.sh"
need_root "$@"
MODE="${1:-primary}"

log "instalando PostgreSQL…"
apt-get update -y
apt-get install -y postgresql postgresql-contrib

PG_CONF_DIR="$(ls -d /etc/postgresql/*/main 2>/dev/null | head -n1)"
PGDATA="$(ls -d /var/lib/postgresql/*/main 2>/dev/null | head -n1)"
[ -n "$PG_CONF_DIR" ] || die "config do Postgres não encontrada (instalação falhou?)."

# Escuta em todas as interfaces — quem controla o acesso é o Security Group/VPC.
sed -ri "s/^#?listen_addresses\s*=.*/listen_addresses = '*'/" "$PG_CONF_DIR/postgresql.conf"

if [ "$MODE" = "primary" ]; then
  require_env POSTGRES_PASSWORD VPC_CIDR
  # WAL para streaming replication (item 10).
  sed -ri "s/^#?wal_level\s*=.*/wal_level = replica/" "$PG_CONF_DIR/postgresql.conf"
  sed -ri "s/^#?max_wal_senders\s*=.*/max_wal_senders = 10/" "$PG_CONF_DIR/postgresql.conf"

  HBA="$PG_CONF_DIR/pg_hba.conf"
  if ! grep -q "spaceship-app" "$HBA"; then
    cat >> "$HBA" <<EOF

# spaceship-app — acesso dos serviços na sub-rede privada da VPC (Auth + Score)
host    all             all             ${VPC_CIDR}                 scram-sha-256
# spaceship-repl — canal de replicação (item 10)
host    replication     ${PG_REPL_USER:-replicador}   ${VPC_CIDR}   scram-sha-256
EOF
  fi

  systemctl enable postgresql >/dev/null 2>&1 || true
  systemctl restart postgresql
  sleep 2

  # Senha do superusuário + banco + papel de replicação (tudo idempotente).
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
ALTER USER ${POSTGRES_USER:-postgres} WITH PASSWORD '${POSTGRES_PASSWORD}';
SELECT 'CREATE DATABASE ${POSTGRES_DB:-authdb}'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='${POSTGRES_DB:-authdb}')\gexec
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${PG_REPL_USER:-replicador}') THEN
    CREATE ROLE ${PG_REPL_USER:-replicador} WITH REPLICATION LOGIN PASSWORD '${PG_REPL_PASSWORD:-troque-a-senha-da-replica}';
  END IF;
END \$\$;
SQL
  log "Postgres PRIMÁRIO no ar (banco '${POSTGRES_DB:-authdb}', porta ${PG_PORT})."
  log "As tabelas são criadas pelo Auth (Users) e pelo Score (scores particionada) no 1º boot."

elif [ "$MODE" = "replica" ]; then
  require_env PG_HOST_PRIVATE PG_REPL_PASSWORD
  log "recriando RÉPLICA a partir do primário ${PG_HOST_PRIVATE} (pg_basebackup)…"
  systemctl stop postgresql
  rm -rf "${PGDATA:?}/"*
  sudo -u postgres PGPASSWORD="$PG_REPL_PASSWORD" \
    pg_basebackup -h "$PG_HOST_PRIVATE" -p "$PG_PORT" -U "${PG_REPL_USER:-replicador}" \
    -D "$PGDATA" -Fp -Xs -P -R
  systemctl start postgresql
  sleep 2
  log "Réplica no ar (somente-leitura). Confirme:  sudo -u postgres psql -tc 'SELECT pg_is_in_recovery();'  (deve dar 't')."
else
  die "modo inválido '$MODE' — use 'primary' ou 'replica'."
fi
