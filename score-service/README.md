# Score Service (Python / Flask)

Serviço de pontuação do Spaceship (itens 4, 5 e 6 do Plano v2). É a **3ª linguagem**
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

## Particionamento de dados por minigame (item 11)

A tabela `scores` (histórico no PostgreSQL) é **particionada por LISTA** da coluna
`game` ([store.py](store.py) `init_schema`): há uma partição física por minigame —
`scores_jogo1`, `scores_jogo2`, `scores_jogo3` — mais uma partição **DEFAULT**
(`scores_outros`) para minigames futuros.

```sql
CREATE TABLE scores (... , PRIMARY KEY (id, game)) PARTITION BY LIST (game);
CREATE TABLE scores_jogo1 PARTITION OF scores FOR VALUES IN ('jogo1');
-- jogo2, jogo3, e uma partição DEFAULT
```

- **Escrita:** o INSERT vai na tabela-pai `scores`; o PostgreSQL **roteia
  sozinho** para a partição do `game`. A função `partition_for(game)`
  ([store.py](store.py)) espelha esse roteamento para observabilidade/teste.
- **Leitura:** uma consulta de ranking por minigame (`WHERE game='jogoN'`) só
  varre a partição daquele jogo (**partition pruning**), atendendo ao aceite do
  item 11. (A leitura quente do leaderboard vem do Redis; o PG é histórico/auditoria.)
- **Migração:** o schema é criado do zero no boot; converter uma tabela `scores`
  pré-existente e não particionada exigiria um passo de migração à parte.

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
python selftest.py             # política de ranking (Redis falso em memória)
python selftest_dataset.py     # fixture de teste (req. 4.8) x ranking esperado
python selftest_partition.py   # roteamento de partição por minigame (item 11)
```

- `selftest.py` — valida `leaderboard_ops` aplicando eventos num Redis falso.
- `selftest_dataset.py` — aplica `test-data/sample-match-events.json` e confere
  contra `test-data/expected-rankings.json` (dados de teste versionados).
- `selftest_partition.py` — valida `partition_for` e a distribuição do fixture
  pelas partições (`scores_jogoN` / DEFAULT).

O teste **E2E** (broker/Redis/PG reais, retenção/consistência eventual e
*partition pruning* via `EXPLAIN`) roda na fase Docker/AWS.
