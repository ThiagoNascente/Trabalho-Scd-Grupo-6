#!/usr/bin/env bash
# ==========================================================================
# kafka.sh — Apache Kafka NATIVO em modo KRaft (SEM Zookeeper), nó único.
# Publica/consome o tópico 'match-completed' (itens 4/5). Alvo: Ubuntu 22.04/24.04.
#   sudo bash kafka.sh
# Requer KAFKA_HOST_PRIVATE no env.aws (advertised.listeners = esse IP privado).
# ==========================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$SCRIPT_DIR/../common.sh"
need_root "$@"
require_env KAFKA_HOST_PRIVATE

KAFKA_VERSION="${KAFKA_VERSION:-3.7.1}"; SCALA="${SCALA_VERSION:-2.13}"
KDIR="/opt/kafka"; LOGDIR="/var/lib/kafka-logs"

log "instalando Java (requisito do Kafka)…"
apt-get update -y
apt-get install -y default-jre-headless wget

if [ ! -d "/opt/kafka_${SCALA}-${KAFKA_VERSION}" ]; then
  log "baixando Kafka ${KAFKA_VERSION}…"
  wget -q "https://archive.apache.org/dist/kafka/${KAFKA_VERSION}/kafka_${SCALA}-${KAFKA_VERSION}.tgz" -O /tmp/kafka.tgz
  tar -xzf /tmp/kafka.tgz -C /opt
fi
ln -sfn "/opt/kafka_${SCALA}-${KAFKA_VERSION}" "$KDIR"
mkdir -p "$LOGDIR"

CFG="$KDIR/config/spaceship-kraft.properties"
cat > "$CFG" <<EOF
process.roles=broker,controller
node.id=1
controller.quorum.voters=1@${KAFKA_HOST_PRIVATE}:9093
listeners=PLAINTEXT://0.0.0.0:${KAFKA_PORT},CONTROLLER://0.0.0.0:9093
advertised.listeners=PLAINTEXT://${KAFKA_HOST_PRIVATE}:${KAFKA_PORT}
controller.listener.names=CONTROLLER
inter.broker.listener.name=PLAINTEXT
listener.security.protocol.map=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
log.dirs=${LOGDIR}
offsets.topic.replication.factor=1
transaction.state.log.replication.factor=1
transaction.state.log.min.isr=1
num.partitions=1
EOF

# Formata o storage do KRaft apenas na primeira vez.
if [ ! -f "${LOGDIR}/meta.properties" ]; then
  CID="$("$KDIR/bin/kafka-storage.sh" random-uuid)"
  "$KDIR/bin/kafka-storage.sh" format -t "$CID" -c "$CFG"
fi

install_systemd_unit "spaceship-kafka" "[Unit]
Description=Spaceship Kafka (KRaft)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${KDIR}/bin/kafka-server-start.sh ${CFG}
ExecStop=${KDIR}/bin/kafka-server-stop.sh
Restart=on-failure
RestartSec=5
LimitNOFILE=100000

[Install]
WantedBy=multi-user.target"

# Cria o tópico do jogo (idempotente). Pode falhar se o broker ainda estabiliza.
sleep 6
"$KDIR/bin/kafka-topics.sh" --bootstrap-server "${KAFKA_HOST_PRIVATE}:${KAFKA_PORT}" \
  --create --if-not-exists --topic "${MATCH_TOPIC}" --partitions 1 --replication-factor 1 \
  || warn "não criou o tópico ainda — rode de novo em alguns segundos: $KDIR/bin/kafka-topics.sh --bootstrap-server ${KAFKA_HOST_PRIVATE}:${KAFKA_PORT} --create --if-not-exists --topic ${MATCH_TOPIC} --partitions 1 --replication-factor 1"
log "Kafka no ar em ${KAFKA_HOST_PRIVATE}:${KAFKA_PORT} (tópico '${MATCH_TOPIC}')."
