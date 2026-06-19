# Score Service (Python / Flask)

Serviço de pontuação do CosmoDock (itens 4, 5 e 6 do Plano v2). É a **3ª linguagem**
do projeto (Python, ao lado de C# no Auth e Node nos engines/gateway) e o ponto de
**interação assíncrona / pub-sub** (Kafka).

## O que faz

1. **Consome** os eventos `match-completed` que cada Game Engine publica no **Kafka**
   ao fim de uma partida (thread de fundo — [consumer.py](consumer.py)).
2. **Materializa o ranking** por minigame no **Redis** (sorted set) e grava o
   **histórico** de cada partida no **PostgreSQL** (tabela `scores`) — [store.py](store.py).
3. **Expõe** o leaderboard por minigame em REST para o frontend (item 7):
   - `GET /api/scores?game=jogo1|jogo2|jogo3[&limit=N]`
   - `GET /api/scores` — os três rankings de uma vez
   - `GET /health`

O engine **não** chama este serviço: tudo flui pelo Kafka (desacoplamento).

## Evento consumido (`match-completed`)

Publicado pelos engines em [game-engine/kafka.js](../game-engine/kafka.js):

```json
{
  "game": "jogo2",
  "finishedAt": "2026-06-19T12:00:00.000Z",
  "players": [{ "username": "alice", "score": 70, "won": false }]
}
```

## Política de ranking por minigame

| Minigame | Natureza | Ranking | Operação no Redis |
|---|---|---|---|
| `jogo1` | PvP (Duelo) | total de **vitórias** | `ZINCRBY +1` por vitória |
| `jogo2` | Cooperativo (Survival) | **melhor** pontuação | `ZADD GT` (mantém o máximo) |
| `jogo3` | Cooperativo (Invasão) | **melhor** pontuação | `ZADD GT` (mantém o máximo) |

A função `leaderboard_ops` ([store.py](store.py)) é **pura** (sem I/O), o que
permite validar a política offline — ver abaixo.

## Tolerância a falha (Consistência Eventual)

- Commit **manual** de offset só **após** persistir (`enable_auto_commit=False`).
- `auto_offset_reset='earliest'` + `group_id` fixo: com o Score **parado**, o Kafka
  retém os eventos; ao subir, o serviço processa o que ficou pendente.
- Semântica **at-least-once**: em falha após gravar parte, a mensagem é reprocessada.
  `jogo2/jogo3` são idempotentes (máximo); `jogo1` (incremento) pode, em uma falha
  rara no meio do processamento, contar a mais — aceitável no escopo do trabalho.

## Configuração (variáveis de ambiente — nada chumbado)

| Variável | Default | Uso |
|---|---|---|
| `SCORE_PORT` | `8000` | porta do REST |
| `KAFKA_BROKER` | *(vazio)* | broker(s) Kafka; vazio = consumidor desativado |
| `MATCH_TOPIC` | `match-completed` | tópico consumido |
| `KAFKA_GROUP` | `score-service` | consumer group |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis do ranking |
| `PG_HOST` / `PG_PORT` | `localhost` / `5432` | PostgreSQL |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `authdb` / `postgres` / *(vazio)* | credenciais do PG |

## Rodar

No `docker-compose` (DEV) sobe junto com Kafka/Redis/PostgreSQL:

```bash
cp .env.example .env   # (na raiz do projeto)
docker compose up -d --build
curl http://localhost:8000/api/scores
```

Local (fora do Docker) com Kafka/Redis/PG já acessíveis:

```bash
pip install -r requirements.txt
KAFKA_BROKER=localhost:9092 REDIS_URL=redis://localhost:6379/0 python app.py
```

## Validação offline (sem Docker/Kafka/Redis/PG)

```bash
python selftest.py
```

Valida a política de ranking por minigame (`leaderboard_ops`) aplicando os eventos
em um Redis falso em memória. Usado para validar a lógica neste ambiente; o teste
**E2E** (broker real + retenção/consistência eventual) roda na fase Docker/AWS.
