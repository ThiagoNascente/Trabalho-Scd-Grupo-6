# Rodar a stack completa (Docker) — Spaceship

Stack completa em contêineres: **Postgres, Redis, Zookeeper, Kafka, Auth (C#),
Gateway, 3 Game Engines, Score Service e Frontend**. É a stack para validar o
leaderboard, Kafka, Redis e o particionamento em PostgreSQL real.

> ⚠️ Rode **todos os comandos na raiz do projeto** (a pasta deste arquivo).
> O `.env` já vem com `POSTGRES_PASSWORD` e `JWT_SECRET` (sem eles o `up` aborta
> de propósito). Os comandos usam `sudo` porque o Docker exige.

---

## 1. Subir tudo

```
sudo docker compose up -d --build
```

A primeira vez demora (build das imagens). O `--build` garante que o código
atual entra nas imagens. Quando terminar, abra o jogo em **http://localhost:8080**.

> Se aparecer **"port already allocated"**, é a stack lite (sem Docker) ocupando
> as portas. Derrube-a e suba de novo:
> ```
> ./dev-stack.sh stop
> ```

---

## 2. Verificar que subiu

Status dos contêineres:

```
sudo docker compose ps
```

Health checks via HTTP (qualquer código = serviço no ar; o auth devolve 404 para
usuário inexistente, o que já prova que respondeu):

```
curl -s -o /dev/null -w "frontend :8080 -> %{http_code}\n" http://localhost:8080
curl -s -o /dev/null -w "auth     :5000 -> %{http_code}\n" http://localhost:5000/api/auth/wins/healthcheck
curl -s -o /dev/null -w "score    :8000 -> %{http_code}\n" http://localhost:8000/health
```

Acompanhar logs em tempo real (Ctrl+C sai dos logs, **não** derruba a stack):

```
sudo docker compose logs -f score-service kafka
```

---

## 3. (Opcional) Popular o ranking com bots

Gera partidas nos 3 jogos para preencher o leaderboard:

```
cd load-test && npm install && node run.js --bots=8 --game=mix; cd ..
```

Conferir o ranking pela API que o frontend usa:

```
curl -s "http://localhost:8000/api/scores?limit=5" | python3 -m json.tool
```

---

## 4. Derrubar tudo

Para e remove os contêineres (**mantém** os dados do banco no volume):

```
sudo docker compose down
```

Garante que a stack lite (se você a usou) também caiu:

```
./dev-stack.sh stop
```

Se quiser derrubar **e apagar os dados** (zera Postgres e ranking), troque o
primeiro comando por:

```
sudo docker compose down -v
```

---


## Solução de problemas (leaderboard)

**"Ranking indisponível" + erro de CORS no console.** Reconstrua o Score e
recarregue forte (Ctrl+Shift+R):

```
sudo docker compose up -d --build score-service
```

**O ranking não atualiza depois de uma partida.** Reconstrua os engines e
confirme que o produtor Kafka conectou:

```
sudo docker compose up -d --build game-engine-1 game-engine-2 game-engine-3
sudo docker compose logs game-engine-2 | grep -i kafka
```

Esperado: `[kafka] produtor conectado em kafka:29092`. Conferir o pipeline
`fim de partida → Kafka → Score → Redis`:

```
sudo docker exec spaceship_redis redis-cli ZREVRANGE leaderboard:jogo2 0 -1 WITHSCORES
sudo docker compose logs --tail=30 score-service
```

> Só partidas **novas** contam (eventos de antes do fix se perderam) e **reabra**
> a tela "Ranking Global" — ela busca os dados ao abrir.

**Inspecionar o particionamento por minigame (item 11):**

```
sudo docker exec -it spaceship_postgres psql -U postgres -d authdb -c "\d+ scores"
sudo docker exec -it spaceship_postgres psql -U postgres -d authdb -c "EXPLAIN (COSTS OFF) SELECT * FROM scores WHERE game='jogo2';"
sudo docker exec -it spaceship_postgres psql -U postgres -d authdb -c "SELECT tableoid::regclass AS particao, count(*) FROM scores GROUP BY 1;"
```

**Algum build falhou:**

```
sudo docker compose build --no-cache <serviço>
```

---

## Portas da stack

| Serviço | Porta | Observação |
|---|---|---|
| Frontend (nginx) | 8080 | abrir no navegador |
| Auth (C#) | 5000 | REST `/api/auth` |
| Gateway (relay) | 3000 | Socket.io |
| Game Engines 1/2/3 | 4001/4002/4003 | + WebRTC 5001-5003 e UDP 20001-20030 |
| Score Service | 8000 | `GET /api/scores` |
| PostgreSQL | 5432 | tabela `scores` particionada |
| Redis | 6379 | ranking (sorted sets) |
| Kafka / Zookeeper | 9092 / 2181 | tópico `match-completed` |

---

## Alternativa sem Docker (stack lite)

Para testar só os **clientes simulados** e o **auth**, sem Kafka/Redis/PG. Não
sobe o Score Service, então o "Ranking Global" fica indisponível (degrada sem
quebrar). Detalhes em [load-test/README.md](load-test/README.md).

Instalar dependências (só na 1ª vez):

```
./dev-stack.sh deps
```

Subir:

```
./dev-stack.sh start
```

Rodar o harness de carga:

```
cd load-test && node run.js; cd ..
```

Derrubar:

```
./dev-stack.sh stop
```
