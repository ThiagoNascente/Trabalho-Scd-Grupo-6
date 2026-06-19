# Checklist de Requisitos da Especificação (Trabalho Final SCD 2026.1)

**Disciplina:** Software Concorrente e Distribuído — Prof. Fábio Moreira Costa
**Especificação:** [SCD-2026-1-EspecificaçãoTrabalhoFinal.pdf](SCD-2026-1-EspecificaçãoTrabalhoFinal.pdf)
**Cenário escolhido:** Exemplo **3 — Jogo online multijogador** (CosmoDock)
**Data desta verificação:** 2026-06-19 · **Entrega:** 28/06/2026
**Plano de trabalho associado:** [Plano de correções pendentes para v2](../v2/Plano%20de%20correções%20pendentes%20para%20v2.md)

> Legenda: `[x]` cumprido · `[ ]` ainda falta elaborar.
> Status detalhado: ✅ feito · 🟡 parcial (cumpre o mínimo, falta reforço) · ⛔ não atendido.
> A coluna "→ Plano v2" aponta o item correspondente do plano de correções.

> **Atualização 2026-06-19 (v2):** concluídos (a) as correções rápidas **9.1, 9.3, 9.4, 9.5, 9.6** (9.7 parcial); (b) **item 1 — Game Engines isolados** (3 processos independentes + gateway-relay, isolamento validado); (c) **item 2 — WebRTC** (canal de jogo no DataChannel com fallback Socket.io — implementado, falta validar no navegador); (d) **itens 4 e 5 — Kafka + Score Service**: cada engine publica `match-completed` ao fim da partida ([game-engine/kafka.js](../../game-engine/kafka.js)) e o novo **Score Service em Python** ([score-service/](../../score-service/)) consome, materializa o ranking por minigame no Redis e o histórico no PostgreSQL, expondo `GET /api/scores`; e (e) **item 7 — leaderboard**: tela "Ranking Global" no [frontend/index.html](../../frontend/index.html) consumindo o Score Service, com degradação graciosa. Reflexo no placar: **2.3 e 2.4 ⛔→🟡** (pub/sub e messaging implementados — falta o teste E2E com broker real na nuvem/Docker), **1.5/1.7** reforçados (assíncrono + consistência eventual) e **2.1** consolidado (Python agora é serviço real). Demais requisitos ainda dependem de Redis-leaderboard ponta a ponta, gRPC, replicação e AWS. Detalhes no [Plano v2](../v2/Plano%20de%20correções%20pendentes%20para%20v2.md).

---

## 1. Características obrigatórias do sistema (válidas para qualquer cenário)

- [ ] **1.1 — Serviço acessível a múltiplos clientes na Internet.** ⛔
  Hoje roda em `localhost`/LAN via [docker-compose.yml](../../docker-compose.yml); o cliente já suporta host remoto ([frontend/config.js](../../frontend/config.js)), mas **ainda não há deploy público na AWS**. → Plano v2 item 3, 12.

