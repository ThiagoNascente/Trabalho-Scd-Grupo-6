# ==========================================================================
# Score Service (Python/Flask) — item 5.
#
# Responsabilidades:
#  - Consumir os eventos `match-completed` do Kafka (thread de fundo) e
#    materializar o ranking no Redis + histórico no PostgreSQL (ver consumer.py
#    e store.py).
#  - Expor o leaderboard por minigame em REST para o frontend (item 7):
#       GET /api/scores?game=jogo1|jogo2|jogo3[&limit=N]
#       GET /api/scores            (os três de uma vez)
#       GET /health
#
# Desacoplamento: o engine NÃO chama este serviço; tudo flui pelo Kafka.
# ==========================================================================
import logging
import threading

from flask import Flask, jsonify, request

from config import Config
from store import Store, GAMES
from consumer import run_consumer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("score.app")

cfg = Config.from_env()
store = Store(cfg)
app = Flask(__name__)


# CORS: o frontend é servido de outra origem (ex.: http://localhost:8080) e lê o
# ranking deste serviço (porta 8000) — origem diferente. Liberamos a leitura para
# qualquer origem, mesma postura do auth-lite (cors()) e do gateway (Socket.io
# cors '*'). Sem este cabeçalho o navegador bloqueia GET /api/scores mesmo com a
# resposta 200 ("falta Access-Control-Allow-Origin"). GET é "simple request",
# então o Allow-Origin na resposta basta; Methods/Headers cobrem preflight futuro.
@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


_started = False
_start_lock = threading.Lock()


def start_background():
    """Inicia o schema do PostgreSQL e a thread do consumidor Kafka (idempotente)."""
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
    try:
        store.init_schema()
    except Exception as e:
        log.warning("não foi possível preparar o schema agora (%s); seguirá tentando ao consumir.", e)
    stop_event = threading.Event()
    app.config["STOP_EVENT"] = stop_event
    t = threading.Thread(target=run_consumer, args=(store, cfg, stop_event), name="kafka-consumer", daemon=True)
    t.start()
    log.info("Score Service iniciado na porta %d (kafka=%s).", cfg.port, cfg.kafka_enabled)


@app.get("/health")
def health():
    return jsonify(status="ok", service="score-service", kafka=cfg.kafka_enabled)


@app.get("/api/scores")
def scores():
    limit = max(1, min(100, int(request.args.get("limit", 10))))
    game = request.args.get("game")
    try:
        if game:
            if game not in GAMES:
                return jsonify(error="game inválido", games=list(GAMES)), 400
            return jsonify(game=game, leaderboard=store.leaderboard(game, limit))
        return jsonify({g: store.leaderboard(g, limit) for g in GAMES})
    except Exception as e:
        # Robustez na demo: leitura indisponível (ex.: Redis fora) não derruba a API.
        log.error("falha ao ler leaderboard (%s).", e)
        return jsonify(error="leaderboard indisponível no momento"), 503


@app.get("/api/scores/player")
def player_scores():
    """Recorde do jogador em cada minigame (para a tela Command Center)."""
    username = (request.args.get("username") or "").strip()
    if not username:
        return jsonify(error="username obrigatório"), 400
    try:
        return jsonify(username=username, records=store.player_record(username))
    except Exception as e:
        log.error("falha ao ler recorde do jogador (%s).", e)
        return jsonify(error="recorde indisponível no momento"), 503


# Inicia o trabalho de fundo no import (funciona com `python app.py` e gunicorn).
start_background()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=cfg.port)
