# ==========================================================================
# Configuração do Score Service — TUDO por variável de ambiente (nada chumbado).
# Em DEV os defaults apontam para localhost; no compose/AWS vêm do .env.
# ==========================================================================
import os


class Config:
    def __init__(self):
        self.port = int(os.environ.get("SCORE_PORT", "8000"))

        # Kafka (item 4). Sem KAFKA_BROKER o consumidor fica desativado (o serviço
        # ainda sobe e serve /api/scores a partir do que já houver no Redis).
        self.kafka_brokers = [b.strip() for b in os.environ.get("KAFKA_BROKER", "").split(",") if b.strip()]
        self.topic = os.environ.get("MATCH_TOPIC", "match-completed")
        self.kafka_group = os.environ.get("KAFKA_GROUP", "score-service")

        # Redis (item 6) — ranking materializado (sorted set por minigame).
        self.redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

        # PostgreSQL — histórico de partidas (auditoria + base p/ particionamento, item 11).
        self.pg_host = os.environ.get("PG_HOST", "localhost")
        self.pg_port = int(os.environ.get("PG_PORT", "5432"))
        self.pg_db = os.environ.get("POSTGRES_DB", "authdb")
        self.pg_user = os.environ.get("POSTGRES_USER", "postgres")
        self.pg_password = os.environ.get("POSTGRES_PASSWORD", "")

    @property
    def kafka_enabled(self):
        return bool(self.kafka_brokers)

    @classmethod
    def from_env(cls):
        return cls()
