# HANDOFF — Contexto para a próxima sessão (Spaceship / SCD 2026.1)

**Última atualização:** 2026-06-19 (fim da sessão dos itens 4, 5 e 7) · **Entrega:** 28/06/2026
**Para o próximo agente:** leia este arquivo primeiro. Ele resume o estado real do código e o que falta, para não precisar reler a conversa anterior.

---

## ⚡ Retomada rápida (TL;DR — leia isto antes de tudo)

**Onde paramos:** acabaram de ser implementados os **itens 4 + 5 (Kafka + Score Service)** e o **item 7 (Leaderboard)**. Nada foi commitado (o usuário pede commit explicitamente).

**Feito nesta sessão (detalhes nas §2 abaixo):**
- **Item 4 (Kafka):** engines publicam `match-completed` ao fim da partida — `game-engine/kafka.js` (produtor `kafkajs`, **nunca lança**), disparado nos 3 ganchos (jogo1 `handleHit`, jogo2 `fimDeJogo`, jogo3 `j3_gameOver`).
- **Item 5 (Score Service):** novo serviço Python/Flask em `score-service/` (consumer Kafka → Redis + PostgreSQL; `GET /api/scores`). 3ª linguagem do projeto.
- **Item 7 (Leaderboard):** tela "Ranking Global" no `frontend/index.html` (botão no dashboard) consumindo `GET /api/scores`, com degradação graciosa. Fecha o **item 6 (Redis)** em código.
- **Checklists/Plano v2 atualizados:** Requisitos **2.3/2.4 ⛔→🟡**, placar **11✅ / 8🟡 / 5⛔**.

**Validação:** tudo validado **sem Docker** (este ambiente tem Node+Python, mas **não tem Docker/Java/Redis/PG**): fallback do produtor, boot dos engines, `selftest.py` + data path com `fakeredis`, contrato HTTP, sintaxe do JS. **Falta o E2E real** (broker/Redis/PG) → fica para a fase Docker/AWS (itens 3/12).

