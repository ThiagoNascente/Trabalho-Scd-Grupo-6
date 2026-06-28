#!/usr/bin/env bash
# ==========================================================================
# deploy-all.sh — ORQUESTRADOR do deploy AWS a partir de UMA 7ª máquina.
#
# Rode ESTE script na 7ª EC2 (a orquestradora). Ele:
#   1) lê deploy/aws/maquinas.aws (a lista das 6 EC2 — só o *_SSH é obrigatório);
#   2) conecta nas 6 por SSH e DESCOBRE o IP privado + o DNS público de cada uma;
#   3) GERA o deploy/aws/env.aws completo (mesmo mapa do env.aws.example);
#   4) SINCRONIZA o código (rsync, em paralelo) e copia o env.aws para as 6;
#   5) RODA o deployN.sh certo em cada máquina, na ordem:
#         data1 -> data2 -> app (em série)  e  engine1|engine2|engine3 (paralelo).
#
# É idempotente: pode rodar de novo à vontade (cada deployN.sh já é idempotente,
# e os segredos do env.aws são reaproveitados entre execuções).
#
#   bash deploy/aws/deploy-all.sh                 # deploy completo das 6
#   bash deploy/aws/deploy-all.sh --dry-run       # só mostra o plano, não mexe em nada
#   bash deploy/aws/deploy-all.sh --yes           # não pergunta "continuar?"
#   bash deploy/aws/deploy-all.sh --roles=engine2 # re-deploya só uma (as deps já no ar)
#   bash deploy/aws/deploy-all.sh --skip-sync     # não re-sincroniza o código
#
# Pré-requisitos NA 7ª máquina: ssh, rsync, openssl, e a chave .pem das EC2.
# Alvo das 6 máquinas: Ubuntu 22.04/24.04 (mesmo dos deployN.sh).
# ==========================================================================
set -euo pipefail

# --- cores / logs -------------------------------------------------------------
c() { printf '\033[%sm' "$1"; }
log()  { echo -e "$(c '1;36')[deploy-all]$(c 0) $*"; }
ok()   { echo -e "$(c '1;32')[ok]$(c 0) $*"; }
warn() { echo -e "$(c '1;33')[aviso]$(c 0) $*" >&2; }
err()  { echo -e "$(c '1;31')[erro]$(c 0) $*" >&2; }
die()  { err "$*"; exit 1; }
hr()   { echo -e "$(c '1;30')────────────────────────────────────────────────────────$(c 0)"; }

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# --- argumentos ---------------------------------------------------------------
DRY_RUN=0; ASSUME_YES=0; SKIP_SYNC=0; ONLY_ROLES=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --yes|-y)     ASSUME_YES=1 ;;
    --skip-sync)  SKIP_SYNC=1 ;;
    --roles=*)    ONLY_ROLES="${arg#*=}" ;;
    -h|--help)    usage 0 ;;
    *) die "argumento desconhecido: $arg  (use --help)";;
  esac
done

[ "${BASH_VERSINFO:-0}" -ge 4 ] || die "precisa de bash 4+ (use 'bash deploy/aws/deploy-all.sh')."

# --- diretórios / inventário --------------------------------------------------
AWS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$AWS_DIR/../.." && pwd)"
INVENTORY="$AWS_DIR/maquinas.aws"
ENVAWS="$AWS_DIR/env.aws"
LOGDIR="$AWS_DIR/.deploy-logs"
mkdir -p "$LOGDIR"

[ -f "$INVENTORY" ] || die "não achei $INVENTORY — copie de maquinas.aws.example e preencha:
    cp deploy/aws/maquinas.aws.example deploy/aws/maquinas.aws"

# defaults (caso o usuário apague linhas do inventário)
SSH_USER=ubuntu; REMOTE_DIR=Trabalho-Scd-Grupo-6; VPC_CIDR=172.31.0.0/16
JWT_SECRET=""; POSTGRES_PASSWORD=""; PG_REPL_PASSWORD=""; SSH_KEY=""
# shellcheck disable=SC1090
set -a; . "$INVENTORY"; set +a

