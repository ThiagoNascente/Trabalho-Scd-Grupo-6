# ==========================================================================
# Consumidor Kafka do Score Service (item 4 — pub/sub assíncrono).
#
# Roda em uma thread de fundo. Lê o tópico `match-completed`, persiste cada
# partida (Redis + PostgreSQL) e SÓ ENTÃO confirma o offset (commit manual).
#
# Tolerância a falha / Consistência Eventual:
#  - enable_auto_commit=False + commit após persistir => nenhuma mensagem é
#    marcada como consumida antes de ser gravada (at-least-once).
#  - auto_offset_reset='earliest' + group_id fixo => ao (re)subir, o serviço
#    retoma do último offset confirmado e processa o que o Kafka reteve enquanto
#    o Score esteve parado.
#  - Qualquer erro de broker/Redis/PG: loga, faz backoff e tenta reconectar,
#    sem derrubar o processo (o servidor REST continua de pé).
# ==========================================================================
import json
import logging
import time

log = logging.getLogger("score.consumer")


def run_consumer(store, cfg, stop_event):
    if not cfg.kafka_enabled:
        log.warning("KAFKA_BROKER não definido; consumidor desativado (apenas REST de leitura).")
        return

    backoff = 1.0
    while not stop_event.is_set():
        consumer = None
        try:
            from kafka import KafkaConsumer  # kafka-python / kafka-python-ng
            consumer = KafkaConsumer(
                bootstrap_servers=cfg.kafka_brokers,
                group_id=cfg.kafka_group,
                enable_auto_commit=False,
                auto_offset_reset="earliest",
                value_deserializer=lambda b: json.loads(b.decode("utf-8")),
            )
            consumer.subscribe([cfg.topic])
            log.info("consumidor conectado a %s (tópico '%s', grupo '%s').",
                     cfg.kafka_brokers, cfg.topic, cfg.kafka_group)
            backoff = 1.0

            while not stop_event.is_set():
                records = consumer.poll(timeout_ms=1000)
                if not records:
                    continue
                processed = False
                for _tp, msgs in records.items():
                    for msg in msgs:
                        try:
                            store.record_match(msg.value)
                            processed = True
                        except Exception as e:
                            # Não confirma: a mensagem será reprocessada depois.
                            log.error("falha ao processar evento (%s); será reprocessado.", e)
                            raise
                if processed:
                    consumer.commit()
        except Exception as e:
            log.error("consumidor caiu (%s); reconectando em %.0fs.", e, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, 30.0)
        finally:
            if consumer is not None:
                try:
                    consumer.close()
                except Exception:
                    pass
