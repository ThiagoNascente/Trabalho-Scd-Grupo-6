# Checklist de Requisitos da Especificação (Trabalho Final SCD 2026.1)

**Disciplina:** Software Concorrente e Distribuído — Prof. Fábio Moreira Costa
**Especificação:** [SCD-2026-1-EspecificaçãoTrabalhoFinal.pdf](SCD-2026-1-EspecificaçãoTrabalhoFinal.pdf)
**Cenário escolhido:** Exemplo **3 — Jogo online multijogador** (Spaceship)
**Data desta verificação:** 2026-06-19 · **Entrega:** 28/06/2026
**Plano de trabalho associado:** [Plano de correções pendentes para v2](../v2/Plano%20de%20correções%20pendentes%20para%20v2.md)
**Rastreio operacional:** [Rastreio de Evolução](../v2/Rastreio%20de%20Evolução.md) — checklist vivo do progresso da v2 (atualizado a cada sessão; é a fonte do "onde estamos agora").

> Legenda: `[x]` cumprido · `[ ]` ainda falta elaborar.
> Status detalhado: ✅ feito · 🟡 parcial (cumpre o mínimo, falta reforço) · ⛔ não atendido.
> A coluna "→ Plano v2" aponta o item correspondente do plano de correções.

> **Atualização 2026-06-19 (v2):** concluídos (a) as correções rápidas **9.1, 9.3, 9.4, 9.5, 9.6** (9.7 parcial); (b) **item 1 — Game Engines isolados** (3 processos independentes + gateway-relay, isolamento validado); (c) **item 2 — WebRTC** (canal de jogo no DataChannel com fallback Socket.io — implementado, falta validar no navegador); (d) **itens 4 e 5 — Kafka + Score Service**: cada engine publica `match-completed` ao fim da partida ([game-engine/kafka.js](../../game-engine/kafka.js)) e o novo **Score Service em Python** ([score-service/](../../score-service/)) consome, materializa o ranking por minigame no Redis e o histórico no PostgreSQL, expondo `GET /api/scores`; e (e) **item 7 — leaderboard**: tela "Ranking Global" no [frontend/index.html](../../frontend/index.html) consumindo o Score Service, com degradação graciosa. Reflexo no placar: **2.3 e 2.4 ⛔→🟡** (pub/sub e messaging implementados — falta o teste E2E com broker real na nuvem/Docker), **1.5/1.7** reforçados (assíncrono + consistência eventual) e **2.1** consolidado (Python agora é serviço real). Demais requisitos ainda dependem de Redis-leaderboard ponta a ponta, gRPC, replicação e AWS. Detalhes no [Plano v2](../v2/Plano%20de%20correções%20pendentes%20para%20v2.md).

> **Atualização 2026-06-19 (v2, 2ª rodada):** o ambiente passou a ter **Node + Python + .NET 8 + Java**. Entregues: **(4.2) clientes simulados** — harness `load-test/` com bots que jogam os 3 minigames em paralelo (8 bots → 6 partidas concorrentes, 0 erros; isolamento de falha demonstrado); **(4.8) dados de teste** versionados em `test-data/` (+ `selftest_dataset.py`); **(9.2) auth canônico** — C# oficial (compila aqui) e `auth-service-lite` alinhado (bcrypt, `/login → {token}`, TTL 2h); **(item 11) particionamento de dados** — `scores` particionada por minigame (`PARTITION BY LIST`, validado offline por `selftest_partition.py`). Reflexo: **4.2 🟡→✅**, **4.8 ⛔→✅**, **4.3 ⛔→🟡**, 1.6 reforçado. Placar geral: **13 ✅ / 8 🟡 / 3 ⛔**.

> **Atualização 2026-06-19 (v2, 3ª rodada):** stack Docker completa **validada E2E** — o fluxo `engine → Kafka → Score → Redis → API → tela` rodou ao vivo (3 rankings populados via harness, **confirmado visualmente pelo usuário**), após corrigir o **CORS** do Score e tornar o **produtor Kafka resiliente**. UI: **recorde pessoal no Command Center** (`/api/scores/player`) + ranking **top 5**. Reflexo: **2.3, 2.4 e 1.2 🟡→✅**; 1.5/1.7 reforçados (assíncrono/consistência eventual validados E2E — falta só o gRPC e a réplica). Placar geral: **16 ✅ / 5 🟡 / 3 ⛔**. Doc consolidada: HANDOFF removido (absorvido no Rastreio), `run.md` + `dev-stack.sh` adicionados.

---

## 1. Características obrigatórias do sistema (válidas para qualquer cenário)

- [ ] **1.1 — Serviço acessível a múltiplos clientes na Internet.** ⛔
  Hoje roda em `localhost`/LAN via [docker-compose.yml](../../docker-compose.yml); o cliente já suporta host remoto ([frontend/config.js](../../frontend/config.js)), mas **ainda não há deploy público na AWS**. → Plano v2 item 3, 12.

