// ==========================================================================
// PRODUTOR KAFKA do Game Engine (item 4 — interação assíncrona / pub-sub).
//
// Ao fim de cada partida o engine publica um evento `match-completed` no tópico
// Kafka; o Score Service (Python) consome e materializa o ranking (Redis +
// PostgreSQL). A entrega ao Score é DESACOPLADA do jogo: o engine só publica.
//
// Tolerância a falha (Consistência Eventual):
//  - Se o broker estiver fora do ar, a inicialização falha em silêncio e
//    `publishMatchCompleted` vira no-op (a partida NÃO quebra — fallback).
//  - Se o broker estiver no ar mas o Score Service estiver parado, o Kafka
//    RETÉM as mensagens; quando o Score sobe, consome o que ficou pendente.
//
// Nada chumbado: broker e tópico vêm de variável de ambiente. Sem KAFKA_BROKER
// a publicação fica desativada (modo DEV/sem-Docker, sem regressão).
// ==========================================================================
const BROKER = process.env.KAFKA_BROKER;                 // ex.: 'kafka:29092' (vazio => desativado)
const TOPIC = process.env.MATCH_TOPIC || 'match-completed';
const CLIENT_ID = process.env.KAFKA_CLIENT_ID || `game-engine-${process.env.GAME || 'x'}`;

let producer = null;
let available = false;

async function init() {
  if (!BROKER) {
    console.log('[kafka] KAFKA_BROKER não definido; publicação de eventos desativada (sem regressão).');
    return;
  }
  try {
    const { Kafka, logLevel } = require('kafkajs');
    const kafka = new Kafka({
      clientId: CLIENT_ID,
      brokers: BROKER.split(',').map(b => b.trim()).filter(Boolean),
      logLevel: logLevel.NOTHING,
      retry: { retries: 3 },
    });
    producer = kafka.producer();
    await producer.connect();
    available = true;
    console.log(`[kafka] produtor conectado em ${BROKER} (tópico '${TOPIC}').`);
  } catch (err) {
    available = false;
    console.error(`[kafka] indisponível (${err.message}); seguindo sem publicar (fallback).`);
  }
}

// Publica um evento de fim de partida. NUNCA lança: tolerância a falha — uma
// falha de publicação não pode afetar o gameplay. Retorna true se publicou.
async function publishMatchCompleted(payload) {
  if (!producer || !available) return false;
  try {
    await producer.send({
      topic: TOPIC,
      messages: [{ key: String(payload.game || ''), value: JSON.stringify(payload) }],
    });
    return true;
  } catch (err) {
    console.error(`[kafka] falha ao publicar match-completed (${err.message}).`);
    return false;
  }
}

async function shutdown() {
  if (producer && available) { try { await producer.disconnect(); } catch (_) { /* ignore */ } }
}

module.exports = { init, publishMatchCompleted, shutdown };