[ -n "$SSH_KEY" ] || die "preencha SSH_KEY em $INVENTORY (caminho da chave .pem)."
KEY="${SSH_KEY/#\~/$HOME}"
[ -f "$KEY" ] || die "chave SSH não encontrada: $KEY  (confira SSH_KEY em maquinas.aws)."
# Chave .pem precisa ser privada, senão o ssh recusa. Ajusta sem reclamar.
perms="$(stat -c '%a' "$KEY" 2>/dev/null || echo '')"
case "$perms" in 600|400) ;; *) chmod 600 "$KEY" 2>/dev/null && warn "ajustei as permissões da chave para 600 ($KEY).";; esac

for bin in ssh openssl; do command -v "$bin" >/dev/null 2>&1 || die "falta '$bin' nesta 7ª máquina (instale: sudo apt-get install -y openssh-client openssl)."; done
if [ "$SKIP_SYNC" -eq 0 ]; then command -v rsync >/dev/null 2>&1 || die "falta 'rsync' nesta 7ª máquina (sudo apt-get install -y rsync) — ou use --skip-sync."; fi

# --- mapas dos papéis ---------------------------------------------------------
ROLES_ORDER=(data1 data2 app engine1 engine2 engine3)
declare -A ROLE_SCRIPT=( [data1]=deploy1.sh [data2]=deploy2.sh [app]=deploy3.sh
                         [engine1]=deploy4.sh [engine2]=deploy5.sh [engine3]=deploy6.sh )
declare -A ROLE_DESC=( [data1]="PostgreSQL primário + Redis"
                       [data2]="Kafka + PostgreSQL réplica"
                       [app]="Auth + Gateway + Score + Frontend"
                       [engine1]="Game Engine jogo1" [engine2]="Game Engine jogo2" [engine3]="Game Engine jogo3" )
# Campo do env.aws que guarda o IP privado de cada papel (fallback de descoberta).
declare -A ROLE_PRIV_FIELD=( [data1]=PG_HOST_PRIVATE [data2]=KAFKA_HOST_PRIVATE [app]=AUTH_HOST_PRIVATE
                             [engine1]=ENGINE1_HOST_PRIVATE [engine2]=ENGINE2_HOST_PRIVATE [engine3]=ENGINE3_HOST_PRIVATE )

# --- opções de SSH/rsync ------------------------------------------------------
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10
          -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4)
RSYNC_SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes"
RSYNC_EXCLUDES=(--exclude='.git/' --exclude='node_modules/' --exclude='**/node_modules/'
  --exclude='**/bin/' --exclude='**/obj/' --exclude='.venv/' --exclude='venv/'
  --exclude='__pycache__/' --exclude='*.pyc' --exclude='.env'
  --exclude='deploy/aws/maquinas.aws' --exclude='deploy/aws/.deploy-logs/' --exclude='*.pem')

# --- helpers ------------------------------------------------------------------
getvar()  { printf '%s' "${!1:-}"; }                      # lê var do inventário por nome
upper()   { printf '%s' "${1^^}"; }
is_ip()   { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; }
prior()   { [ -f "$ENVAWS" ] && { grep "^$1=" "$ENVAWS" 2>/dev/null | head -n1 | cut -d= -f2-; } || true; }
sshc()    { ssh "${SSH_OPTS[@]}" "$SSH_USER@$1" "${@:2}"; }

