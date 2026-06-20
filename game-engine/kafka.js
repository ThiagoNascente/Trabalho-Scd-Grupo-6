// ==========================================================================
// PRODUTOR KAFKA do Game Engine (item 4 — interação assíncrona / pub-sub).
//
// Ao fim de cada partida o engine publica um evento `match-completed` no tópico
// Kafka; o Score Service (Python) consome e materializa o ranking (Redis +
// PostgreSQL). A entrega ao Score é DESACOPLADA do jogo: o engine só publica.
//
// Tolerância a falha (Consistência Eventual):
//  - Conexão PREGUIÇOSA e RESILIENTE: o Kafka costuma ficar pronto DEPOIS dos
//    engines no boot do compose. Por isso não desistimos da conexão no boot —
//    `ensureProducer` reconecta sob demanda e a cada publicação que falhar,
//    espelhando o loop de reconexão do consumidor. Assim, quando o Kafka sobe,
//    a próxima partida já publica (antes, uma falha no boot desativava a
//    publicação PARA SEMPRE — bug do 1º E2E).
//  - Se o broker estiver fora, `publishMatchCompleted` vira no-op e NUNCA lança
//    (a partida não quebra — fallback).
//  - Com o Score parado mas o broker no ar, o Kafka RETÉM as mensagens.
//
// Nada chumbado: broker e tópico vêm de variável de ambiente. Sem KAFKA_BROKER
// a publicação fica desativada (modo DEV/sem-Docker, sem regressão).
// ==========================================================================
const BROKER = process.env.KAFKA_BROKER;                 // ex.: 'kafka:29092' (vazio => desativado)
const TOPIC = process.env.MATCH_TOPIC || 'match-completed';
const CLIENT_ID = process.env.KAFKA_CLIENT_ID || `game-engine-${process.env.GAME || 'x'}`;
// Retries da conexão: generosos para cobrir o Kafka subindo depois do engine.
const RETRIES = parseInt(process.env.KAFKA_RETRIES || '8', 10);

let producer = null;     // produtor conectado (ou null)
let connecting = null;   // Promise de conexão em andamento (evita conexões concorrentes)

function buildProducer() {
  const { Kafka, logLevel } = require('kafkajs');
  const kafka = new Kafka({
    clientId: CLIENT_ID,
    brokers: BROKER.split(',').map(b => b.trim()).filter(Boolean),
    logLevel: logLevel.NOTHING,
    retry: { retries: RETRIES, initialRetryTime: 300, maxRetryTime: 30000 },
  });
  return kafka.producer();
}

// Garante um produtor conectado, tolerando o Kafka subir depois. Nunca lança;
// retorna o produtor conectado ou null (broker indisponível no momento).
async function ensureProducer() {
  if (!BROKER) return null;
  if (producer) return producer;
  if (!connecting) {
    const p = buildProducer();
    connecting = p.connect()
      .then(() => {
        producer = p;
        console.log(`[kafka] produtor conectado em ${BROKER} (tópico '${TOPIC}').`);
        return p;
      })
      .catch((err) => {
        console.error(`[kafka] conexão falhou (${err.message}); tentará de novo na próxima publicação.`);
        return null;
      })
      .finally(() => { connecting = null; });
  }
  return connecting;
}

// Publica um evento de fim de partida. NUNCA lança: tolerância a falha — uma
// falha de publicação não pode afetar o gameplay. Retorna true se publicou.
async function publishMatchCompleted(payload) {
  if (!BROKER) return false;
  const p = await ensureProducer();
  if (!p) return false;
  try {
    await p.send({
      topic: TOPIC,
      messages: [{ key: String(payload.game || ''), value: JSON.stringify(payload) }],
    });
    return true;
  } catch (err) {
    console.error(`[kafka] falha ao publicar match-completed (${err.message}); reconectará.`);
    // A conexão pode ter caído: força reconexão na próxima publicação.
    if (producer === p) producer = null;
    try { await p.disconnect(); } catch (_) { /* ignore */ }
    return false;
  }
}

async function init() {
  if (!BROKER) {
    console.log('[kafka] KAFKA_BROKER não definido; publicação de eventos desativada (sem regressão).');
    return;
  }
  // Dispara a conexão em background (não bloqueia o boot do engine, não lança).
  ensureProducer();
}

async function shutdown() {
  if (producer) { try { await producer.disconnect(); } catch (_) { /* ignore */ } producer = null; }
}

module.exports = { init, publishMatchCompleted, shutdown };