**⏭️ Próximo passo recomendado:** **item 8 — gRPC** (validação de JWT no Auth C# chamado pelo gateway). ⚠️ Mexe no `auth-service` C#, que **não roda aqui** (sem .NET) → validar por inspeção + compose. **Alternativa de baixo risco e 100% validável aqui:** itens **9.2** (decidir auth canônico C# × lite) e **9.7** (links da doc + guia de deploy AWS).

**Pendências que dependem do USUÁRIO:** (a) validar o **WebRTC no navegador** + medir latência (fecha o item 2); (b) confirmação **visual** do leaderboard com dados reais (junto do E2E).

**Decisões de escopo firmadas (NÃO reabrir):** sem TLS/criptografia de tráfego; sem Kubernetes (distribuição = 1 EC2 por serviço + LB); WebRTC é o canal de jogo.

---

## 0. Como trabalhar (regras do usuário — manter)

- **Não commitar nem dar push sem o usuário pedir.** Ao final de cada bloco, dar um resumo.
- **Antes de itens grandes** (Kafka, Score, gRPC, AWS, replicação) **apresentar um plano curto e aguardar OK.** Correções pequenas e bem definidas podem ir direto.
- **Português** nas docs e mensagens ao usuário.
- **Nada chumbado no código:** endereços/portas/segredos vêm de variável de ambiente ou de `frontend/config.js`.
- **Não quebrar a v1** (toda a UI/UX e gameplay estão OK). Validar via stack local a cada passo.
- Marcar progresso nos **dois checklists**: `Docs/Requisitos do trabalho/Checklist de Requisitos da Especificação.md` (e o "Placar geral") e `Docs/v2/Plano de correções pendentes para v2.md` (seção 8 + quadro-resumo + seções detalhadas), com evidências (arquivo:linha).

### Decisões de escopo já firmadas (NÃO reabrir)
- **FORA:** criptografia do tráfego (TLS/HTTPS/WSS).
- **FORA:** Kubernetes/orquestrador. Distribuição = **1 serviço por EC2 + Load Balancer**.
- **WebRTC** é o canal de jogo (migração efetiva, feita — ver item 2).

---

## 1. Arquitetura ATUAL (já implementada)

```
Navegador (frontend, :8080)
  │   Socket.io  (login/lobby/controle/sinalização + FALLBACK do hot path)
  ▼
Game Gateway "relay" (game-gateway/, :3000)   ── autentica JWT, roteia, NÃO roda física
  │   abre 1 conexão socket.io-client por jogador a cada engine (repassa playerId = socket.id do cliente)
  ▼
Game Engines (game-engine/, mesma imagem, GAME=jogo1|jogo2|jogo3)
     :4001/:4002/:4003  (Socket.io)        ── física a 60Hz, isolada por processo
     :5001/:5002/:5003  (WebRTC/geckos)    ── DataChannel UDP direto com o navegador (hot path)

Auth Service C# (auth-service/, :5000)  — JWT + BCrypt + PostgreSQL  (compose)
auth-service-lite (Node/JSON, :5000)    — usado para DEV local SEM Docker (não está no compose)
```

- **Hot path** (WebRTC quando disponível, senão Socket.io): inputs `playerMovement`/`shoot`/`acao`/`j3_move`/`j3_shoot` e estado `gameUpdate`/`estadoDoJogo`/`j3_gameState`.
- **Resto sempre por Socket.io:** lobby, roomJoined, countdown, matchOver/fimDeJogo/j3_gameOver, listas de sala, Wins.
- **Identidade do jogador = `playerId`** (o `socket.id` do cliente no gateway). É a chave que une o relay Socket.io e o DataChannel WebRTC. Os 3 módulos chaveiam por `playerId`.

---

## 2. O que JÁ foi feito (com evidências)

### Correções rápidas (Plano v2 §9)
- **9.1** validação usuário/senha 4–30 server-side C#: já estava (DataAnnotations em `auth-service/Models/User.cs` + `[ApiController]`). ✅
- **9.3** regra de vitória Jogo 1 = **3 vitórias consecutivas + reset** (`ROUNDS_TO_WIN=3` em `game-engine/games/jogo1.js`, `handleHit`). ✅
- **9.4** manifestos k8s: pasta `k8s/` não existe mais. ✅
- **9.5** código morto `formacao` removido (engine + `frontend/index.html`). ✅
- **9.6** segredos por env, **falha explícita** sem default: removido o JWT default de `auth-service/Program.cs`, `auth-service/Controllers/AuthController.cs`, `game-gateway/index.js`, `auth-service-lite/server.js`; `docker-compose.yml` injeta `JWT_SECRET`/`POSTGRES_PASSWORD` via `.env` com `${VAR:?}`. ✅
- **9.7** links da doc: **parcial** — corrigido o link vivo Plano v2→Checklist (pasta é `Requisitos do trabalho/`). **Falta:** links defasados em `Docs/v1/QA_Status_v1.md` e o guia de deploy AWS (acoplado ao item 3). 🟡

### Item 1 — Game Engines isolados ✅
- Física extraída do gateway para `game-engine/` (módulos `games/jogo1|2|3.js` + `shared/constants.js`), `server.js` parametrizado por `GAME`. 3 processos independentes.
- Gateway virou **relay** (`game-gateway/index.js`): autentica, lobby/roteamento, abre proxy socket.io-client por jogador a cada engine.
- **Isolamento validado:** derrubar engine do Jogo 1 → `JOGO1=FALHOU JOGO2=OK JOGO3=OK`.

### Item 2 — WebRTC ✅ implementado (validação de browser pendente 🟡)
- `game-engine/server.js`: servidor **geckos.io** (sinalização 5001/5002/5003, faixa UDP `GECKOS_UDP_MIN..MAX`), `emitState` por jogador (DataChannel senão Socket.io), inputs do canal chamam as funções `apply*`. Tudo em `try/catch` (fallback total p/ Socket.io).
- Módulos refatorados: chaveiam por `playerId` e expõem `applyMovement/applyShoot/applyAcao/applyMove`.
- Frontend: helper `RT` (`frontend/index.html`) abre o DataChannel ao iniciar a partida (roomJoined/partidaIniciada/j3_gameStarted), `RT.send` (canal senão socket), estado renderizado dos dois transportes (`applyGameUpdate/applyEstadoJogo2/applyJ3State`). Bundle local `frontend/vendor/geckos.client.iife.js` (esbuild, sem CDN). Flag `USE_WEBRTC` + `ENGINE_GECKOS_PORTS` em `frontend/config.js`.
- **Validado node-side:** engines sobem os 2 transportes; relay/fallback `JOGO1/2/3=OK`; geckos inicializa e autoriza por JWT; estáticos servem (200).
- **PENDENTE (precisa do usuário):** confirmar o handshake no **navegador** (DevTools console deve logar `"[WebRTC] canal de jogo aberto: jogoX"`; `chrome://webrtc-internals` mostra o DataChannel) e **medir a latência** WebRTC × WebSockets (fecha o aceite). Se o canal não abrir, cai para Socket.io (sem regressão); `USE_WEBRTC:false` força o transporte antigo.

### Itens 4 + 5 — Kafka + Score Service ✅ implementados (validação E2E pendente 🟡)
- **Produtor (engines):** `game-engine/kafka.js` (`publishMatchCompleted`, tolerante a falha — **nunca lança**), inicializado em `server.js` e passado nos `deps` dos jogos. Publica `match-completed` nos 3 ganchos de fim de partida: jogo1 `handleHit` (winner+loser, `won`), jogo2 `fimDeJogo` (pontuação compartilhada da run), jogo3 `j3_gameOver` (vitória e derrota). **Jogo 3 passou a guardar `username`** no objeto do jogador (antes não tinha). Dep: `kafkajs` (instalada). Broker/tópico por env (`KAFKA_BROKER`/`MATCH_TOPIC`); sem broker → publicação desativada (DEV sem Docker).
- **Score Service (`score-service/`, Python/Flask, :8000):** `consumer.py` (Kafka, commit manual de offset **após** persistir, `auto_offset_reset='earliest'` → Consistência Eventual), `store.py` (Redis sorted set por minigame + PostgreSQL tabela `scores`; `leaderboard_ops` é **função pura** testável), `app.py` (`GET /api/scores?game=jogoN`, `/health`), `config.py` (tudo por env). Política: jogo1 = vitórias (`ZINCRBY`), jogo2/3 = melhor pontuação (`ZADD GT`). `requirements.txt` (psycopg2-binary **2.9.10** p/ wheel no Py3.13) + `Dockerfile` + `selftest.py`.
- **Compose:** adicionado serviço `score-service`; `KAFKA_BROKER=kafka:29092`+`MATCH_TOPIC` nos 3 engines (+ `depends_on: kafka`); `.env.example` documenta Kafka/Redis/Score.
- **Evento `match-completed`:** `{ game, finishedAt, players:[{username, score, won}] }`.
- **Validado (sem Docker):** engines não quebram sem broker nem com broker morto (fallback, testado node-side); boot completo do engine OK; `selftest.py` confere a política de ranking; deps Python instalam em venv (Py3.13), `app.py` importa e sobe degradando gracioso, rotas REST respondem (200/400/503).
- **PENDENTE (E2E):** teste com broker/Redis/PG reais (retenção/consistência eventual) na fase Docker/AWS (itens 3/12) — não há Docker/Java neste ambiente.

### Item 7 — Leaderboard global ✅ implementado (confirmação visual pendente 🟡)
- **Backend:** `GET /api/scores` do Score Service (ver itens 4/5).
- **Frontend:** nova tela **Ranking Global** (`leaderboard-container`) com botão no dashboard; `openLeaderboard`/`loadLeaderboard`/`renderLeaderboard` em `frontend/index.html`; uma coluna por jogo (Jogo 1 = vitórias; Jogo 2/3 = melhor pontuação). Endpoint por `SCORE_PORT` em `frontend/config.js`. **Degrada com elegância** (Score fora → aviso, sem quebrar a v1). CSS reaproveita `.game-grid`/`.game-card` + estilos `.lb-*`.
- **Validado (sem Docker):** data path write+read com **Redis real** via `fakeredis` (API `redis-py`: `ZINCRBY`/`ZADD GT`/`ZREVRANGE`); **contrato HTTP** que o frontend consome (`{jogo1:[],jogo2:[],jogo3:[]}`); sintaxe do JS inline do cliente conferida (vm). Para o teste local refatorei `store.update_ranking` (extraído de `record_match`).
- **PENDENTE:** confirmação **visual no navegador** com dados reais (junto do E2E dos itens 4/5, fase Docker/AWS).

---

## 3. Como rodar a stack LOCAL (DEV, sem Docker — Windows, Node v24)

> Docker e .NET **não** estão disponíveis neste ambiente; por isso usamos a stack **lite** em Node. `JWT_SECRET` precisa ser o MESMO em todos. Valor usado nos testes: `dev-spaceship-secret-troque-em-prod-32chars`.

6 processos (cada um em background). Caminhos absolutos para evitar problema de CWD do PowerShell:

```powershell
# Auth (lite, :5000)
$env:JWT_SECRET='dev-spaceship-secret-troque-em-prod-32chars'; node 'CAMINHO\auth-service-lite\server.js'
# Engines (Socket.io 4001-4003 + WebRTC 5001-5003)
$env:GAME='jogo1'; $env:PORT='4001'; $env:JWT_SECRET='...'; $env:AUTH_API_URL='http://localhost:5000/api/auth'; node 'CAMINHO\game-engine\server.js'
$env:GAME='jogo2'; $env:PORT='4002'; $env:JWT_SECRET='...'; node 'CAMINHO\game-engine\server.js'
$env:GAME='jogo3'; $env:PORT='4003'; $env:JWT_SECRET='...'; node 'CAMINHO\game-engine\server.js'
# Gateway relay (:3000)
$env:JWT_SECRET='...'; $env:ENGINE1_URL='http://localhost:4001'; $env:ENGINE2_URL='http://localhost:4002'; $env:ENGINE3_URL='http://localhost:4003'; node 'CAMINHO\game-gateway\index.js'
# Frontend estático (:8080)
python -m http.server 8080 --directory 'CAMINHO\frontend'
```

Abrir **http://localhost:8080**. Parar tudo:
```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,4001,4002,4003,5001,5002,5003,5000,8080 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Em produção/compose: `cp .env.example .env` e `docker compose up -d --build` (compose já tem os 3 engines + portas WebRTC). Lá o Auth é o **C#** (auth-service), não o lite.

### Dependências já instaladas (node_modules, gitignored)
- `game-engine/`: `@geckos.io/server`, express, socket.io, jsonwebtoken.
- `game-gateway/`: + `socket.io-client`.

---

## 4. Próximos passos (ordem sugerida do Plano v2 §7)

1. **(curto, do usuário)** validar WebRTC no navegador + medir latência → fecha item 2.
2. ~~**Itens 4 + 5 — Kafka + Score Service**~~ ✅ **implementados** (ver §2). Falta só o **E2E** com broker real (entra no item 12).
3. ~~**Item 7 — Leaderboard**~~ ✅ **implementado** (backend + tela; falta confirmação visual no navegador). **Item 6 (Redis)** fecha junto no E2E.
4. **Item 8 — gRPC** ⬅ **próximo recomendado.** Validação de JWT no Auth (C#) chamado pelo gateway. **Atenção:** mexe no auth-service C#, que **não roda neste ambiente** (sem .NET) — validar por inspeção/compose.
5. **Item 3 — AWS** 1 EC2 por serviço + Load Balancer + matchmaking que devolve o endereço do engine (WebRTC direto) + **TURN** p/ NAT. Depois **10 (replicação PG)** e **11 (particionamento)**.
6. **Item 12 — bateria de testes na AWS** (inclui o **E2E do Kafka/Score**: retenção com Score parado) + clientes simulados (req. 4.2) + cenário de demo (4.3) + dados de teste (4.8) + vídeo (4.9).

---

## 5. Estado dos checklists (placar)

- **Requisitos (especificação):** Geral **11 ✅ / 8 🟡 / 5 ⛔** (de 24). Recentes: **2.3 e 2.4 ⛔→🟡** (pub/sub + messaging via Kafka/Score implementados), **2.1** consolidado (Python = serviço real), **1.5/1.7** reforçados (assíncrono + consistência eventual).
- **Plano v2 §8:** itens 9.1/9.3/9.4/9.5/9.6 ✅, 9.7 🟡; item 1 ✅; item 2 🟡 (browser/latência); **itens 4, 5, 7 🟡 implementados** (falta E2E/visual); item 6 🟡 (Redis alimentado + leitura na tela); itens 3, 8, 9.2, 10, 11, 12 pendentes.

---

## 6. Gotchas / decisões técnicas a lembrar

- **Só o Jogo 1** usa `socket.id` no cliente para se identificar (`frontend/index.html` ~668/805). Por isso a identidade no engine é o `playerId` (id do cliente no gateway), repassado no relay (`auth.playerId`) e no WebRTC (`rt-init`). **Manter esse contrato** em qualquer mudança.
- **emitState** no engine: por jogador, DataChannel se há canal aberto (`channels[playerId]`), senão `io.to(playerId)` (o socket do relay entrou na sala `playerId`). Não voltar a usar `io.to(roomId).emit` no hot path.
- **geckos** instala via binário pré-compilado (sem compilar) e sobe no Node v24. Bundle de browser foi **gerado com esbuild** (npm não publica IIFE pronto) e vendorizado em `frontend/vendor/`.
- `auth-service-lite/users.json` acumulou usuários de teste (`tester_*`, `relaytester`) — pode resetar para `[]` se quiser.
- PowerShell deste ambiente às vezes muda o CWD — **usar caminhos absolutos** ao lançar node/python.
- Itens 9.1/9.6 mexem no **auth-service C#**, que não roda aqui (sem .NET); foram validados por inspeção + o lite (que roda) replica a validação 4–30.
- **Kafka/Score (itens 4/5):** ambiente de dev tem **Node + Python, mas NÃO tem Docker/Java/Redis/PG** → impossível subir broker/Redis/PG aqui; por isso o E2E (retenção/consistência eventual) fica para a fase Docker/AWS. O produtor é **fire-and-forget e nunca lança** (não pode afetar o gameplay). `requirements.txt` usa `psycopg2-binary==2.9.10` (a 2.9.9 não tem wheel p/ Py3.13 e tenta compilar). Consumidor: `kafka-python-ng` (fork compatível com Py3.11–3.13; import continua `from kafka import ...`).
- **Semântica at-least-once:** jogo2/3 idempotentes (`ZADD GT`); jogo1 (`ZINCRBY`) pode contar a mais numa falha rara no meio do processamento — aceitável no escopo (documentado no README do Score).