- [ ] **1.2 — Integração e coordenação de vários componentes distribuídos (implementados no trabalho).** 🟡
  Componentes reais e coordenados: Auth Service (C#), Game Gateway (Node, agora **relay**), **3 Game Engines independentes** ([game-engine](../../game-engine/), `GAME=jogo1|2|3`), **Score Service (Python)** ([score-service/](../../score-service/)), Frontend e PostgreSQL/Redis/Kafka. O gateway autentica/roteia, os engines rodam a física isolada (item 1 ✅) e publicam o fim de partida no Kafka, e o Score consome e materializa o ranking. **Falta** apenas validar a **coordenação E2E** (broker real) e o **deploy distribuído** (itens 3/12). → Plano v2 itens 5, 3, 12.

- [x] **1.3 — Acessos concorrentes a recursos/dados compartilhados.** ✅
  O estado de cada sala é compartilhado e modificado simultaneamente por vários jogadores; o PostgreSQL recebe escritas/leituras concorrentes de usuários e vitórias.

- [x] **1.4 — Processamento de dados no lado servidor, concorrente com os acessos dos clientes.** ✅
  Servidor autoritativo com loop de física a 60 Hz por sala (`setInterval`/event loop do Node), processando enquanto os clientes enviam inputs. Várias partidas rodam concorrentemente.

- [ ] **1.5 — Mecanismos de interação remota síncrona (bloqueante) e assíncrona.** 🟡
  - *Síncrona:* REST do Auth (login/registro/wins) cobre o mínimo. O **gRPC** previsto (RPC bloqueante para validação de JWT) **não existe** — validação é local ([game-gateway/index.js:19](../../game-gateway/index.js)). → Plano v2 item 8.
  - *Assíncrona:* WebSockets (push de estado em tempo real) + agora **messaging via Kafka** (`match-completed`: engines publicam, Score consome) — implementado ([game-engine/kafka.js](../../game-engine/kafka.js), [score-service/consumer.py](../../score-service/consumer.py)); falta o teste E2E com broker real. → Plano v2 itens 4, 12.

- [ ] **1.6 — Replicação e particionamento de dados e funcionalidades.** 🟡
  **Particionamento funcional real** já existe: os 3 jogos rodam em **processos/engines separados** ([game-engine](../../game-engine/)), com isolamento validado (derrubar um engine não afeta os demais) — item 1 ✅. **Falta** a **replicação** do PostgreSQL (instância única) e o **particionamento de dados** das tabelas de pontuação. → Plano v2 itens 10, 11.

- [ ] **1.7 — Tratamentos para garantir consistência de dados e disponibilidade.** 🟡
  Há consistência transacional básica (BCrypt + EF Core/PostgreSQL) e `restart: unless-stopped`. A **consistência eventual** já está implementada: o Score consome o Kafka com commit manual de offset após persistir (`enable_auto_commit=False` + `auto_offset_reset='earliest'`, [score-service/consumer.py](../../score-service/consumer.py)) — com o Score parado, os eventos ficam retidos e são processados ao subir. **Falta** a **réplica** do PostgreSQL para disponibilidade de leitura e o teste E2E. → Plano v2 itens 10, 12.

---

## 2. Modelos de programação e paradigmas de interação

- [x] **2.1 — Mais de uma linguagem de programação.** ✅
  C# (Auth) + JavaScript (Gateway/Engines/Frontend) + **Python** (Score Service, [score-service/](../../score-service/)) — três linguagens, todas em serviços reais.

- [x] **2.2 — Paradigma Cliente-Servidor.** ✅
  REST (HTTP) + WebSockets (Socket.io) entre navegador e backend.

- [ ] **2.3 — Paradigma Publish-Subscribe.** 🟡
  Implementado: os engines **publicam** `match-completed` no tópico Kafka ([game-engine/kafka.js](../../game-engine/kafka.js)) e o Score Service **assina/consome** via consumer group ([score-service/consumer.py](../../score-service/consumer.py)). Validada a lógica de ranking offline ([score-service/selftest.py](../../score-service/selftest.py)); **falta** o teste E2E com o broker real (sem Docker no ambiente de dev). → Plano v2 itens 4, 12.

- [ ] **2.4 — Paradigma Messaging (mensageria assíncrona).** 🟡
  Produtor (kafkajs, [game-engine/kafka.js](../../game-engine/kafka.js)) e consumidor (kafka-python, [score-service/consumer.py](../../score-service/consumer.py)) de eventos `match-completed` implementados, desacoplando o fim de partida da gravação da pontuação. **Falta** o teste E2E com broker real. → Plano v2 itens 4, 12.

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

- [ ] **4.2 — Implementação dos serviços + clientes simulados para demonstrar o uso.** 🟡
  Serviços e cliente real (navegador) existem; **faltam clientes simulados** (bots/script de carga) para exercitar o sistema sistematicamente. → Plano v2 item 12.

- [ ] **4.3 — Cenário de demonstração representativo que exercite sistematicamente as características.** ⛔
  Não há roteiro de demonstração que cubra concorrência, sync/async, replicação, particionamento e tolerância a falhas. → Plano v2 item 12.

- [ ] **4.4 — Executar a demonstração na nuvem AWS (EC2).** ⛔
  Deploy distribuído ainda não realizado. → Plano v2 itens 3, 12.

- [x] **4.5 — Código-fonte (e executáveis).** ✅ Código no repositório; imagens construíveis via Docker por serviço.

- [ ] **4.6 — Documentação (arquitetura e implementação).** 🟡
  Arquitetura documentada ([descrição](../Arquitetura/descrição%20da%20arquitetura.md) + [mermaid](../Arquitetura/Arquitetura_code.md)) e GDD existem; **falta documentação de implementação** (decisões de código, como cada serviço funciona) condizente com a versão final.

- [x] **4.7 — Instruções de uso (README).** ✅ [README.md](../../README.md) com passos de execução. *Atualizar para o deploy distribuído na AWS.* → Plano v2 item 9.7.

- [ ] **4.8 — Dados de teste.** ⛔
  Não há conjunto de dados de teste versionado para a demonstração.

- [ ] **4.9 — Vídeo de demonstração (com participação de todos).** ⛔ Ainda não produzido.

---

## 5. Placar geral

| Bloco | Total | Cumpridos | Parciais | Não atendidos |
|---|---|---|---|---|
| 1. Características obrigatórias | 7 | 2 | 4 | 1 |
| 2. Modelos/paradigmas | 4 | 2 | 2 | — |
| 3. Cenário (jogo multiplayer) | 4 | 4 | — | — |
| 4. Formato/entregáveis | 9 | 3 | 2 | 4 |
| **Geral** | **24** | **11** | **8** | **5** |

**Resumo:** o **núcleo de jogo multiplayer (bloco 3) está completo**, as bases de concorrência (1.3, 1.4) estão sólidas e os **paradigmas async/pub-sub (2.3, 2.4) já estão implementados em código** (Kafka + Score Service em Python), restando o teste E2E com broker real. O que ainda falta concentra-se em **distribuição real na AWS + leaderboard ponta a ponta + gRPC + replicação/particionamento** (itens técnicos do Plano v2) e nos **entregáveis de demonstração** (AWS EC2, cenário sistemático, clientes simulados, dados de teste e vídeo).
