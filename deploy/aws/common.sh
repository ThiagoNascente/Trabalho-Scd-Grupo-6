# ==========================================================================
# common.sh — funções e variáveis compartilhadas pelos scripts de deploy AWS.
# É SOURCED pelos scripts de serviço (NÃO execute direto).
#
# Alvo: Ubuntu Server 22.04/24.04 LTS (apt + systemd). Para Amazon Linux troque
# `apt-get` por `dnf` e os nomes dos pacotes (ver o Guia de Deploy AWS).
# ==========================================================================

SPACESHIP_AWS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SPACESHIP_AWS_DIR/../.." && pwd)"

# Carrega a config da máquina (copie env.aws.example -> env.aws e preencha).
if [ -f "$SPACESHIP_AWS_DIR/env.aws" ]; then
  set -a; . "$SPACESHIP_AWS_DIR/env.aws"; set +a
else
  echo "[aviso] $SPACESHIP_AWS_DIR/env.aws não encontrado — copie de env.aws.example e preencha." >&2
fi

log()  { echo -e "\033[1;36m[spaceship]\033[0m $*"; }
warn() { echo -e "\033[1;33m[aviso]\033[0m $*" >&2; }
die()  { echo -e "\033[1;31m[erro]\033[0m $*" >&2; exit 1; }

# Garante execução como root (os scripts instalam pacotes / mexem em systemd).
need_root() { [ "$(id -u)" -eq 0 ] || die "rode com sudo:  sudo bash $0 $*"; }

# Falha cedo se faltar alguma variável obrigatória.
require_env() {
  local missing=0 v
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then warn "variável '$v' vazia (preencha em env.aws)"; missing=1; fi
  done
  [ "$missing" -eq 0 ] || die "configure as variáveis acima em $SPACESHIP_AWS_DIR/env.aws"
}

# Defaults de portas (caso o env.aws não os traga).
: "${PG_PORT:=5432}"
: "${REDIS_PORT:=6379}"
: "${KAFKA_PORT:=9092}"
: "${AUTH_PORT:=5000}"
: "${AUTH_GRPC_PORT:=5005}"
: "${SCORE_PORT:=8000}"
: "${GATEWAY_PORT:=3000}"
: "${FRONTEND_PORT:=80}"
: "${MATCH_TOPIC:=match-completed}"

# Endereços COMPOSTOS derivados dos hosts privados (backend↔backend).
REDIS_URL_DERIVED="redis://${REDIS_HOST_PRIVATE:-localhost}:${REDIS_PORT}/0"
KAFKA_BROKER_DERIVED="${KAFKA_HOST_PRIVATE:-localhost}:${KAFKA_PORT}"
AUTH_API_URL_DERIVED="http://${AUTH_HOST_PRIVATE:-localhost}:${AUTH_PORT}/api/auth"
AUTH_GRPC_URL_DERIVED="${AUTH_HOST_PRIVATE:-localhost}:${AUTH_GRPC_PORT}"

# Instala Node.js 20 (NodeSource) se ainda não houver.
ensure_node() {
  if command -v node >/dev/null 2>&1; then log "Node já instalado ($(node -v))."; return; fi
  log "instalando Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
}

# Instala o .NET SDK 8 (script oficial, sem conflito de repositório apt) se faltar.
ensure_dotnet() {
  if command -v dotnet >/dev/null 2>&1; then log "dotnet já instalado ($(dotnet --version))."; return; fi
  log "instalando .NET SDK 8…"
  curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 8.0 --install-dir /usr/share/dotnet
  ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
}

# Cria/atualiza um serviço systemd, habilita no boot e sobe. Mostra o status.
install_systemd_unit() {
  local name="$1" unit_text="$2"
  printf '%s\n' "$unit_text" > "/etc/systemd/system/${name}.service"
  systemctl daemon-reload
  systemctl enable "$name" >/dev/null 2>&1 || true
  systemctl restart "$name"
  sleep 1
  systemctl --no-pager --full status "$name" | head -n 12 || true
  log "OK — '$name' no ar. Logs:  sudo journalctl -u $name -f"
}
