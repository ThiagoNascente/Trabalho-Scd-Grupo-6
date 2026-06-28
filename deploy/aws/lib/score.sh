#!/usr/bin/env bash
# ==========================================================================
# score.sh — Score Service (Python) NATIVO. Consome o Kafka, materializa o
# ranking no Redis e o histórico (particionado, item 11) no PostgreSQL; expõe
# GET /api/scores. Alvo: Ubuntu 22.04/24.04.   Uso:  sudo bash score.sh
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/../common.sh"
need_root "$@"
require_env POSTGRES_PASSWORD PG_HOST_PRIVATE REDIS_HOST_PRIVATE KAFKA_HOST_PRIVATE

log "instalando Python + venv…"
apt-get update -y
# build-essential + libpq-dev + python3-dev: necessários para COMPILAR o
# psycopg2-binary quando o pip não encontra um binário pronto (wheel) para a
# versão de Python da máquina. libpq-dev é quem fornece o 'pg_config'.
apt-get install -y python3 python3-venv python3-pip python3-dev build-essential libpq-dev
APP="$REPO_ROOT/score-service"
VENV="/opt/spaceship/score-venv"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip >/dev/null
"$VENV/bin/pip" install -r "$APP/requirements.txt"

install_systemd_unit "spaceship-score" "[Unit]
Description=Spaceship Score Service (Python)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP}
ExecStart=${VENV}/bin/python ${APP}/app.py
Environment=SCORE_PORT=${SCORE_PORT}
Environment=KAFKA_BROKER=${KAFKA_BROKER_DERIVED}
Environment=MATCH_TOPIC=${MATCH_TOPIC}
Environment=KAFKA_GROUP=score-service
Environment=REDIS_URL=${REDIS_URL_DERIVED}
Environment=PG_HOST=${PG_HOST_PRIVATE}
Environment=PG_PORT=${PG_PORT}
Environment=POSTGRES_DB=${POSTGRES_DB:-authdb}
Environment=POSTGRES_USER=${POSTGRES_USER:-postgres}
Environment=POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target"
log "Score no ar :${SCORE_PORT}.  Teste local:  curl -s http://localhost:${SCORE_PORT}/health"