# Pergunta para a própria EC2 (metadata, IMDSv2 com fallback v1) o IP privado e o
# DNS público. Devolve duas linhas: PRIV=... e PUB=...
read_meta() {
  ssh "${SSH_OPTS[@]}" -T "$SSH_USER@$1" 'bash -s' <<'REMOTE'
T=$(curl -fsS -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 120" 2>/dev/null || true)
H=(); [ -n "$T" ] && H=(-H "X-aws-ec2-metadata-token: $T")
PRIV=$(curl -fsS "${H[@]}" http://169.254.169.254/latest/meta-data/local-ipv4 2>/dev/null || true)
[ -z "$PRIV" ] && PRIV=$(hostname -I 2>/dev/null | awk '{print $1}')
PUB=$(curl -fsS "${H[@]}" http://169.254.169.254/latest/meta-data/public-hostname 2>/dev/null || true)
printf 'PRIV=%s\nPUB=%s\n' "$PRIV" "$PUB"
REMOTE
}

# --- papéis selecionados (--roles) -------------------------------------------
declare -A SELECTED
if [ -n "$ONLY_ROLES" ]; then
  for r in ${ONLY_ROLES//,/ }; do
    [ -n "${ROLE_SCRIPT[$r]:-}" ] || die "papel inválido em --roles: '$r' (use: ${ROLES_ORDER[*]})."
    SELECTED[$r]=1
  done
else
  for r in "${ROLES_ORDER[@]}"; do SELECTED[$r]=1; done
fi
is_selected() { [ -n "${SELECTED[$1]:-}" ]; }

# --- descoberta dos endereços das 6 ------------------------------------------
declare -A SSHHOST PRIV PUB CONN
log "conectando nas máquinas e descobrindo os endereços (IP privado / DNS público)…"
for role in "${ROLES_ORDER[@]}"; do
  PREFIX="$(upper "$role")"
  host="$(getvar "${PREFIX}_SSH")"
  [ -n "$host" ] || die "preencha ${PREFIX}_SSH em maquinas.aws (como conectar na máquina '$role')."
  SSHHOST[$role]="$host"

  meta=""; CONN[$role]=0
  if meta="$(read_meta "$host" 2>/dev/null)"; then CONN[$role]=1; fi
  d_priv="$(printf '%s\n' "$meta" | sed -n 's/^PRIV=//p' | head -n1)"
  d_pub="$( printf '%s\n' "$meta" | sed -n 's/^PUB=//p'  | head -n1)"

  # IP privado: explícito no inventário > descoberto > env.aws anterior
  ip="$(getvar "${PREFIX}_PRIVATE_IP")"; ip="${ip:-$d_priv}"; ip="${ip:-$(prior "${ROLE_PRIV_FIELD[$role]}")}"
  [ -n "$ip" ] || die "não descobri o IP privado de '$role' ($host). Preencha ${PREFIX}_PRIVATE_IP em maquinas.aws."
  PRIV[$role]="$ip"

  # DNS público: só a app precisa. explícito > descoberto > (se *_SSH for DNS) o próprio host > env.aws anterior
  if [ "$role" = app ]; then
    pub="$(getvar APP_PUBLIC_DNS)"; pub="${pub:-$d_pub}"
    { [ -z "$pub" ] && ! is_ip "$host"; } && pub="$host"
    pub="${pub:-$(prior AUTH_HOST_PUBLIC)}"
    [ -n "$pub" ] || die "não descobri o DNS público da app. Preencha APP_PUBLIC_DNS em maquinas.aws."
    PUB[$role]="$pub"
  fi

  if [ "${CONN[$role]}" -eq 1 ]; then ok "  $role  ($host)  privado=${PRIV[$role]}${PUB[$role]:+  público=${PUB[$role]}}"
  else warn "  $role  ($host)  SEM conexão SSH — usando endereço salvo (${PRIV[$role]})"; fi
done

# --- plano --------------------------------------------------------------------
hr
log "PLANO DE DEPLOY (7ª máquina -> 6 EC2)"
printf '   %-9s %-26s %-13s %s\n' "papel" "ssh" "script" "o que sobe"
for role in "${ROLES_ORDER[@]}"; do
  mark="  "; is_selected "$role" && mark="$(c '1;32')▶$(c 0) "
  printf '   %b%-7s %-26s %-13s %s\n' "$mark" "$role" "${SSHHOST[$role]}" "${ROLE_SCRIPT[$role]}" "${ROLE_DESC[$role]}"
done
echo
log "ordem: data1 → data2 → app (em série) ; engines em paralelo"
[ "$SKIP_SYNC" -eq 1 ] && warn "--skip-sync: o código NÃO será re-sincronizado (só env.aws + deploy)."
[ -n "$ONLY_ROLES" ]   && warn "--roles=$ONLY_ROLES: as dependências precisam já estar no ar."

if [ "$DRY_RUN" -eq 1 ]; then hr; log "--dry-run: nada foi alterado. env.aws NÃO foi escrito."; exit 0; fi

# Para as máquinas que VAMOS mexer, a conexão SSH é obrigatória (no deploy real).
for role in "${ROLES_ORDER[@]}"; do
  is_selected "$role" || continue
  [ "${CONN[$role]}" -eq 1 ] || die "não conectei em '$role' (${SSHHOST[$role]}). Confira o *_SSH, a chave, e a porta 22 no Security Group."
done

if [ "$ASSUME_YES" -eq 0 ]; then
  hr; printf "%b" "$(c '1;33')Continuar e fazer o deploy? [y/N] $(c 0)"
  read -r ans || true
  case "${ans:-}" in y|Y|s|S|yes|sim) ;; *) die "cancelado pelo usuário.";; esac
fi

# --- gera o env.aws -----------------------------------------------------------
# Segredos: inventário > env.aws anterior > gera agora (e fica salvo no env.aws).
gen_secret() { openssl rand -base64 48 | tr -d '\n'; }
gen_pw()     { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32; }
JWT_SECRET="${JWT_SECRET:-$(prior JWT_SECRET)}";             JWT_SECRET="${JWT_SECRET:-$(gen_secret)}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(prior POSTGRES_PASSWORD)}"; POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(gen_pw)}"
PG_REPL_PASSWORD="${PG_REPL_PASSWORD:-$(prior PG_REPL_PASSWORD)}";   PG_REPL_PASSWORD="${PG_REPL_PASSWORD:-$(gen_pw)}"

log "gerando $ENVAWS …"
umask 077
cat > "$ENVAWS" <<EOF
# GERADO por deploy/aws/deploy-all.sh em $(date '+%Y-%m-%d %H:%M:%S') — NÃO edite à mão.
# (Re-rode o deploy-all.sh para regenerar; os segredos abaixo são reaproveitados.)

# --- Segredos (iguais em todas as máquinas) ---
JWT_SECRET=${JWT_SECRET}

# --- PostgreSQL (primário na data1; réplica na data2) ---
POSTGRES_USER=postgres
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=authdb
PG_PORT=5432
PG_HOST_PRIVATE=${PRIV[data1]}
PG_REPL_USER=replicador
PG_REPL_PASSWORD=${PG_REPL_PASSWORD}
PG_REPLICA_HOST_PRIVATE=${PRIV[data2]}
VPC_CIDR=${VPC_CIDR}

# --- Redis (na data1) ---
REDIS_PORT=6379
REDIS_HOST_PRIVATE=${PRIV[data1]}

# --- Kafka (na data2) ---
KAFKA_PORT=9092
KAFKA_HOST_PRIVATE=${PRIV[data2]}
MATCH_TOPIC=match-completed

# --- Auth Service (na app) ---
AUTH_PORT=5000
AUTH_GRPC_PORT=5005
AUTH_HOST_PRIVATE=${PRIV[app]}
AUTH_HOST_PUBLIC=${PUB[app]}

# --- Gateway (na app) ---
GATEWAY_PORT=3000
GATEWAY_HOST_PUBLIC=${PUB[app]}

# --- Game Engines (deploy4/5/6) ---
ENGINE1_HOST_PRIVATE=${PRIV[engine1]}
ENGINE2_HOST_PRIVATE=${PRIV[engine2]}
ENGINE3_HOST_PRIVATE=${PRIV[engine3]}

# --- Score Service (na app) ---
SCORE_PORT=8000
SCORE_HOST_PUBLIC=${PUB[app]}

# --- Frontend (na app) ---
FRONTEND_PORT=80
EOF
umask 022
ok "env.aws gerado (será copiado igual para as 6 máquinas)."

# --- sincroniza código + env.aws (em paralelo) -------------------------------
sync_job() {
  local role="$1" host="${SSHHOST[$1]}"
  {
    sshc "$host" "mkdir -p '$REMOTE_DIR'; command -v rsync >/dev/null 2>&1 || { sudo -n apt-get update -y && sudo -n apt-get install -y rsync; }"
    rsync -az -e "$RSYNC_SSH" "${RSYNC_EXCLUDES[@]}" "$REPO_ROOT/" "$SSH_USER@$host:$REMOTE_DIR/"
  } >"$LOGDIR/sync-$role.log" 2>&1
}
# Mesmo com --skip-sync, garantimos o env.aws atualizado em cada máquina.
push_env_job() {
  local role="$1" host="${SSHHOST[$1]}"
  { sshc "$host" "mkdir -p '$REMOTE_DIR/deploy/aws'"
    rsync -az -e "$RSYNC_SSH" "$ENVAWS" "$SSH_USER@$host:$REMOTE_DIR/deploy/aws/env.aws"
  } >"$LOGDIR/sync-$role.log" 2>&1
}

run_jobs() { # $1 = função ; resto = papéis. Retorna 1 se algum falhar.
  local fn="$1"; shift; local -A jp=(); local pid rc=0
  for it in "$@"; do "$fn" "$it" & jp[$!]="$it"; done
  for pid in "${!jp[@]}"; do
    if ! wait "$pid"; then err "  ✗ ${jp[$pid]} falhou (log em $LOGDIR/)"; rc=1; fi
  done
  return $rc
}

SYNC_TARGETS=(); for r in "${ROLES_ORDER[@]}"; do is_selected "$r" && SYNC_TARGETS+=("$r"); done
hr
if [ "$SKIP_SYNC" -eq 1 ]; then
  log "copiando o env.aws para as máquinas (--skip-sync: sem reenviar o código)…"
  run_jobs push_env_job "${SYNC_TARGETS[@]}" || die "falha ao copiar o env.aws — veja os logs em $LOGDIR/."
else
  log "sincronizando o código + env.aws nas máquinas (rsync, em paralelo)…"
  run_jobs sync_job "${SYNC_TARGETS[@]}" || die "falha no rsync — veja os logs em $LOGDIR/."
fi
ok "código/config no lugar nas máquinas: ${SYNC_TARGETS[*]}"

# --- roda os deploys ----------------------------------------------------------
ssh_deploy() { ssh "${SSH_OPTS[@]}" "$SSH_USER@${SSHHOST[$1]}" "cd '$REMOTE_DIR' && sudo -n bash deploy/aws/${ROLE_SCRIPT[$1]}"; }

deploy_serial() {
  local role="$1"
  hr; log "→ deploy [$role] em ${SSHHOST[$role]} — ${ROLE_DESC[$role]} (${ROLE_SCRIPT[$role]})"
  set +e; ssh_deploy "$role" 2>&1 | tee "$LOGDIR/deploy-$role.log"; local rc=${PIPESTATUS[0]}; set -e
  [ "$rc" -eq 0 ] || die "deploy [$role] FALHOU (rc=$rc). Veja: $LOGDIR/deploy-$role.log"
  ok "deploy [$role] no ar."
}
deploy_engine_job() { ssh_deploy "$1" >"$LOGDIR/deploy-$1.log" 2>&1; }

# 1) cadeia de estado, EM SÉRIE e nesta ordem (réplica depende do primário; app depois)
for role in data1 data2 app; do is_selected "$role" && deploy_serial "$role"; done

# 2) engines EM PARALELO (particionamento funcional — um não depende do outro)
engines=(); for role in engine1 engine2 engine3; do is_selected "$role" && engines+=("$role"); done
FAILED=0
if [ "${#engines[@]}" -gt 0 ]; then
  hr; log "→ deploy dos engines em paralelo: ${engines[*]}"
  if run_jobs deploy_engine_job "${engines[@]}"; then ok "engines no ar: ${engines[*]}"
  else err "algum engine falhou (logs em $LOGDIR/deploy-engine*.log)"; FAILED=1; fi
fi

# --- resumo + smoke test ------------------------------------------------------
hr
if is_selected app; then
  APP_PUB="${PUB[app]}"
  log "smoke test rápido em http://$APP_PUB …"
  code() { curl -m 6 -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || echo "---"; }
  echo "   frontend (80)  -> $(code "http://$APP_PUB")"
  echo "   auth     (5000)-> $(code "http://$APP_PUB:5000/api/auth/wins/x")   (404 = no ar)"
  echo "   gateway  (3000)-> $(code "http://$APP_PUB:3000/socket.io/")        (400 = no ar)"
  echo "   score    (8000)-> $(code "http://$APP_PUB:8000/health")"
  echo
  log "Abra o jogo:  $(c '1;37')http://$APP_PUB$(c 0)"
fi
if [ "$FAILED" -eq 0 ]; then ok "DEPLOY CONCLUÍDO. Logs por máquina em: $LOGDIR/";
else die "deploy terminou com falhas — confira os logs em $LOGDIR/."; fi
