#!/usr/bin/env bash
# ==========================================================================
# dev-stack.sh — sobe/derruba a stack LOCAL "lite" (SEM Docker) para testar
# rapidamente o harness de carga (load-test/), o auth canônico e jogar no
# navegador. Usa o auth-service-lite (Node/JSON) no lugar do Auth C#+Postgres,
# mais os 3 engines + gateway em Node. NÃO sobe Kafka/Redis/Score — para o E2E
# desses use o `docker compose` (ver README).
#
#   ./dev-stack.sh deps     # instala node_modules dos serviços (só na 1ª vez)
#   ./dev-stack.sh start    # sobe auth(5000) + engines(4001/2/3) + gateway(3000)
#   ./dev-stack.sh status   # mostra o que está no ar
#   ./dev-stack.sh stop     # derruba tudo e libera as portas
#
# Depois de 'start', rode o harness:   cd load-test && node run.js
# Para jogar no navegador:  python3 -m http.server 8080 --directory frontend
# ==========================================================================
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRET="${JWT_SECRET:-dev-spaceship-secret-troque-em-prod-32chars}"
AUTH_URL="http://localhost:5000/api/auth"
LOG_DIR="${TMPDIR:-/tmp}/spaceship-dev"
TCP_PORTS="5000 4001 4002 4003 3000"
ALL_PORTS="$TCP_PORTS"

up_count() { ss -ltn 2>/dev/null | grep -Ec ':(5000|4001|4002|4003|3000)\b' || true; }

deps() {
  for d in auth-service-lite game-engine game-gateway load-test; do
    echo "== npm install em $d =="
    ( cd "$ROOT/$d" && npm install --no-audit --no-fund )
  done
}

start() {
  if [ "$(up_count)" -ge 5 ]; then echo "stack já parece no ar (use 'status' ou 'stop')."; status; return 0; fi
  for d in auth-service-lite game-engine game-gateway; do
    [ -d "$ROOT/$d/node_modules" ] || { echo "[!] $d/node_modules ausente — rode antes: ./dev-stack.sh deps"; exit 1; }
  done
  mkdir -p "$LOG_DIR"
  echo "Subindo stack lite (segredo=dev; logs em $LOG_DIR)…"
  JWT_SECRET="$SECRET" AUTH_PORT=5000 nohup node "$ROOT/auth-service-lite/server.js" >"$LOG_DIR/auth.log" 2>&1 &
  JWT_SECRET="$SECRET" GAME=jogo1 PORT=4001 AUTH_API_URL="$AUTH_URL" nohup node "$ROOT/game-engine/server.js" >"$LOG_DIR/engine-jogo1.log" 2>&1 &
  JWT_SECRET="$SECRET" GAME=jogo2 PORT=4002 AUTH_API_URL="$AUTH_URL" nohup node "$ROOT/game-engine/server.js" >"$LOG_DIR/engine-jogo2.log" 2>&1 &
  JWT_SECRET="$SECRET" GAME=jogo3 PORT=4003 AUTH_API_URL="$AUTH_URL" nohup node "$ROOT/game-engine/server.js" >"$LOG_DIR/engine-jogo3.log" 2>&1 &
  JWT_SECRET="$SECRET" ENGINE1_URL=http://localhost:4001 ENGINE2_URL=http://localhost:4002 ENGINE3_URL=http://localhost:4003 \
    nohup node "$ROOT/game-gateway/index.js" >"$LOG_DIR/gateway.log" 2>&1 &
  for _ in $(seq 1 60); do [ "$(up_count)" -ge 5 ] && break; sleep 0.2; done
  status
  echo "Pronto. Harness:  cd load-test && node run.js     |    parar:  ./dev-stack.sh stop"
}

stop() {
  for p in $ALL_PORTS; do fuser -k "$p/tcp" >/dev/null 2>&1 || true; done
  echo "stack lite derrubada."
}

status() {
  echo "Portas:"
  for p in $TCP_PORTS; do
    if ss -ltn 2>/dev/null | grep -q ":$p\b"; then echo "  :$p  UP"; else echo "  :$p  --"; fi
  done
}

case "${1:-}" in
  deps) deps ;;
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "uso: ./dev-stack.sh {deps|start|status|stop}"; exit 1 ;;
esac
