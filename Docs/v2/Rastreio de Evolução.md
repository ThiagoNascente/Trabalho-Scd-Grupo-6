# Rastreio de Evolução — v2 (Spaceship / SCD 2026.1)

**Última atualização:** 2026-06-19 (3ª rodada — E2E do Score validado na stack Docker) · **Entrega:** 28/06/2026
**O que é este documento:** o **checklist vivo** (status operacional) do [Plano de correções pendentes para v2](Plano%20de%20correções%20pendentes%20para%20v2.md) e o **ponto único de contexto** do projeto — responde _"onde estamos agora?"_ e _"como o sistema está montado?"_. A arquitetura atual e as notas técnicas (antes no HANDOFF, agora removido) foram absorvidas na seção **Arquitetura atual + notas técnicas** (mais abaixo).

**Documentos irmãos (cada um com um papel):**
- [Plano de correções pendentes para v2](Plano%20de%20correções%20pendentes%20para%20v2.md) — o **porquê / o quê / critério de aceite** de cada item (a fonte detalhada).
- [Checklist de Requisitos da Especificação](../Requisitos%20do%20trabalho/Checklist%20de%20Requisitos%20da%20Especificação.md) — conformidade com a **especificação acadêmica** (os 24 requisitos).
- [run.md](../../run.md) (stack Docker completa) e [dev-stack.sh](../../dev-stack.sh) (stack lite, sem Docker) — **como subir, testar e derrubar** a stack.

---

## ⚙️ Regra permanente (para o agente / próxima sessão) — LEIA ANTES DE EDITAR

> **Sempre que um item deste plano mudar de estado (⛔ → 🟡 → ✅), atualize ESTE documento PRIMEIRO.** Ele é o tracker operacional; os outros são reflexos dele.

A cada mudança, faça **nesta ordem**:

1. **Aqui (Rastreio):** ajuste o **Status**, a **Evidência (`arquivo:linha`)** e a coluna **"O que falta"** do item; atualize o **Placar** e a data de **"Última atualização"**; **acrescente uma linha** ao [Histórico de evolução](#-histórico-de-evolução-changelog).
2. **No [Plano v2](Plano%20de%20correções%20pendentes%20para%20v2.md):** reflita no **quadro-resumo**, na **seção detalhada** do item e na **§8 (Definição de "Pronto para v2")**.
3. **No [Checklist de Requisitos](../Requisitos%20do%20trabalho/Checklist%20de%20Requisitos%20da%20Especificação.md):** quando a mudança tocar um requisito da especificação, atualize o requisito afetado **e o "Placar geral"**.

**Disciplina de evidência:** toda marcação ✅/🟡 deve citar `arquivo:linha` real. **Se um arquivo for movido/renomeado, corrija a referência aqui** (ex.: a física saiu de `game-gateway/` para `game-engine/` no item 1 — referências antigas a `game-gateway/index.js` para regras de jogo estão obsoletas).

> Legenda de **status**: ✅ feito · 🟡 parcial (cumpre o mínimo, falta reforço/validação) · ⛔ não iniciado.
> Legenda de **prioridade**: 🔴 crítico (bloqueia "v2") · 🟠 alto · 🟡 médio. **Esforço**: ◐ baixo · ◑ médio · ● alto.

---

## 📊 Placar do plano de correção

| Grupo | Itens | ✅ | 🟡 | ⛔ |
|---|---|---|---|---|
| A. Eixo distribuído (1–8) | 8 | 5 | 1 | 2 |
| B. Dívida técnica e consistência (9.1–9.7) | 7 | 6 | 1 | 0 |
| C. Escala de dados e validação em nuvem (10–12) | 3 | 0 | 2 | 1 |
| **Total** | **18** | **11** | **4** | **3** |

> **Leitura rápida:** o **eixo distribuído foi validado E2E na stack Docker real** — Kafka, Score Service, Redis e leaderboard (**itens 4–7 ✅**): o fluxo `engine → Kafka → Score → Redis → API → tela` roda ao vivo, com os 3 rankings populando (validado pelo harness e **confirmado visualmente pelo usuário**). A **dívida técnica está quitada** (9.2 auth canônico). No eixo distribuído faltam o **gRPC síncrono (8)** e a **distribuição na AWS (3)**; o **WebRTC (2)** depende de validação no navegador (usuário). Em **escala de dados**, o **particionamento (11)** está implementado (validado offline); faltam a **replicação do PG (10)** e a **bateria/clientes na AWS (12)** — os **clientes simulados (4.2) e dados de teste (4.8)** já rodam localmente.

---

## ✅ Checklist de evolução — Grupo A: Eixo distribuído (núcleo da v2)

| # | Item | Prio/Esf | Status | Evidência (`arquivo`) | O que falta |
|---|---|---|---|---|---|
| 1 | **Game Engines isolados** (3 processos `GAME=jogo1\|2\|3`) | 🔴 ● | ✅ | `game-engine/server.js`, `game-engine/games/jogo1\|2\|3.js`, `game-engine/shared/constants.js`; gateway virou relay em `game-gateway/index.js`. Isolamento validado (`JOGO1=FALHOU JOGO2=OK JOGO3=OK`) | EC2 dedicada por engine → **item 3** |
| 2 | **Migração WebSockets → WebRTC** (canal de jogo) | 🔴 ● | 🟡 | `game-engine/server.js` (geckos.io, sinalização 5001/2/3), `frontend/index.html` (helper `RT`), `frontend/vendor/geckos.client.iife.js`, flag `USE_WEBRTC` em `frontend/config.js`. Fallback Socket.io automático | **Validar handshake no navegador + medir latência** (WebRTC × WS) — depende do **usuário**. TURN/NAT entra no item 3 |
| 3 | **Distribuição AWS: 1 serviço por EC2 + Load Balancer** | 🔴 ● | ⛔ | — | Deploy distribuído, matchmaking que devolve o engine, Security Groups, TURN, guia de deploy |
| 4 | **Apache Kafka** (produtor/consumidor) | 🔴 ◑ | ✅ | Produtor **resiliente** `game-engine/kafka.js` (`ensureProducer` reconecta se o Kafka subir depois — corrige o bug do 1º E2E), nos 3 ganchos. Consumidor `score-service/consumer.py`. **E2E na stack Docker:** partidas publicam e o Score consome (ranking populou ao vivo) | Cenário de **retenção** (Score parado) p/ a demo — passos em `run.md`; é garantido pelo commit-após-persistir |
| 5 | **Score Service (Python/Flask)** | 🔴 ● | ✅ | `score-service/` consome `match-completed`, materializa **Redis + PostgreSQL** e expõe `GET /api/scores` (+ `GET /api/scores/player`, CORS liberado). **E2E na Docker** validado: 3 rankings populados via harness, lidos pela API | — |
| 6 | **Redis** (cache do leaderboard) | 🟠 ◑ | ✅ | `score-service/store.py` — sorted sets `leaderboard:jogoN`; leitura via `ZREVRANGE` (ranking) e `ZSCORE` (recorde do jogador) direto do Redis. **E2E:** a API lê do Redis na stack Docker (sem varrer o PG) | — |
| 7 | **Leaderboard global por minigame** | 🔴 ◑ | ✅ | Backend `GET /api/scores`; frontend tela "Ranking Global" (**top 5**) + **recorde pessoal no Command Center** (`/api/scores/player`); layout do bloco corrigido. **Confirmado visualmente pelo usuário** com dados reais | — |
| 8 | **gRPC síncrono** (validação de JWT no Auth) | 🟠 ◑ | ⛔ | — (verificado: nenhum uso de `grpc` no código) | Endpoint gRPC no Auth (C#) + chamada do gateway na conexão. ⚠️ mexe no `auth-service` C# (não roda no ambiente de dev) |

---

## ✅ Checklist de evolução — Grupo B: Dívida técnica e consistência (item 9)

| # | Item | Prio/Esf | Status | Evidência (`arquivo`) | O que falta |
|---|---|---|---|---|---|
| 9.1 | Validação usuário/senha **4–30 server-side** (C#) | 🟠 ◐ | ✅ | `auth-service/Models/User.cs:13-22` (DataAnnotations `[StringLength(30, MinimumLength=4)]`) + `[ApiController]` em `AuthController.cs:12` (400 automático) | — |
| 9.2 | **Decidir o auth canônico** (C# × lite Node) | 🟠 ◐ | ✅ | C# é o **canônico** (BCrypt+PG; `dotnet build` = 0 erros neste ambiente). `auth-service-lite/server.js` alinhado: **bcryptjs** (era SHA-256), `/login → {token}`, TTL 2h, validação 4–30. Validado: register 201, `<4` → 400, login só `{token}`, hash `$2a$` | — |
| 9.3 | Regra de vitória do **Jogo 1** (3 consecutivas + reset) | 🟡 ◐ | ✅ | `game-engine/games/jogo1.js:21` (`ROUNDS_TO_WIN=3`), reset da sequência em `handleHit` (linha 81) — alinhado ao GDD | — _(no `game-engine/` desde o item 1)_ |
| 9.4 | **Remover manifestos k8s** | 🟡 ◐ | ✅ | Pasta `k8s/` inexistente no repositório (verificado) | — |
| 9.5 | Código morto: inimigo **`formacao`** | 🟡 ◐ | ✅ | Removido no engine (`game-engine/games/jogo3.js`, mapeamento GDD na linha 6) e em `frontend/index.html`; `formacao` não existe mais no repo | — _(no `game-engine/` desde o item 1)_ |
| 9.6 | **Segredos por variável de ambiente** (falha explícita) | 🟠 ◐ | ✅ | Sem `JWT_SECRET` default em `auth-service/Program.cs`, `AuthController.cs`, `game-gateway/index.js`, `auth-service-lite/server.js`; `docker-compose.yml` usa `${VAR:?}` | — |
| 9.7 | **Guia de deploy + links da doc** | 🟡 ◐ | 🟡 | Link Plano v2 → Checklist corrigido (pasta `Requisitos do trabalho/`) | Links defasados em `Docs/v1/QA_Status_v1.md` + **guia de deploy AWS** (acoplado ao item 3) |

---

## ✅ Checklist de evolução — Grupo C: Escala de dados e validação em nuvem

| # | Item | Prio/Esf | Status | Evidência (`arquivo`) | O que falta |
|---|---|---|---|---|---|
| 10 | **Replicação do PostgreSQL** (Primary-Replica) | 🟠 ◑ | ⛔ | — (instância única) | Topologia primary-replica (escritas no primário, leituras de ranking na réplica) |
| 11 | **Particionamento de dados** | 🟡 ◑ | 🟡 | Tabela `scores` **particionada por LISTA** do minigame em `score-service/store.py` (`init_schema`: `scores_jogo1\|2\|3` + DEFAULT `scores_outros`; PK inclui `game`); `partition_for` + `selftest_partition.py` (roteamento + distribuição do fixture OK) | **E2E com PG real**: pruning via `EXPLAIN` (fase Docker/AWS — itens 3/12) |
| 12 | **Bateria de testes na AWS EC2** | 🟠 ◑ | 🟡 | **Clientes simulados (req. 4.2)** em `load-test/` — validados localmente **e contra a stack Docker completa** (3 rankings populados, 0 erros, isolamento de falha); **dados de teste (req. 4.8)** em `test-data/` (+ `selftest_dataset.py`) | **Bateria na AWS** (depende do item 3): repetir na nuvem, latência WebRTC, replicação; cenário de demo (4.3) e vídeo (4.9) |

---

## 🔜 Próximos passos (ordem recomendada)

1. **(do usuário)** Validar **WebRTC no navegador** + medir latência → fecha o **item 2** (única peça do eixo distribuído ainda dependente do navegador).
2. **Item 8 — gRPC** (validação de JWT no Auth C# chamado pelo gateway). O ambiente **tem .NET 8** (o C# compila), então dá para implementar e validar aqui — é a única interação **síncrona** que falta (req. 1.5).
   - **Alternativa de baixo risco:** **9.7** (links em `Docs/v1` + guia de deploy AWS — parte já coberta por `run.md`).
3. **Item 3 — AWS** (1 EC2 por serviço + Load Balancer + matchmaking + TURN) → habilita o item **10** e a bateria do **12** na nuvem.
4. **Item 10 — replicação do PG** (primary-replica) → fecha o que falta de 1.6/1.7.
5. **Item 12 — bateria na AWS** + cenário de demo roteirizado (4.3) + vídeo (4.9).

---

## ⏳ Pendências que dependem do USUÁRIO

- **WebRTC no navegador:** confirmar o handshake (DevTools deve logar `"[WebRTC] canal de jogo aberto: jogoX"`; `chrome://webrtc-internals` mostra o DataChannel) e **medir a latência** WebRTC × WebSockets (fecha o aceite do item 2).
- ~~**Leaderboard:** confirmação visual com dados reais~~ — ✅ **feito** (usuário testou e validou o ranking + recordes na stack Docker).

## 🧭 Decisões de escopo firmadas (NÃO reabrir)

- **FORA:** criptografia do tráfego (TLS/HTTPS/WSS).
- **FORA:** Kubernetes/orquestrador. Distribuição = **1 serviço por EC2 + Load Balancer**.
- **WebRTC** é o canal de jogo (migração efetiva — item 2), com fallback Socket.io.

---

## 🏛️ Arquitetura atual + notas técnicas (contexto do código)

> Seção absorvida do antigo HANDOFF (removido). Para **subir/testar/derrubar** a stack, ver [run.md](../../run.md) (Docker) e [dev-stack.sh](../../dev-stack.sh) (lite). Diagrama-alvo detalhado em [Docs/Arquitetura](../Arquitetura/).

**Como o sistema está montado (fluxo real):**

```
Navegador (frontend :8080)
  │  Socket.io: login/lobby/controle/sinalização (+ FALLBACK do hot path)
  ▼
Game Gateway "relay" (game-gateway/ :3000) — autentica JWT, roteia; NÃO roda física.
  │  abre 1 conexão por jogador a cada engine (repassa playerId = socket.id do cliente)
  ▼
Game Engines (game-engine/, mesma imagem, GAME=jogo1|jogo2|jogo3)
   :4001/4002/4003 Socket.io — física a 60Hz, isolada por processo
   :5001/5002/5003 WebRTC    — DataChannel UDP direto com o navegador (hot path)
   └─ ao fim da partida publica `match-completed` no Kafka
Auth C# (auth-service/ :5000) — JWT + BCrypt + PostgreSQL (CANÔNICO, no compose)
auth-service-lite (Node/JSON :5000) — espelho de DEV sem Docker (fora do compose)
Kafka → Score Service (Python :8000) → Redis (ranking) + PostgreSQL (histórico particionado)
   └─ frontend lê GET /api/scores (ranking top 5) e /api/scores/player (recorde)
```

**Notas técnicas a lembrar (gotchas):**
- **Identidade do jogador = `playerId`** (o `socket.id` do cliente no gateway), repassado ao engine (`auth.playerId`) e ao WebRTC (`rt-init`). É a chave que une relay e DataChannel — **manter esse contrato**.
- **`emitState` (engine):** envia o estado por jogador pelo DataChannel se houver canal aberto, senão `io.to(playerId)`. **Não** voltar a usar `io.to(roomId)` no hot path.
- **Produtor Kafka tolerante a falha:** `publishMatchCompleted` **nunca lança** e reconecta sob demanda (`ensureProducer`) — o Kafka pode ficar pronto depois dos engines.
- **CORS:** o Score (`app.py`) libera `Access-Control-Allow-Origin: *` para o frontend (outra origem) ler o ranking.
- **Score / at-least-once:** jogo2/3 usam `ZADD GT` (idempotente); jogo1 usa `ZINCRBY` (numa falha rara no meio do processamento pode contar a mais — aceitável no escopo).
- **WebRTC (geckos):** bundle de browser vendorizado em `frontend/vendor/` (gerado por esbuild); cai para Socket.io se o canal não abrir (`USE_WEBRTC` em `frontend/config.js`).
- **`auth-service-lite/users.json`** é um "banco" de dev mutável; pode resetar para `[]`.

---

## 🗓️ Histórico de evolução (changelog)

> **Acrescente uma linha sempre que um item mudar de estado** (ver [Regra permanente](#️-regra-permanente-para-o-agente--próxima-sessão--leia-antes-de-editar)). Mais recente no topo.

| Data | Mudança | Itens afetados | Reflexo nos requisitos |
|---|---|---|---|
| 2026-06-19 | **3ª rodada — E2E do Score validado na stack Docker + UI do leaderboard + consolidação da doc.** Bugs corrigidos: **CORS** no Score (`app.py`) e **produtor Kafka resiliente** (`game-engine/kafka.js`). Fluxo `engine→Kafka→Score→Redis→API→tela` rodando ao vivo (3 rankings populados via harness, confirmado pelo usuário). UI: **recorde pessoal no Command Center** (`GET /api/scores/player`), ranking **top 5**, layout do bloco corrigido. Doc: `run.md` + `dev-stack.sh`; **HANDOFF removido** (conteúdo absorvido neste Rastreio) | 4, 5, 6, 7 → ✅ | **2.3/2.4 🟡→✅** (pub/sub + messaging E2E em broker real); **1.2 🟡→✅** (coordenação E2E). Placar requisitos: **16 ✅ / 5 🟡 / 3 ⛔** |
| 2026-06-19 | Sessão **clientes simulados + auth canônico + particionamento + dados de teste** (ambiente agora com Node+Python+.NET+Java): harness de carga (`load-test/` — 8 bots, 6 partidas concorrentes, 0 erros, isolamento de falha demonstrado); auth-lite alinhado ao C# canônico (bcrypt, `/login → {token}`, TTL 2h); tabela `scores` particionada por minigame; fixture versionado (`test-data/` + `selftest_dataset.py`/`selftest_partition.py`) | 9.2 → ✅; 11 → 🟡; 12 → 🟡 | **4.2 🟡→✅**, **4.8 ⛔→✅**, **4.3 ⛔→🟡**; 1.6 reforçado (particionamento de dados). Placar requisitos: **13 ✅ / 8 🟡 / 3 ⛔** |
| 2026-06-19 | **Correção de drift de referências** no Plano v2: ponteiros da física `game-gateway/` → `game-engine/` (itens 9.3, 9.5, 8, 9.6 e §3.3/§4) atualizados para o estado pós-item 1 | — (sem mudança de status) | — |
| 2026-06-19 | **Criação deste documento** (Rastreio de Evolução) como tracker operacional vivo da v2; consolidação do placar **6 ✅ / 6 🟡 / 6 ⛔** (18 itens) | — | Cross-link adicionado no Checklist de Requisitos |
| 2026-06-19 | Sessão **mensageria + leaderboard**: Kafka (produtor nos 3 engines) + Score Service (Python) + Redis alimentado + tela "Ranking Global" | 4, 5, 7 → 🟡; 6 → 🟡 | **2.3 e 2.4 ⛔→🟡**; 1.5/1.7 reforçados; 2.1 consolidado (Python real). Placar requisitos: **11 ✅ / 8 🟡 / 5 ⛔** |
| 2026-06-19 | Sessão **eixo distribuído + dívida técnica**: engines isolados, WebRTC (com fallback), correções rápidas | 1 → ✅; 2 → 🟡; 9.1/9.3/9.4/9.5/9.6 → ✅; 9.7 → 🟡 | 1.2/1.6 → 🟡 (particionamento funcional); 2.1 (3ª linguagem em curso) |
| (v1) | Fechamento de **todos os bugs de UI/UX e consistência de gameplay** apontados pelo QA (seções 1–2 do relatório) — base para a v2 | — | Núcleo de jogo (bloco 3) completo |