- [x] **1.2 — Integração e coordenação de vários componentes distribuídos (implementados no trabalho).** ✅
  Componentes reais e coordenados: Auth Service (C#), Game Gateway-relay (Node), **3 Game Engines independentes** ([game-engine](../../game-engine/), `GAME=jogo1|2|3`), **Score Service (Python)** ([score-service/](../../score-service/)), Frontend e PostgreSQL/Redis/Kafka. A **coordenação foi validada E2E na stack Docker**: o fluxo `engine → Kafka → Score → Redis → API → tela` roda ponta a ponta (3 rankings populados via harness, confirmado pelo usuário). **Falta** apenas o **deploy público na AWS** (req. 1.1/4.4 → itens 3/12).

- [x] **1.3 — Acessos concorrentes a recursos/dados compartilhados.** ✅
  O estado de cada sala é compartilhado e modificado simultaneamente por vários jogadores; o PostgreSQL recebe escritas/leituras concorrentes de usuários e vitórias.

- [x] **1.4 — Processamento de dados no lado servidor, concorrente com os acessos dos clientes.** ✅
  Servidor autoritativo com loop de física a 60 Hz por sala (`setInterval`/event loop do Node), processando enquanto os clientes enviam inputs. Várias partidas rodam concorrentemente.

- [ ] **1.5 — Mecanismos de interação remota síncrona (bloqueante) e assíncrona.** 🟡
  - *Síncrona:* REST do Auth (login/registro/wins) cobre o mínimo. O **gRPC** previsto (RPC bloqueante para validação de JWT) **ainda não existe** — validação é local ([game-gateway/index.js](../../game-gateway/index.js)). → Plano v2 item 8.
  - *Assíncrona:* WebSockets (push de estado em tempo real) + **messaging via Kafka** (`match-completed`: engines publicam, Score consome), **validado E2E na stack Docker** com broker real ([game-engine/kafka.js](../../game-engine/kafka.js), [score-service/consumer.py](../../score-service/consumer.py)). → Plano v2 itens 4, 5.

- [ ] **1.6 — Replicação e particionamento de dados e funcionalidades.** 🟡
  **Particionamento funcional** (3 engines isolados — item 1 ✅) **e de DADOS**: a tabela `scores` é **particionada por minigame** (PARTITION BY LIST em [score-service/store.py](../../score-service/store.py), validado offline por [selftest_partition.py](../../score-service/selftest_partition.py)) — item 11 🟡. **Falta** a **replicação** do PostgreSQL (instância única, item 10) e o E2E do pruning em PG real. → Plano v2 itens 10, 11.

- [ ] **1.7 — Tratamentos para garantir consistência de dados e disponibilidade.** 🟡
  Consistência transacional (BCrypt + EF Core/PostgreSQL) + `restart: unless-stopped`. A **consistência eventual** está implementada e **funcionou E2E na stack Docker**: o Score consome o Kafka com commit manual de offset após persistir (`enable_auto_commit=False` + `auto_offset_reset='earliest'`, [score-service/consumer.py](../../score-service/consumer.py)). **Falta** a **réplica** do PostgreSQL para disponibilidade de leitura. → Plano v2 item 10.

---

## 2. Modelos de programação e paradigmas de interação

- [x] **2.1 — Mais de uma linguagem de programação.** ✅
  C# (Auth) + JavaScript (Gateway/Engines/Frontend) + **Python** (Score Service, [score-service/](../../score-service/)) — três linguagens, todas em serviços reais.

- [x] **2.2 — Paradigma Cliente-Servidor.** ✅
  REST (HTTP) + WebSockets (Socket.io) entre navegador e backend.

- [x] **2.3 — Paradigma Publish-Subscribe.** ✅
  Os engines **publicam** `match-completed` no tópico Kafka ([game-engine/kafka.js](../../game-engine/kafka.js)) e o Score Service **assina/consome** via consumer group ([score-service/consumer.py](../../score-service/consumer.py)). **Validado E2E na stack Docker** (broker real): as partidas publicam e o Score materializa o ranking por minigame. → Plano v2 itens 4, 5.

- [x] **2.4 — Paradigma Messaging (mensageria assíncrona).** ✅
  Produtor (kafkajs, **resiliente** — [game-engine/kafka.js](../../game-engine/kafka.js)) e consumidor (kafka-python, [score-service/consumer.py](../../score-service/consumer.py)) de eventos `match-completed`, desacoplando o fim de partida da gravação da pontuação. **Validado E2E com broker real** (Kafka no Docker). → Plano v2 itens 4, 5.

---

## 3. Requisitos do cenário escolhido — Jogo online multijogador (Exemplo 3)

- [x] **3.1 — Múltiplos jogadores visualizam simultaneamente o estado compartilhado do jogo.** ✅
  Estado da partida transmitido a todos os jogadores da sala (`gameUpdate`).

- [x] **3.2 — Jogadores executam ações que modificam o estado compartilhado.** ✅
  Movimento e disparo enviados como inputs; o servidor aplica e atualiza o estado.

- [x] **3.3 — Jogadores recebem notificações de mudanças feitas por outros jogadores.** ✅
  Broadcast do estado e dos eventos (tiros, mortes, placar) para a sala.

- [x] **3.4 — Notificações por operações internas de manutenção das regras do jogo.** ✅
  O servidor executa e propaga regras automáticas: máquina de fases do chefe (alerta/freeze/entrada), progressão de dificuldade do Jogo 2 e geração de inimigos do Jogo 3. *Obs.: rotinas de manutenção em background (sanitização/expurgo via Score Service) ainda não existem.* → Plano v2 item 5.

---

## 4. Formato e entregáveis (seção "Formato" da especificação)

- [x] **4.1 — Grupo de 3–4 alunos.** ✅ Quatro integrantes (Thiago, Vinícius, Moisés, Ana Liz).

- [x] **4.2 — Implementação dos serviços + clientes simulados para demonstrar o uso.** ✅
  Serviços + cliente real (navegador) + **clientes simulados** ([load-test/](../../load-test/)): bots autenticam no Auth, conectam no gateway e jogam os 3 minigames **em paralelo** (8 bots → **6 partidas concorrentes, 0 erros**; isolamento de falha demonstrado). Validado localmente contra a stack lite; na AWS aponta para o Load Balancer (item 12).

- [ ] **4.3 — Cenário de demonstração representativo que exercite sistematicamente as características.** 🟡
  O harness [load-test/](../../load-test/) já roteiriza **concorrência** (N partidas simultâneas) e **tolerância a falha** (derrubar um engine e ver os demais jogos seguirem). **Falta** o roteiro completo cobrindo também **interação síncrona (gRPC)**, **replicação** e o particionamento exercitados na AWS. → Plano v2 itens 8, 10, 12.

- [ ] **4.4 — Executar a demonstração na nuvem AWS (EC2).** ⛔
  Deploy distribuído ainda não realizado. → Plano v2 itens 3, 12.

- [x] **4.5 — Código-fonte (e executáveis).** ✅ Código no repositório; imagens construíveis via Docker por serviço.

- [ ] **4.6 — Documentação (arquitetura e implementação).** 🟡
  Arquitetura documentada ([descrição](../Arquitetura/descrição%20da%20arquitetura.md) + [mermaid](../Arquitetura/Arquitetura_code.md)) e GDD existem; **falta documentação de implementação** (decisões de código, como cada serviço funciona) condizente com a versão final.

- [x] **4.7 — Instruções de uso (README).** ✅ [README.md](../../README.md) com passos de execução. *Atualizar para o deploy distribuído na AWS.* → Plano v2 item 9.7.

- [x] **4.8 — Dados de teste.** ✅
  Conjunto **versionado** em [test-data/](../../test-data/): usuários seed (para os clientes simulados), fixture determinístico de eventos `match-completed` e ranking esperado (oráculo), com selftest ([selftest_dataset.py](../../score-service/selftest_dataset.py)).

- [ ] **4.9 — Vídeo de demonstração (com participação de todos).** ⛔ Ainda não produzido.

---

## 5. Placar geral

| Bloco | Total | Cumpridos | Parciais | Não atendidos |
|---|---|---|---|---|
| 1. Características obrigatórias | 7 | 3 | 3 | 1 |
| 2. Modelos/paradigmas | 4 | 4 | — | — |
| 3. Cenário (jogo multiplayer) | 4 | 4 | — | — |
| 4. Formato/entregáveis | 9 | 5 | 2 | 2 |
| **Geral** | **24** | **16** | **5** | **3** |

**Resumo:** o **núcleo de jogo multiplayer (bloco 3) está completo**, as bases de concorrência (1.3, 1.4) sólidas, o **bloco de paradigmas (2.x) está 100%** e os **paradigmas async/pub-sub/messaging (2.3, 2.4) foram validados E2E na stack Docker** (Kafka real → Score em Python → Redis → leaderboard), o que também fechou a **coordenação distribuída (1.2 ✅)**. Já entregues: clientes simulados (4.2 ✅), dados de teste (4.8 ✅), particionamento de dados (1.6/item 11) e o leaderboard ponta a ponta (recorde pessoal + top 5). O que ainda falta concentra-se em **deploy na AWS (1.1/3) + gRPC síncrono (1.5/8) + replicação do PG (10)** e nos **entregáveis de demonstração** (AWS EC2, cenário roteirizado 4.3, vídeo 4.9).
