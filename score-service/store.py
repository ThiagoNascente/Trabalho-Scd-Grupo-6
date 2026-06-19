# ==========================================================================
# Persistência do Score Service.
#  - Redis (sorted set por minigame): ranking materializado para leitura rápida.
#  - PostgreSQL (tabela `scores`): histórico de cada partida (auditoria e base
#    para o particionamento por minigame — item 11).
#
# `leaderboard_ops` é uma FUNÇÃO PURA (sem I/O) que traduz um evento
# `match-completed` nas operações de ranking — assim a política fica testável
# offline (ver selftest.py), sem Redis/Kafka/Postgres no ambiente.
#
# Semântica de ranking por minigame:
#  - jogo1 (PvP/Duelo): ranking = total de VITÓRIAS  -> ZINCRBY +1 por vitória.
#  - jogo2/jogo3 (cooperativo): ranking = MELHOR pontuação -> ZADD GT (mantém máx).
#
# Importações de bibliotecas externas (redis/psycopg2) são preguiçosas (dentro
# dos métodos) para o módulo poder ser importado sem essas libs instaladas.
# ==========================================================================
import logging

log = logging.getLogger("score.store")

GAMES = ("jogo1", "jogo2", "jogo3")


def leaderboard_key(game):
    return f"leaderboard:{game}"


def leaderboard_ops(event):
    """Pure: evento match-completed -> lista de operações de ranking.
    Cada op: {"op": "zincrby"|"zadd_gt", "key", "member", "value"}.
    """
    game = event.get("game")
    players = event.get("players") or []
    key = leaderboard_key(game)
    ops = []
    for p in players:
        username = p.get("username")
        if not username:
            continue
        score = int(p.get("score") or 0)
        if game == "jogo1":
            # Ranking de vitórias: só pontua quem venceu o duelo.
            if p.get("won"):
                ops.append({"op": "zincrby", "key": key, "member": username, "value": 1})
        else:
            # Ranking por melhor pontuação da run cooperativa.
            ops.append({"op": "zadd_gt", "key": key, "member": username, "value": score})
    return ops


class Store:
    def __init__(self, cfg):
        self.cfg = cfg
        self._redis = None
        self._pg = None

    # ---- Conexões preguiçosas -------------------------------------------
    def redis(self):
        if self._redis is None:
            import redis
            self._redis = redis.from_url(self.cfg.redis_url, decode_responses=True)
        return self._redis

    def pg(self):
        if self._pg is None or getattr(self._pg, "closed", 1):
            import psycopg2
            self._pg = psycopg2.connect(
                host=self.cfg.pg_host, port=self.cfg.pg_port, dbname=self.cfg.pg_db,
                user=self.cfg.pg_user, password=self.cfg.pg_password,
            )
        return self._pg

    def init_schema(self):
        conn = self.pg()
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS scores (
                    id          SERIAL PRIMARY KEY,
                    game        VARCHAR(16)  NOT NULL,
                    username    VARCHAR(64)  NOT NULL,
                    score       INTEGER      NOT NULL DEFAULT 0,
                    won         BOOLEAN      NOT NULL DEFAULT FALSE,
                    finished_at TIMESTAMPTZ  NOT NULL DEFAULT now()
                );
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_scores_game ON scores (game);")
        conn.commit()
        log.info("schema 'scores' pronto no PostgreSQL.")

    # ---- Escrita (consumidor) -------------------------------------------
    def update_ranking(self, event):
        """Aplica as operações de ranking de um evento no Redis (sorted set)."""
        r = self.redis()
        for op in leaderboard_ops(event):
            if op["op"] == "zincrby":
                r.zincrby(op["key"], op["value"], op["member"])
            elif op["op"] == "zadd_gt":
                r.zadd(op["key"], {op["member"]: op["value"]}, gt=True)

    def record_match(self, event):
        """Materializa um evento no Redis e grava o histórico no PostgreSQL.
        Pode lançar: nesse caso o consumidor NÃO confirma o offset e a mensagem
        é reprocessada (semântica at-least-once -> tolerância a falha)."""
        self.update_ranking(event)

        conn = self.pg()
        with conn.cursor() as cur:
            for p in (event.get("players") or []):
                if not p.get("username"):
                    continue
                cur.execute(
                    "INSERT INTO scores (game, username, score, won, finished_at) "
                    "VALUES (%s, %s, %s, %s, COALESCE(%s::timestamptz, now()))",
                    (event.get("game"), p.get("username"), int(p.get("score") or 0),
                     bool(p.get("won")), event.get("finishedAt")),
                )
        conn.commit()
        log.info("partida registrada: game=%s players=%d", event.get("game"), len(event.get("players") or []))

    # ---- Leitura (REST) --------------------------------------------------
    def leaderboard(self, game, limit=10):
        """Top-N do minigame a partir do Redis (ranking materializado)."""
        r = self.redis()
        rows = r.zrevrange(leaderboard_key(game), 0, max(0, limit - 1), withscores=True)
        return [{"username": m, "score": int(s)} for (m, s) in rows]
