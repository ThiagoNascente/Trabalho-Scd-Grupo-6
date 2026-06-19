# Checklist de Requisitos da Especificação (Trabalho Final SCD 2026.1)

**Disciplina:** Software Concorrente e Distribuído — Prof. Fábio Moreira Costa
**Especificação:** [SCD-2026-1-EspecificaçãoTrabalhoFinal.pdf](SCD-2026-1-EspecificaçãoTrabalhoFinal.pdf)
**Cenário escolhido:** Exemplo **3 — Jogo online multijogador** (CosmoDock)
**Data desta verificação:** 2026-06-19 · **Entrega:** 28/06/2026
**Plano de trabalho associado:** [Plano de correções pendentes para v2](../v2/Plano%20de%20correções%20pendentes%20para%20v2.md)

> Legenda: `[x]` cumprido · `[ ]` ainda falta elaborar.
> Status detalhado: ✅ feito · 🟡 parcial (cumpre o mínimo, falta reforço) · ⛔ não atendido.
> A coluna "→ Plano v2" aponta o item correspondente do plano de correções.

---

## 1. Características obrigatórias do sistema (válidas para qualquer cenário)

- [ ] **1.1 — Serviço acessível a múltiplos clientes na Internet.** ⛔
  Hoje roda em `localhost`/LAN via [docker-compose.yml](../../docker-compose.yml); o cliente já suporta host remoto ([frontend/config.js](../../frontend/config.js)), mas **ainda não há deploy público na AWS**. → Plano v2 item 3, 12.

- [ ] **1.2 — Integração e coordenação de vários componentes distribuídos (implementados no trabalho).** 🟡
  Existem componentes reais e coordenados: Auth Service (C#), Game Gateway (Node), Frontend e PostgreSQL. **Porém** os Game Engines e o Score Service descritos na arquitetura **não são serviços separados** — a física dos 3 jogos é um **monólito** dentro do gateway ([game-gateway/index.js](../../game-gateway/index.js)) e o Score é só stub. → Plano v2 itens 1, 5.

- [x] **1.3 — Acessos concorrentes a recursos/dados compartilhados.** ✅
  O estado de cada sala é compartilhado e modificado simultaneamente por vários jogadores; o PostgreSQL recebe escritas/leituras concorrentes de usuários e vitórias.

- [x] **1.4 — Processamento de dados no lado servidor, concorrente com os acessos dos clientes.** ✅
  Servidor autoritativo com loop de física a 60 Hz por sala (`setInterval`/event loop do Node), processando enquanto os clientes enviam inputs. Várias partidas rodam concorrentemente.

- [ ] **1.5 — Mecanismos de interação remota síncrona (bloqueante) e assíncrona.** 🟡
  - *Síncrona:* REST do Auth (login/registro/wins) cobre o mínimo. O **gRPC** previsto (RPC bloqueante para validação de JWT) **não existe** — validação é local ([game-gateway/index.js:19](../../game-gateway/index.js)). → Plano v2 item 8.
  - *Assíncrona:* WebSockets (push de estado em tempo real) cobre o mínimo. O **messaging assíncrono via Kafka não existe**. → Plano v2 item 4.

- [ ] **1.6 — Replicação e particionamento de dados e funcionalidades.** ⛔
  Sem replicação (PostgreSQL é instância única) e sem particionamento real — o particionamento "funcional" dos 3 jogos é só conceitual (rodam no mesmo processo). → Plano v2 itens 1, 10, 11.

- [ ] **1.7 — Tratamentos para garantir consistência de dados e disponibilidade.** 🟡
  Há consistência transacional básica (BCrypt + EF Core/PostgreSQL) e `restart: unless-stopped`. **Falta** a tolerância a falhas descrita (consistência eventual via Kafka, réplica para disponibilidade de leitura). → Plano v2 itens 4, 5, 10.

---

## 2. Modelos de programação e paradigmas de interação

- [x] **2.1 — Mais de uma linguagem de programação.** ✅
  C# (Auth) + JavaScript (Gateway/Frontend) já em uso. *Python (Score Service) previsto como 3ª linguagem ainda é stub.* → Plano v2 item 5.

- [x] **2.2 — Paradigma Cliente-Servidor.** ✅
  REST (HTTP) + WebSockets (Socket.io) entre navegador e backend.

- [ ] **2.3 — Paradigma Publish-Subscribe.** ⛔
  Kafka sobe no compose mas **ninguém publica/assina**. → Plano v2 item 4.

- [ ] **2.4 — Paradigma Messaging (mensageria assíncrona).** ⛔
  Sem produtor/consumidor de eventos `match-completed`. → Plano v2 itens 4, 5.

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
| 1. Características obrigatórias | 7 | 2 | 3 | 2 |
| 2. Modelos/paradigmas | 4 | 2 | — | 2 |
| 3. Cenário (jogo multiplayer) | 4 | 4 | — | — |
| 4. Formato/entregáveis | 9 | 3 | 2 | 4 |
| **Geral** | **24** | **11** | **5** | **8** |

**Resumo:** o **núcleo de jogo multiplayer (bloco 3) está completo** e as bases de concorrência (1.3, 1.4) estão sólidas. O que falta para atender plenamente a especificação concentra-se em **distribuição real + paradigmas async/pub-sub + replicação/particionamento + tolerância a falhas** (itens técnicos do Plano v2) e nos **entregáveis de demonstração** (AWS EC2, cenário sistemático, clientes simulados, dados de teste e vídeo).
