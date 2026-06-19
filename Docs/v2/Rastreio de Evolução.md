# Rastreio de Evolução — v2 (Spaceship / SCD 2026.1)

**Última atualização:** 2026-06-19 · **Entrega:** 28/06/2026
**O que é este documento:** o **checklist vivo** (status operacional) do [Plano de correções pendentes para v2](Plano%20de%20correções%20pendentes%20para%20v2.md). É o lugar canônico para responder _"onde estamos agora?"_ de forma rápida e escaneável.

**Documentos irmãos (cada um com um papel):**
- [Plano de correções pendentes para v2](Plano%20de%20correções%20pendentes%20para%20v2.md) — o **porquê / o quê / critério de aceite** de cada item (a fonte detalhada).
- [Checklist de Requisitos da Especificação](../Requisitos%20do%20trabalho/Checklist%20de%20Requisitos%20da%20Especificação.md) — conformidade com a **especificação acadêmica** (os 24 requisitos).
- [HANDOFF — contexto p/ a próxima sessão](HANDOFF-contexto-proxima-sessao.md) — o **estado real do código** e o passo a passo de retomada.

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
| A. Eixo distribuído (1–8) | 8 | 1 | 5 | 2 |
| B. Dívida técnica e consistência (9.1–9.7) | 7 | 5 | 1 | 1 |
| C. Escala de dados e validação em nuvem (10–12) | 3 | 0 | 0 | 3 |
| **Total** | **18** | **6** | **6** | **6** |

> **Leitura rápida:** o eixo distribuído está **implementado em código** (engines isolados, WebRTC, Kafka, Score Service, Redis, leaderboard) mas **validado só sem Docker** — os 🟡 viram ✅ quando rodar o **E2E com broker/Redis/PG reais** e o **deploy na AWS**. A dívida técnica está quase toda quitada. O grupo de **escala/nuvem (AWS, replicação, particionamento, testes)** é o que ainda não começou.

---

## ✅ Checklist de evolução — Grupo A: Eixo distribuído (núcleo da v2)

