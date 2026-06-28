# Rastreio de Evolução — v2 (Spaceship / SCD 2026.1)

> ⚠️ **REGISTRO HISTÓRICO (até 2026-06-27).** Checklist vivo do processo, mantido
> como registro. **A fonte de verdade atual é o [README na raiz](../../README.md)**
> (visão geral, guias local/AWS, justificativa e checklist). Mudança posterior
> importante: o **WebRTC foi REMOVIDO** do projeto (não funcionava) — o canal de
> jogo em tempo real passou a ser **Socket.io** via gateway-relay. Trechos abaixo
> que citam "WebRTC" são desse contexto anterior.

**Última atualização:** 2026-06-27 (6ª rodada — **correções de gameplay pós-playtest AWS**: placar do Jogo 1 (acumulativo, vence por 2) + encerramento de sala dos Jogos 2 e 3; 5ª rodada — **deploy AWS condensado em 6 máquinas** `deploy1.sh`…`deploy6.sh`; 4ª rodada — **gRPC do item 8** + **deploy AWS nativo preparado**) · **Entrega:** 28/06/2026
**O que é este documento:** o **checklist vivo** (status operacional) do [Plano de correções pendentes para v2](Plano%20de%20correções%20pendentes%20para%20v2.md) e o **ponto único de contexto** do projeto — responde _"onde estamos agora?"_ e _"como o sistema está montado?"_. A arquitetura atual e as notas técnicas (antes no HANDOFF, agora removido) foram absorvidas na seção **Arquitetura atual + notas técnicas** (mais abaixo).

**Documentos irmãos (cada um com um papel):**
- [Plano de correções pendentes para v2](Plano%20de%20correções%20pendentes%20para%20v2.md) — o **porquê / o quê / critério de aceite** de cada item (a fonte detalhada).
- [Checklist de Requisitos da Especificação](../../README.md) — conformidade com a **especificação acadêmica** (os 24 requisitos).
- [README §5](../../README.md) (stack Docker completa) e [dev-stack.sh](../../dev-stack.sh) (stack lite, sem Docker) — **como subir, testar e derrubar** a stack.

---

## ⚙️ Regra permanente (para o agente / próxima sessão) — LEIA ANTES DE EDITAR

> **Sempre que um item deste plano mudar de estado (⛔ → 🟡 → ✅), atualize ESTE documento PRIMEIRO.** Ele é o tracker operacional; os outros são reflexos dele.

A cada mudança, faça **nesta ordem**:

1. **Aqui (Rastreio):** ajuste o **Status**, a **Evidência (`arquivo:linha`)** e a coluna **"O que falta"** do item; atualize o **Placar** e a data de **"Última atualização"**; **acrescente uma linha** ao [Histórico de evolução](#-histórico-de-evolução-changelog).
2. **No [Plano v2](Plano%20de%20correções%20pendentes%20para%20v2.md):** reflita no **quadro-resumo**, na **seção detalhada** do item e na **§8 (Definição de "Pronto para v2")**.
3. **No [Checklist de Requisitos](../../README.md):** quando a mudança tocar um requisito da especificação, atualize o requisito afetado **e o "Placar geral"**.

**Disciplina de evidência:** toda marcação ✅/🟡 deve citar `arquivo:linha` real. **Se um arquivo for movido/renomeado, corrija a referência aqui** (ex.: a física saiu de `game-gateway/` para `game-engine/` no item 1 — referências antigas a `game-gateway/index.js` para regras de jogo estão obsoletas).

> Legenda de **status**: ✅ feito · 🟡 parcial (cumpre o mínimo, falta reforço/validação) · ⛔ não iniciado.
> Legenda de **prioridade**: 🔴 crítico (bloqueia "v2") · 🟠 alto · 🟡 médio. **Esforço**: ◐ baixo · ◑ médio · ● alto.

---

## 📊 Placar do plano de correção

| Grupo | Itens | ✅ | 🟡 | ⛔ |
|---|---|---|---|---|
| A. Eixo distribuído (1–8) | 8 | 6 | 2 | 0 |
| B. Dívida técnica e consistência (9.1–9.7) | 7 | 7 | 0 | 0 |
| C. Escala de dados e validação em nuvem (10–12) | 3 | 0 | 3 | 0 |
| **Total** | **18** | **13** | **5** | **0** |

> **Leitura rápida:** **não há mais itens ⛔** — tudo está implementado; o que resta é **executar/validar na AWS** (tarefa do usuário). O **eixo distribuído foi validado E2E na stack Docker** (Kafka, Score, Redis, leaderboard — **itens 4–7 ✅**) e o **gRPC síncrono (item 8) foi implementado e validado** (build do Auth C# + cliente do gateway em 5 cenários, incluindo revogação e fallback; E2E ao vivo roteirizado no Guia §5.4). A **distribuição na AWS (item 3 🟡)** está **toda preparada** — scripts nativos por serviço em [`deploy/aws/`](../../deploy/aws/) (sem Docker) + [Guia de Deploy AWS](../../README.md) + roteamento por jogo + matriz de Security Groups; falta só o usuário subir as EC2. Em **escala de dados**, a **replicação do PG (item 10 🟡)** ganhou setup pronto (réplica no `deploy2.sh`), o **particionamento (11 🟡)** está validado offline (verificação E2E roteirizada no Guia §5.5) e a **bateria na AWS (12 🟡)** está roteirizada (Guia §5, reusando `load-test/`). O **WebRTC (item 2 🟡)** depende de validação no navegador (usuário). A **dívida técnica está 100% quitada** (Grupo B — inclui o **9.7**: Guia de Deploy + v1 marcada como histórica).

---

## ✅ Checklist de evolução — Grupo A: Eixo distribuído (núcleo da v2)

| # | Item | Prio/Esf | Status | Evidência (`arquivo`) | O que falta |
|---|---|---|---|---|---|
| 1 | **Game Engines isolados** (3 processos `GAME=jogo1\|2\|3`) | 🔴 ● | ✅ | `game-engine/server.js`, `game-engine/games/jogo1\|2\|3.js`, `game-engine/shared/constants.js`; gateway virou relay em `game-gateway/index.js`. Isolamento validado (`JOGO1=FALHOU JOGO2=OK JOGO3=OK`) | EC2 dedicada por engine → **item 3** |
| 2 | **Migração WebSockets → WebRTC** (canal de jogo) | 🔴 ● | 🟡 | `game-engine/server.js` (geckos.io, sinalização 5001/2/3), `frontend/index.html` (helper `RT`), `frontend/vendor/geckos.client.iife.js`, flag `USE_WEBRTC` em `frontend/config.js`. Fallback Socket.io automático | **Validar handshake no navegador + medir latência** (WebRTC × WS) — depende do **usuário**. TURN/NAT entra no item 3 |
| 3 | **Distribuição AWS** (balanceamento via matchmaking, sem ALB) | 🔴 ● | 🟡 | **Preparado, sem Docker, condensado em 6 EC2** (limite de 9 da conta): orquestradores `deploy/aws/deploy1.sh`…`deploy6.sh` (peças por serviço em `deploy/aws/lib/`), `env.aws.example`, [Guia de Deploy AWS](../../README.md) (topologia + descrição dos 6 deploys + Security Groups). PG primário×réplica e 3 engines em máquinas separadas. Roteamento por jogo (`frontend/config.js` `ENGINE_HOSTS`) | **Executar nas 6 EC2** (usuário) — Guia §4. Escala horizontal (round-robin de >1 engine por jogo) fica como evolução |
| 4 | **Apache Kafka** (produtor/consumidor) | 🔴 ◑ | ✅ | Produtor **resiliente** `game-engine/kafka.js` (`ensureProducer` reconecta se o Kafka subir depois — corrige o bug do 1º E2E), nos 3 ganchos. Consumidor `score-service/consumer.py`. **E2E na stack Docker:** partidas publicam e o Score consome (ranking populou ao vivo) | Cenário de **retenção** (Score parado) p/ a demo — passos em `run.md`; é garantido pelo commit-após-persistir |
| 5 | **Score Service (Python/Flask)** | 🔴 ● | ✅ | `score-service/` consome `match-completed`, materializa **Redis + PostgreSQL** e expõe `GET /api/scores` (+ `GET /api/scores/player`, CORS liberado). **E2E na Docker** validado: 3 rankings populados via harness, lidos pela API | — |
| 6 | **Redis** (cache do leaderboard) | 🟠 ◑ | ✅ | `score-service/store.py` — sorted sets `leaderboard:jogoN`; leitura via `ZREVRANGE` (ranking) e `ZSCORE` (recorde do jogador) direto do Redis. **E2E:** a API lê do Redis na stack Docker (sem varrer o PG) | — |
| 7 | **Leaderboard global por minigame** | 🔴 ◑ | ✅ | Backend `GET /api/scores`; frontend tela "Ranking Global" (**top 5**) + **recorde pessoal no Command Center** (`/api/scores/player`); layout do bloco corrigido. **Confirmado visualmente pelo usuário** com dados reais | — |
| 8 | **gRPC síncrono** (validação de sessão no Auth) | 🟠 ◑ | ✅ | Contrato `auth-service/Protos/auth.proto` (cópia em `game-gateway/auth.proto`); servidor `auth-service/Services/AuthValidationService.cs` (HTTP/2 em `Program.cs`, porta `GRPC_PORT`/5005) valida assinatura **+ existência do usuário** (revogação); cliente `game-gateway/authClient.js` chamado em `game-gateway/index.js` com **fallback local** (não quebra a v1). **Validado:** `dotnet build` OK + cliente em 5 cenários (válido, revogação, assinatura inválida, fallback, modo local) | E2E ao vivo C#↔Node↔PG (precisa de Postgres) — roda na **stack Docker** ([README §5](../../README.md)) ou na AWS ([Guia §5.4](../../README.md)) |

---

## ✅ Checklist de evolução — Grupo B: Dívida técnica e consistência (item 9)

| # | Item | Prio/Esf | Status | Evidência (`arquivo`) | O que falta |
|---|---|---|---|---|---|
| 9.1 | Validação usuário/senha **4–30 server-side** (C#) | 🟠 ◐ | ✅ | `auth-service/Models/User.cs:13-22` (DataAnnotations `[StringLength(30, MinimumLength=4)]`) + `[ApiController]` em `AuthController.cs:12` (400 automático) | — |
| 9.2 | **Decidir o auth canônico** (C# × lite Node) | 🟠 ◐ | ✅ | C# é o **canônico** (BCrypt+PG; `dotnet build` = 0 erros neste ambiente). `auth-service-lite/server.js` alinhado: **bcryptjs** (era SHA-256), `/login → {token}`, TTL 2h, validação 4–30. Validado: register 201, `<4` → 400, login só `{token}`, hash `$2a$` | — |
| 9.3 | Regra de vitória do **Jogo 1** (placar acumulativo, vence por 2 de vantagem) | 🟡 ◐ | ✅ | `game-engine/games/jogo1.js:22` (`WIN_MARGIN=2`) + condição `Math.abs(p1-p2)>=2` em `handleHit` (linha 87) — **alinhado ao GDD** (Minigame 1, revisado pós-playtest AWS 2026-06-27) | — _(regra revisada: era "3 consecutivas")_ |
| 9.4 | **Remover manifestos k8s** | 🟡 ◐ | ✅ | Pasta `k8s/` inexistente no repositório (verificado) | — |
| 9.5 | Código morto: inimigo **`formacao`** | 🟡 ◐ | ✅ | Removido no engine (`game-engine/games/jogo3.js`, mapeamento GDD na linha 6) e em `frontend/index.html`; `formacao` não existe mais no repo | — _(no `game-engine/` desde o item 1)_ |
| 9.6 | **Segredos por variável de ambiente** (falha explícita) | 🟠 ◐ | ✅ | Sem `JWT_SECRET` default em `auth-service/Program.cs`, `AuthController.cs`, `game-gateway/index.js`, `auth-service-lite/server.js`; `docker-compose.yml` usa `${VAR:?}` | — |
| 9.7 | **Guia de deploy + links da doc** | 🟡 ◐ | ✅ | [Guia de Deploy AWS](../../README.md) (passo a passo + Security Groups + testes) + `deploy/aws/README.md`; **v1 marcada como histórica** (`Docs/v1/*` com aviso de superada — resolve o link morto `DEPLOYMENT_GUIDE.md`); `README.md` aponta para o guia e marca Docker como só-local | — |

---

## ✅ Checklist de evolução — Grupo C: Escala de dados e validação em nuvem

| # | Item | Prio/Esf | Status | Evidência (`arquivo`) | O que falta |
|---|---|---|---|---|---|
| 10 | **Replicação do PostgreSQL** (Primary-Replica) | 🟠 ◑ | 🟡 | Setup pronto em `deploy/aws/lib/postgres.sh`: primário via `deploy1.sh` (`wal_level`/`max_wal_senders` + papel de replicação) e réplica via `deploy2.sh` (recria por `pg_basebackup -R`, standby somente-leitura, em EC2 separada do primário) | **Executar/validar na AWS** (usuário) — Guia §5.6 (`pg_is_in_recovery()`, escrita no primário → leitura na réplica) |
| 11 | **Particionamento de dados** | 🟡 ◑ | 🟡 | Tabela `scores` **particionada por LISTA** do minigame em `score-service/store.py` (`init_schema`: `scores_jogo1\|2\|3` + DEFAULT `scores_outros`; PK inclui `game`); `partition_for` + `selftest_partition.py` (roteamento + distribuição do fixture OK) | **E2E com PG real**: pruning via `EXPLAIN` — comandos prontos no [Guia §5.5](../../README.md) (rodar na AWS/Docker) |
| 12 | **Bateria de testes na AWS EC2** | 🟠 ◑ | 🟡 | **Clientes simulados (req. 4.2)** em `load-test/` — validados localmente **e contra a stack Docker completa** (3 rankings populados, 0 erros, isolamento de falha); **dados de teste (req. 4.8)** em `test-data/` (+ `selftest_dataset.py`) | **Bateria na AWS** roteirizada no [Guia §5](../../README.md) (smoke, bots `load-test/`, gRPC, partição, replicação, isolamento) — falta o usuário **executar**; + latência WebRTC, cenário de demo (4.3) e vídeo (4.9) |

---

## 🔜 Próximos passos (ordem recomendada)

1. **(do usuário) Executar o deploy na AWS** pelo [Guia de Deploy AWS](../../README.md): subir as **6 EC2**, rodar `deploy/aws/deploy1.sh`…`deploy6.sh` (um por máquina, na ordem) e a **bateria de testes** (Guia §5). Isso **fecha o item 3** e valida ao vivo o **gRPC (8)**, a **replicação (10)**, o **particionamento (11)** e a **bateria (12)** — habilitando os requisitos **1.1 / 4.4**.
2. **(do usuário) Validar WebRTC no navegador** + medir latência → fecha o **item 2** (o `deploy3` já publica o bundle geckos e a faixa UDP é aberta no Security Group).
3. **(do usuário) Gravar o vídeo** de demonstração (req. 4.9) com a stack rodando na AWS.

---

## ⏳ Pendências que dependem do USUÁRIO

- **Executar o deploy na AWS** (Guia §4) e rodar a **bateria de testes** (Guia §5): smoke, bots do `load-test/`, gRPC/revogação, particionamento, replicação e isolamento de falha. Fecha o **item 3** e valida ao vivo **8/10/11/12** + reqs **1.1/4.4**.
- **WebRTC no navegador:** confirmar o handshake (DevTools deve logar `"[WebRTC] canal de jogo aberto: jogoX"`; `chrome://webrtc-internals` mostra o DataChannel) e **medir a latência** WebRTC × WebSockets (fecha o aceite do item 2).
- ~~**Leaderboard:** confirmação visual com dados reais~~ — ✅ **feito** (usuário testou e validou o ranking + recordes na stack Docker).

## 🧭 Decisões de escopo firmadas (NÃO reabrir)

- **FORA:** criptografia do tráfego (TLS/HTTPS/WSS).
- **FORA:** Kubernetes/orquestrador. Distribuição = **nativa em 6 EC2** (condensada — PG primário×réplica e os 3 engines em máquinas separadas; decisão v2).
- **Balanceamento:** via **matchmaking do gateway** (escolhe o engine e devolve o endereço), **sem ALB**.
- **Deploy AWS é NATIVO (sem Docker).** Docker/`docker-compose` = só desenvolvimento local.
- **WebRTC** é o canal de jogo (migração efetiva — item 2), com fallback Socket.io.

---

## 🏛️ Arquitetura atual + notas técnicas (contexto do código)

> Seção absorvida do antigo HANDOFF (removido). Para **subir/testar/derrubar** a stack, ver [README §5](../../README.md) (Docker) e [dev-stack.sh](../../dev-stack.sh) (lite). Diagrama-alvo detalhado em [Docs/Arquitetura](../Arquitetura/).

**Como o sistema está montado (fluxo real):**

```
Navegador (frontend :8080)
  │  Socket.io: login/lobby/controle/sinalização (+ FALLBACK do hot path)
  ▼
Game Gateway "relay" (game-gateway/ :3000) — valida a sessão via gRPC no Auth (fallback local), roteia; NÃO roda física.
  │  abre 1 conexão por jogador a cada engine (repassa playerId = socket.id do cliente)
  ▼
Game Engines (game-engine/, mesma imagem, GAME=jogo1|jogo2|jogo3)
   :4001/4002/4003 Socket.io — física a 60Hz, isolada por processo
   :5001/5002/5003 WebRTC    — DataChannel UDP direto com o navegador (hot path)
   └─ ao fim da partida publica `match-completed` no Kafka
Auth C# (auth-service/ :5000 REST + :5005 gRPC) — JWT + BCrypt + PostgreSQL (CANÔNICO). gRPC ValidateToken valida sessão p/ o gateway (item 8)
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
- **gRPC (item 8):** o gateway valida a sessão chamando `ValidateToken` no Auth (`AUTH_GRPC_URL`, porta `GRPC_PORT`/5005, HTTP/2 em texto puro). Resposta "inválido" (ex.: usuário removido) é honrada; só **erro de transporte** cai para `jwt.verify` local — assim a v1 não quebra sem o gRPC. Sem `AUTH_GRPC_URL` = validação local pura (DEV).
- **Deploy:** Docker/`docker-compose` é **só local**; na AWS a stack sobe **nativa em 6 máquinas** via `deploy/aws/deploy1.sh`…`deploy6.sh` (systemd; serviços condensados, mas PG primário×réplica e os 3 engines em EC2 separadas) — ver [Guia de Deploy AWS](../../README.md). Endereços por serviço no cliente: `frontend/config.js` (`AUTH_HOST`/`GATEWAY_HOST`/`SCORE_HOST`/`ENGINE_HOSTS`, cada um cai para `HOST`).
- **`auth-service-lite/users.json`** é um "banco" de dev mutável; pode resetar para `[]`.

---

## 🗓️ Histórico de evolução (changelog)

> **Acrescente uma linha sempre que um item mudar de estado** (ver [Regra permanente](#️-regra-permanente-para-o-agente--próxima-sessão--leia-antes-de-editar)). Mais recente no topo.

| Data | Mudança | Itens afetados | Reflexo nos requisitos |
|---|---|---|---|
| 2026-06-27 | **6ª rodada — correções de gameplay pós-playtest na AWS.** (a) **Jogo 1:** placar agora é **acumulativo** e vence quem abrir **2 pontos de vantagem** (`game-engine/games/jogo1.js:22` `WIN_MARGIN=2`; condição em `handleHit`, linha 87) — a pedido da equipe, **revertendo** a escolha do item 9.3 ("3 consecutivas") e **atualizando o GDD** (Minigame 1) para casar. (b) **Jogo 3:** a sala passa a ser **encerrada e liberada** no fim da partida (`j3_finishMatch` em `game-engine/games/jogo3.js:61`, chamada na vitória `:159` e na derrota `:180` + guarda em `j3_updateGameLogic:141`) — antes a sala ficava "viva" com os jogadores presos, e quem voltava ao menu reaparecia no jogo do outro. (c) **Jogo 2:** mesma blindagem — ao perder, além de apagar a sala, agora também tira todos do canal (`io.in(idSala).socketsLeave(idSala)` em `game-engine/games/jogo2.js`), fechando o "fantasma" por **reuso de nome de sala**. O **Jogo 1 já estava correto** (apaga a sala + `socketsLeave` no fim e ao sair; IDs de sala aleatórios, sem reuso de nome). | 9.3 (regra revista, segue ✅); Jogos 2 e 3 (correção de gameplay, sem item próprio) | — (gameplay; não toca requisito da especificação) |
| 2026-06-27 | **5ª rodada — deploy AWS condensado de 10 para 6 máquinas** (a conta AWS só permite 9 instâncias). Scripts viraram orquestradores `deploy/aws/deploy1.sh`…`deploy6.sh` (um por EC2); as peças por serviço foram para `deploy/aws/lib/`. Agrupamento: `data1`=PG primário+Redis · `data2`=Kafka+PG réplica · `app`=Auth+Gateway+Score+Frontend · `engine1/2/3` isolados. **Preservados** o primário×réplica (item 10) e o particionamento funcional (3 engines separados). Guia de Deploy AWS reescrito (topologia + **descrição dos 6 deploys** + Security Groups p/ 6 instâncias) | 3, 10, 12 (topologia; status mantido 🟡) | — (sem mudança de status; só a forma do deploy) |
| 2026-06-27 | **4ª rodada — gRPC (item 8) implementado/validado + deploy AWS nativo preparado.** Servidor gRPC `ValidateToken` no Auth C# (assinatura + existência do usuário = revogação) + cliente no gateway com **fallback local** (`game-gateway/authClient.js`); `dotnet build` OK e cliente validado em **5 cenários**. **Deploy sem Docker:** scripts `deploy/aws/*.sh` (systemd, 1 serviço/EC2) + `env.aws.example` + **[Guia de Deploy AWS](../../README.md)** (Security Groups, ordem, bateria de testes); `frontend/config.js` ganhou **hosts por serviço**. **v1 marcada como histórica**; README aponta para o guia. | 8 → ✅; 3, 10 → 🟡; 9.7 → ✅ | **1.5 🟡→✅** (síncrono gRPC + assíncrono). Placar requisitos: **17 ✅ / 4 🟡 / 3 ⛔** |
| 2026-06-19 | **3ª rodada — E2E do Score validado na stack Docker + UI do leaderboard + consolidação da doc.** Bugs corrigidos: **CORS** no Score (`app.py`) e **produtor Kafka resiliente** (`game-engine/kafka.js`). Fluxo `engine→Kafka→Score→Redis→API→tela` rodando ao vivo (3 rankings populados via harness, confirmado pelo usuário). UI: **recorde pessoal no Command Center** (`GET /api/scores/player`), ranking **top 5**, layout do bloco corrigido. Doc: `run.md` + `dev-stack.sh`; **HANDOFF removido** (conteúdo absorvido neste Rastreio) | 4, 5, 6, 7 → ✅ | **2.3/2.4 🟡→✅** (pub/sub + messaging E2E em broker real); **1.2 🟡→✅** (coordenação E2E). Placar requisitos: **16 ✅ / 5 🟡 / 3 ⛔** |
| 2026-06-19 | Sessão **clientes simulados + auth canônico + particionamento + dados de teste** (ambiente agora com Node+Python+.NET+Java): harness de carga (`load-test/` — 8 bots, 6 partidas concorrentes, 0 erros, isolamento de falha demonstrado); auth-lite alinhado ao C# canônico (bcrypt, `/login → {token}`, TTL 2h); tabela `scores` particionada por minigame; fixture versionado (`test-data/` + `selftest_dataset.py`/`selftest_partition.py`) | 9.2 → ✅; 11 → 🟡; 12 → 🟡 | **4.2 🟡→✅**, **4.8 ⛔→✅**, **4.3 ⛔→🟡**; 1.6 reforçado (particionamento de dados). Placar requisitos: **13 ✅ / 8 🟡 / 3 ⛔** |
| 2026-06-19 | **Correção de drift de referências** no Plano v2: ponteiros da física `game-gateway/` → `game-engine/` (itens 9.3, 9.5, 8, 9.6 e §3.3/§4) atualizados para o estado pós-item 1 | — (sem mudança de status) | — |
| 2026-06-19 | **Criação deste documento** (Rastreio de Evolução) como tracker operacional vivo da v2; consolidação do placar **6 ✅ / 6 🟡 / 6 ⛔** (18 itens) | — | Cross-link adicionado no Checklist de Requisitos |
| 2026-06-19 | Sessão **mensageria + leaderboard**: Kafka (produtor nos 3 engines) + Score Service (Python) + Redis alimentado + tela "Ranking Global" | 4, 5, 7 → 🟡; 6 → 🟡 | **2.3 e 2.4 ⛔→🟡**; 1.5/1.7 reforçados; 2.1 consolidado (Python real). Placar requisitos: **11 ✅ / 8 🟡 / 5 ⛔** |
| 2026-06-19 | Sessão **eixo distribuído + dívida técnica**: engines isolados, WebRTC (com fallback), correções rápidas | 1 → ✅; 2 → 🟡; 9.1/9.3/9.4/9.5/9.6 → ✅; 9.7 → 🟡 | 1.2/1.6 → 🟡 (particionamento funcional); 2.1 (3ª linguagem em curso) |
| (v1) | Fechamento de **todos os bugs de UI/UX e consistência de gameplay** apontados pelo QA (seções 1–2 do relatório) — base para a v2 | — | Núcleo de jogo (bloco 3) completo |