| # | Item | Prio/Esf | Status | Evidência (`arquivo`) | O que falta |
|---|---|---|---|---|---|
| 1 | **Game Engines isolados** (3 processos `GAME=jogo1\|2\|3`) | 🔴 ● | ✅ | `game-engine/server.js`, `game-engine/games/jogo1\|2\|3.js`, `game-engine/shared/constants.js`; gateway virou relay em `game-gateway/index.js`. Isolamento validado (`JOGO1=FALHOU JOGO2=OK JOGO3=OK`) | EC2 dedicada por engine → **item 3** |
| 2 | **Migração WebSockets → WebRTC** (canal de jogo) | 🔴 ● | 🟡 | `game-engine/server.js` (geckos.io, sinalização 5001/2/3), `frontend/index.html` (helper `RT`), `frontend/vendor/geckos.client.iife.js`, flag `USE_WEBRTC` em `frontend/config.js`. Fallback Socket.io automático | **Validar handshake no navegador + medir latência** (WebRTC × WS) — depende do **usuário**. TURN/NAT entra no item 3 |
| 3 | **Distribuição AWS: 1 serviço por EC2 + Load Balancer** | 🔴 ● | ⛔ | — | Deploy distribuído, matchmaking que devolve o engine, Security Groups, TURN, guia de deploy |
| 4 | **Apache Kafka** (produtor/consumidor) | 🔴 ◑ | 🟡 | Produtor: `game-engine/kafka.js:49` (`publishMatchCompleted`, nunca lança) ligado nos 3 ganchos (`games/jogo1.js`, `jogo2.js`, `jogo3.js`). Consumidor: `score-service/consumer.py` | **E2E com broker real** (retenção/consistência eventual) → itens 3/12 |
| 5 | **Score Service (Python/Flask)** | 🔴 ● | 🟡 | `score-service/` — `consumer.py`, `store.py`, `app.py` (`GET /api/scores`), `config.py`, `selftest.py`; no `docker-compose.yml` | **E2E com Kafka/Redis/PG reais** → itens 3/12 |
| 6 | **Redis** (cache do leaderboard) | 🟠 ◑ | 🟡 | `score-service/store.py` — sorted sets `leaderboard:jogoN` (`ZINCRBY` / `ZADD GT`), leitura via `ZREVRANGE` (sem varrer o PG) | Leitura **E2E com Redis real** → itens 3/12 |
| 7 | **Leaderboard global por minigame** | 🔴 ◑ | 🟡 | Backend: `GET /api/scores`. Frontend: `frontend/index.html` (`openLeaderboard`/`loadLeaderboard`/`renderLeaderboard`, tela `leaderboard-container`); endpoint por `SCORE_PORT` em `frontend/config.js`. Degrada com elegância | **Confirmação visual no navegador** com dados reais — depende do **usuário** (junto do E2E) |
| 8 | **gRPC síncrono** (validação de JWT no Auth) | 🟠 ◑ | ⛔ | — (verificado: nenhum uso de `grpc` no código) | Endpoint gRPC no Auth (C#) + chamada do gateway na conexão. ⚠️ mexe no `auth-service` C# (não roda no ambiente de dev) |

---

## ✅ Checklist de evolução — Grupo B: Dívida técnica e consistência (item 9)

| # | Item | Prio/Esf | Status | Evidência (`arquivo`) | O que falta |
|---|---|---|---|---|---|
| 9.1 | Validação usuário/senha **4–30 server-side** (C#) | 🟠 ◐ | ✅ | `auth-service/Models/User.cs:13-22` (DataAnnotations `[StringLength(30, MinimumLength=4)]`) + `[ApiController]` em `AuthController.cs:12` (400 automático) | — |
| 9.2 | **Decidir o auth canônico** (C# × lite Node) | 🟠 ◐ | ⛔ | Coexistem `auth-service/` (C# + BCrypt, no compose) e `auth-service-lite/` (Node/JSON + SHA-256, p/ dev sem Docker) | Definir o oficial; alinhar validações **ou** remover o lite; documentar |
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
| 11 | **Particionamento de dados** | 🟡 ◑ | ⛔ | — (só há particionamento **funcional** dos 3 jogos via engines) | Particionar as tabelas de pontuação (ex.: por minigame) |
| 12 | **Bateria de testes na AWS EC2** | 🟠 ◑ | ⛔ | — | Depende do deploy (item 3). Inclui o **E2E do Kafka/Score** (retenção), clientes simulados (req. 4.2), cenário de demo (4.3), dados de teste (4.8) e vídeo (4.9) |

---

## 🔜 Próximos passos (ordem recomendada)

1. **(do usuário)** Validar **WebRTC no navegador** + medir latência → fecha o **item 2**.
2. **(do usuário)** Confirmar **leaderboard visual** com dados reais → ajuda a fechar **itens 6/7**.
3. **Item 8 — gRPC** (validação de JWT no Auth C# chamado pelo gateway). ⚠️ mexe no `auth-service` C#, que **não roda no ambiente de dev** → validar por inspeção + compose.
   - **Alternativas 100% validáveis aqui (baixo risco):** **9.2** (decidir auth canônico) e **9.7** (links da doc + guia de deploy AWS).
4. **Item 3 — AWS** (1 EC2 por serviço + Load Balancer + matchmaking + TURN) → habilita **6, 7, 10, 11** ponta a ponta.
5. **Itens 10 → 11** (replicação → particionamento do PG).
6. **Item 12 — bateria de testes na AWS** (inclui o **E2E do Kafka/Score**: encerrar partida com o Score parado e confirmar processamento ao subir).

---

## ⏳ Pendências que dependem do USUÁRIO

- **WebRTC no navegador:** confirmar o handshake (DevTools deve logar `"[WebRTC] canal de jogo aberto: jogoX"`; `chrome://webrtc-internals` mostra o DataChannel) e **medir a latência** WebRTC × WebSockets (fecha o aceite do item 2).
- **Leaderboard:** confirmação **visual** com dados reais (junto do E2E dos itens 4/5/6).

## 🧭 Decisões de escopo firmadas (NÃO reabrir)

- **FORA:** criptografia do tráfego (TLS/HTTPS/WSS).
- **FORA:** Kubernetes/orquestrador. Distribuição = **1 serviço por EC2 + Load Balancer**.
- **WebRTC** é o canal de jogo (migração efetiva — item 2), com fallback Socket.io.

---

## 🗓️ Histórico de evolução (changelog)

> **Acrescente uma linha sempre que um item mudar de estado** (ver [Regra permanente](#️-regra-permanente-para-o-agente--próxima-sessão--leia-antes-de-editar)). Mais recente no topo.

| Data | Mudança | Itens afetados | Reflexo nos requisitos |
|---|---|---|---|
| 2026-06-19 | **Correção de drift de referências** no Plano v2: ponteiros da física `game-gateway/` → `game-engine/` (itens 9.3, 9.5, 8, 9.6 e §3.3/§4) atualizados para o estado pós-item 1 | — (sem mudança de status) | — |
| 2026-06-19 | **Criação deste documento** (Rastreio de Evolução) como tracker operacional vivo da v2; consolidação do placar **6 ✅ / 6 🟡 / 6 ⛔** (18 itens) | — | Cross-link adicionado no Checklist de Requisitos |
| 2026-06-19 | Sessão **mensageria + leaderboard**: Kafka (produtor nos 3 engines) + Score Service (Python) + Redis alimentado + tela "Ranking Global" | 4, 5, 7 → 🟡; 6 → 🟡 | **2.3 e 2.4 ⛔→🟡**; 1.5/1.7 reforçados; 2.1 consolidado (Python real). Placar requisitos: **11 ✅ / 8 🟡 / 5 ⛔** |
| 2026-06-19 | Sessão **eixo distribuído + dívida técnica**: engines isolados, WebRTC (com fallback), correções rápidas | 1 → ✅; 2 → 🟡; 9.1/9.3/9.4/9.5/9.6 → ✅; 9.7 → 🟡 | 1.2/1.6 → 🟡 (particionamento funcional); 2.1 (3ª linguagem em curso) |
| (v1) | Fechamento de **todos os bugs de UI/UX e consistência de gameplay** apontados pelo QA (seções 1–2 do relatório) — base para a v2 | — | Núcleo de jogo (bloco 3) completo |
