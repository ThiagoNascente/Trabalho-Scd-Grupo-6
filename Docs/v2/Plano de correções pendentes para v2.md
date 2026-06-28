# Plano de Correções Pendentes para a v2

> ⚠️ **REGISTRO HISTÓRICO (até 2026-06-27).** Documento de acompanhamento do
> processo, mantido como registro. **A fonte de verdade atual é o
> [README na raiz](../../README.md)** (visão geral, guias local/AWS, justificativa e
> checklist). Mudança posterior importante: o **WebRTC foi REMOVIDO** do projeto
> (não funcionava) — o canal de jogo em tempo real passou a ser **Socket.io** via
> gateway-relay. Trechos abaixo que citam "WebRTC" (em especial o "item 2") são
> desse contexto anterior.

**Projeto:** Spaceship — Jogo Online de Naves (Minigames 1, 2 e 3)
**Data:** 2026-06-19
**Base:** [Checklist de Requisitos da Especificação](../../README.md) · [relatorio_QA_v1.md](../v1/relatorio_QA_v1.md) · [QA_Status_v1.md](../v1/QA_Status_v1.md) · [Possiveis_problemas_v1.md](../v1/Possiveis_problemas_v1.md) · [GameDesignDocument.md](../GameDesignDocument.md) · [descrição da arquitetura.md](../Arquitetura/descrição%20da%20arquitetura.md) · [Arquitetura_code.md (mermaid)](../Arquitetura/Arquitetura_code.md)
**Responsáveis:** Thiago e Vinícius (Programação) · Moisés (GDD) · Ana Liz (QA)
**Acompanhamento:** o status vivo de cada item está no [Rastreio de Evolução](Rastreio%20de%20Evolução.md) (checklist operacional, atualizado a cada sessão). Este Plano guarda o **detalhe e o critério de aceite**; o Rastreio responde **"onde estamos agora"**.

---

## Propósito deste documento

O ciclo v1 fechou **todos os bugs de UI/UX e de consistência de gameplay** apontados pelo QA (seções 1 e 2 do relatório). O que **ainda falta** para o projeto contemplar a **v2** é, em essência:

1. **Transformar a arquitetura distribuída documentada em arquitetura real** (engines isolados, Kafka, Redis, Score Service, gRPC, leaderboard).
2. **Distribuir o sistema na AWS com uma instância EC2 por serviço e balanceamento de carga** — *sem* Kubernetes/orquestrador.
3. **Migrar o transporte de tempo real de WebSockets para WebRTC** para reduzir o input lag.
4. Fechar dívidas técnicas pontuais de código × documentação.

### Decisões de escopo desta revisão (importante)

- **Criptografia entre serviços está FORA do escopo.** Decidiu-se que o modelo atual de comunicação (HTTP/WS em texto puro dentro da rede da aplicação) **é suficiente** para os objetivos do projeto. Os itens de TLS/HTTPS/WSS da revisão anterior foram **removidos** deste plano.
- **Kubernetes está FORA do escopo.** A distribuição será feita com **EC2 dedicada por serviço + Load Balancer**, não com orquestração de contêineres. Os manifestos em `k8s/` ficam **obsoletos** (ver item 5.4).
- **WebRTC é decisão firmada** (não é mais só uma "prova de conceito"): substitui o WebSockets como canal de jogo em tempo real.

> **Legenda de prioridade:** 🔴 Crítico (bloqueia a definição de "v2") · 🟠 Alto · 🟡 Médio.
> **Legenda de esforço:** ◐ baixo · ◑ médio · ● alto.

---

## Quadro-resumo dos pendentes

| # | Pendência | Origem | Prio | Esforço |
|---|---|---|---|---|
| 1 | ✅ Game Engines isolados — agora 3 processos independentes (`game-engine`, GAME=jogo1\|2\|3); falta só a EC2 dedicada (item 3) | QA §3 / Arquitetura | 🔴 | ● |
| 2 | 🟡 Migração WebSockets → **WebRTC** (canal de jogo) — implementado com fallback; falta validar handshake no navegador + medir latência | QA §3 / decisão v2 | 🔴 | ● |
| 3 | 🟡 **Distribuição na AWS** (balanceamento por matchmaking, **sem ALB**) — **condensado em 6 EC2** (`deploy/aws/deploy1.sh`…`deploy6.sh`; limite de 9 instâncias da conta) + [Guia de Deploy AWS](../../README.md) prontos; falta o usuário executar | Possiveis_problemas / decisão v2 | 🔴 | ● |
| 4 | ✅ Apache Kafka — produtor **resiliente** nos 3 engines + consumidor no Score; **E2E validado na stack Docker** (partidas publicam, Score consome) | QA §3 / Arquitetura | 🔴 | ◑ |
| 5 | ✅ Score Service (Python) — consumer Kafka + Redis/PostgreSQL + `GET /api/scores` (+ `/api/scores/player`, CORS); **E2E validado** (3 rankings populados) | QA §3 / Arquitetura | 🔴 | ● |
| 6 | ✅ Redis — ranking por minigame alimentado pelo Score e **lido E2E pela API** (`ZREVRANGE`/`ZSCORE`, sem varrer o PG) | QA §3 / Arquitetura | 🟠 | ◑ |
| 7 | ✅ Leaderboard global por minigame — backend + tela "Ranking Global" (top 5) + recorde pessoal no Command Center; **confirmado visualmente** | GDD / Possiveis_problemas | 🔴 | ◑ |
| 8 | ✅ gRPC síncrono — `ValidateToken` no Auth C# (assinatura + existência do usuário/revogação) + cliente no gateway com fallback local; `dotnet build` OK + cliente validado em 5 cenários | Arquitetura | 🟠 | ◑ |
| 9.1 | ✅ Validação de usuário/senha (4–30) no servidor C# | Possiveis_problemas | 🟠 | ◐ |
| 9.2 | ✅ Auth canônico decidido — C# é o oficial (compila aqui); `auth-service-lite` alinhado (bcrypt, `/login → {token}`, TTL 2h, validação 4–30) | Revisão v2 | 🟠 | ◐ |
| 9.3 | ✅ Regra de vitória do Jogo 1 alinhada ao GDD (revisada pós-playtest: placar acumulativo, vence por 2 de vantagem) | Revisão v1 (E2) | 🟡 | ◐ |
| 9.4 | ✅ Remover manifestos k8s (fora de escopo agora) | Decisão v2 | 🟡 | ◐ |
| 9.5 | ✅ Código morto: inimigo `formacao` | Revisão v1 (E3) | 🟡 | ◐ |
| 9.6 | ✅ Segredos/credenciais por variável de ambiente (deploy AWS) | Deploy | 🟠 | ◐ |
| 9.7 | ✅ Guia de Deploy AWS criado + v1 marcada como histórica (link morto resolvido) + README aponta p/ o guia | Revisão v2 | 🟡 | ◐ |
| 10 | 🟡 Replicação do PostgreSQL (Primary-Replica) — setup pronto (primário no `deploy1.sh`, réplica no `deploy2.sh`, streaming); falta executar/validar na AWS | QA §3 / Arquitetura | 🟠 | ◑ |
| 11 | 🟡 Particionamento de dados — tabela `scores` particionada por LISTA do minigame (validado offline; falta E2E em PG real) | QA §3 / Arquitetura | 🟡 | ◑ |
| 12 | 🟡 Bateria de testes na AWS — clientes simulados (req. 4.2) + dados de teste (req. 4.8) entregues e validados localmente; falta a bateria na AWS | QA §4 | 🟠 | ◑ |

> Itens **removidos** em relação à revisão anterior: *Criptografia/TLS de todas as comunicações* e *WebRTC como PoC* (agora é migração efetiva, item 2). O bug de `targetPort` do k8s some porque os manifestos k8s serão descartados (item 5.4).

---

## 1. Conformidade com a arquitetura em mermaid

Comparação entre **o que está sendo construído** e o diagrama de referência ([Arquitetura_code.md](../Arquitetura/Arquitetura_code.md), já atualizado nesta revisão):

| Elemento do diagrama | Estado atual no código | Conformidade |
|---|---|---|
| Cliente ↔ servidor por **WebRTC** (canal de jogo) | **WebRTC DataChannel** (geckos.io) para inputs+estado, com fallback Socket.io | 🟡 Implementado (item 2); falta validar no navegador + medir latência |
| Sinalização/lobby via WS + REST | Existe (Socket.io + REST no Auth) | ✅ |
| **1 serviço por EC2 + Load Balancer** | Tudo roda junto via `docker-compose`; sem deploy AWS | ⛔ → **distribuir** (item 3) |
| **Game Engines** (1 por jogo) | 3 processos independentes (`game-engine`, `GAME=jogo1\|2\|3`); gateway é relay | ✅ (item 1) |
| Gateway valida JWT via **gRPC** ao Auth | Validação **local** com a chave compartilhada | ⛔ → item 8 |
| Engine → **Kafka** → Score | Engines publicam `match-completed`; Score consome — **E2E validado na Docker** | ✅ (itens 4, 5) |
| **Redis** (cache leaderboard) | Ranking por minigame materializado e lido pela API direto do Redis | ✅ (item 6) |
| **Leaderboard** por minigame | Tela "Ranking Global" (top 5) + recorde no Command Center, servidos pelo Score | ✅ (item 7) |
| PostgreSQL Primary-Réplica | Instância única (tabela `scores` **particionada** por minigame) | ⛔ replicação (item 10); 🟡 particionamento (item 11) |

> **Conclusão:** o código **convergiu para o diagrama** no eixo distribuído — engines isolados, Kafka/Score/Redis/leaderboard em uso e **validados E2E** na stack Docker. Para fechar o diagrama faltam: o **gRPC** (item 8), a **distribuição na AWS** (item 3 — EC2-por-serviço, sem Kubernetes) e a **réplica do PostgreSQL** (item 10). O **WebRTC** já é o canal de jogo (com fallback Socket.io), pendente só a validação de latência no navegador (item 2).

---

## 2. Migração WebSockets → WebRTC (canal de jogo)  🔴 ● — item 2

- **Situação:** todo o tráfego de jogo passa por Socket.io/WebSockets ([game-gateway/index.js:1-24](../../game-gateway/index.js); cliente em [frontend/index.html](../../frontend/index.html)). WebSocket é TCP — sujeito a head-of-line blocking, o que agrava o input lag relatado no QA.
- **Entregar:**
  - **Canal de jogo (inputs do cliente + estado do servidor) via WebRTC DataChannel** em modo *unreliable/unordered* (UDP), trocando o `socket.emit('playerMovement'/'shoot')` e o `gameUpdate` por mensagens no DataChannel.
  - Manter **WebSocket/REST apenas para login, lobby e sinalização** (troca de SDP/ICE para abrir o DataChannel).
  - No servidor, usar uma lib de WebRTC para Node (ex.: `node-datachannel` / `werift` / `geckos.io`, que já encapsula servidor de jogo UDP + sinalização).
  - Prever **STUN** (e **TURN** como fallback de NAT) — em EC2 com IP público, STUN costuma bastar (ver item 3).
- **Conformidade:** alinha o código ao mermaid (que agora mostra `WebRTC DataChannel` direto cliente ↔ engine).
- **Aceite:** uma partida roda inteiramente sobre WebRTC; medição de latência mostra redução vs WebSockets (registrar números — substitui a antiga "PoC").
- **✔ Implementado (v2):** canal de jogo via **WebRTC DataChannel** com [geckos.io](https://github.com/geckosio/geckos.io) (UDP, não-confiável). O **hot path** (inputs `playerMovement`/`shoot`/`acao`/`j3_move`/`j3_shoot` e estado `gameUpdate`/`estadoDoJogo`/`j3_gameState`) trafega direto cliente↔engine pelo DataChannel; lobby, controle e sinalização seguem no Socket.io. Servidor: [game-engine/server.js](../../game-engine/server.js) (geckos por engine, porta de sinalização 5001/5002/5003, faixa UDP/ICE configurável). Cliente: [frontend/index.html](../../frontend/index.html) (helper `RT` + bundle [vendor/geckos.client.iife.js](../../frontend/vendor/geckos.client.iife.js)); flag `USE_WEBRTC` em [frontend/config.js](../../frontend/config.js). **Fallback automático para Socket.io** se o canal não abrir (sem regressão — validado por teste node-side). **Pendente:** confirmar o handshake no navegador e **medir a latência** (WebRTC × WebSockets) para registrar os números do aceite. TURN como fallback de NAT entra no item 3 (AWS).

---

## 3. Distribuição na AWS — balanceamento (deploy condensado em 6 EC2)  🔴 ● — item 3

Este é o **novo eixo central da v2**: sair do `docker-compose` único e colocar **cada serviço em sua própria instância EC2**, com balanceamento de carga, **sem Kubernetes**.

> **Atualização (execução):** a conta AWS limita a **9 instâncias simultâneas**, então o deploy foi **condensado para 6 máquinas** (`deploy/aws/deploy1.sh`…`deploy6.sh`) — mantendo em EC2 **separadas** o que mais importa: o **primário × réplica** do PostgreSQL (item 10) e os **3 engines isolados** (particionamento funcional). A topologia final, com a **descrição dos 6 deploys**, está no **[Guia de Deploy AWS §1](../../README.md)**. A tabela 3.1 abaixo é o **ideal "1 serviço por EC2"** que inspirou o agrupamento.

### 3.1 Topologia de instâncias (ideal 1-serviço-por-EC2 — condensado em 6 na execução; ver nota acima)

| Instância EC2 | Serviço | Porta | Exposição |
|---|---|---|---|
| `ec2-frontend` | Frontend estático (Nginx) | 80 | Pública (via LB) |
| `ec2-auth` | Auth Service (C#) | 5000 | Interna (via LB rota `/api/auth`) |
| `ec2-gateway` | Gateway / Lobby / Sinalização (Node) | 3000 | Pública (via LB; WS de sinalização) |
| `ec2-engine-1` | Game Engine Jogo 1 (Node + WebRTC) | UDP* | Pública (WebRTC direto) |
| `ec2-engine-2` | Game Engine Jogo 2 (Node + WebRTC) | UDP* | Pública (WebRTC direto) |
| `ec2-engine-3` | Game Engine Jogo 3 (Node + WebRTC) | UDP* | Pública (WebRTC direto) |
| `ec2-score` | Score Service (Python) | 8000 | Interna (via LB rota `/api/scores`) |
| `ec2-postgres` | PostgreSQL (Primary; réplica no item 10) | 5432 | Interna |
| `ec2-redis` | Redis | 6379 | Interna |
| `ec2-kafka` | Kafka + Zookeeper | 9092 | Interna |

\* *Faixa de portas UDP/ICE do WebRTC liberada no Security Group do engine.*

### 3.2 Balanceamento de carga

> **Decisão v2 firmada:** o balanceamento fica **só no matchmaking do gateway** (escolhe o engine e devolve o endereço ao cliente). O **ALB é opcional** e **não** é usado por padrão — o frontend fala direto com o DNS público de cada serviço ([Guia de Deploy AWS](../../README.md)). O texto abaixo descreve o ALB apenas como alternativa.

- **Load Balancer (ALB) para HTTP/REST e sinalização:** roteia por caminho — `/` → frontend, `/api/auth` → auth, `/ws/lobby` → gateway, `/api/scores` → score. **Health checks** por target group.
- **Tráfego de jogo (WebRTC/UDP) NÃO passa pelo ALB:** o ALB é L7/HTTP. O **balanceamento das partidas** acontece no **matchmaking**: o gateway escolhe qual `ec2-engine-N` hospeda a sala (por jogo e por carga) e devolve ao cliente o endereço daquela EC2; o cliente abre o WebRTC **direto** com ela. Isso atende ao requisito de "balancear a carga" e ao item de *divisão de servidores para salas abertas* do QA §3.
- Para múltiplas instâncias do **mesmo** jogo no futuro, o gateway mantém um registro de engines disponíveis e distribui salas entre elas (round-robin / por nº de salas ativas).

### 3.3 Preparativos para rodar na AWS (o que codar/configurar)

1. **Externalizar TODA a configuração de endereços** (continuação do trabalho do v1):
   - Cliente já lê `window.APP_CONFIG` ([frontend/config.js](../../frontend/config.js)); estender para o endereço do gateway/sinalização e para o engine retornado pelo matchmaking.
   - Backend: cada serviço lê os endereços dos demais por **variável de ambiente** (ex.: `AUTH_API_URL`, `KAFKA_BROKER`, `REDIS_URL`, `PG_HOST`, `ENGINE_HOSTS`). Hoje o gateway usa `ENGINE1/2/3_URL`+`JWT_SECRET` ([game-gateway/index.js:23,31-35](../../game-gateway/index.js)) e os engines usam `AUTH_API_URL`+`KAFKA_BROKER` ([game-engine/server.js:28](../../game-engine/server.js)). Ampliar e documentar no `.env.example`.
2. **Service discovery simples:** Route53 Private Hosted Zone (ex.: `auth.internal`, `kafka.internal`) **ou** IPs privados fixos em variáveis de ambiente. Sem k8s, basta um desses.
3. **Security Groups** (substituem a rede do compose):
   - LB: 80/443 públicos.
   - Engines: faixa UDP/ICE pública (WebRTC) + porta de sinalização.
   - Auth/Score/Postgres/Redis/Kafka: portas abertas **apenas** para os SGs dos serviços que os consomem (rede privada da VPC).
4. **Empacotamento e execução por instância (decisão v2 — SEM Docker na AWS):** cada serviço sobe **nativo** via `deploy/aws/<serviço>.sh` (instala a dependência nativa e registra um serviço **systemd**). Docker/`docker-compose` fica **só para desenvolvimento local**. *(Revisão: a versão anterior previa `docker run`/imagem por EC2; foi substituída por execução nativa a pedido do time.)*
5. **Inicialização:** clonar o repo + `cp deploy/aws/env.aws.example deploy/aws/env.aws` (preencher segredos/IPs) + rodar o script do serviço; o **systemd** sobe no boot e reinicia se cair. (Sem Docker/imagens/`user-data` obrigatório.)
6. **Guia de deploy AWS** ✔ — [Guia de Deploy AWS](../../README.md): passo a passo por instância + Security Groups + ordem + bateria de testes (item 5.7/12).

### 3.4 Aceite

- Cada serviço roda em uma EC2 distinta; derrubar uma EC2 de engine não afeta os demais jogos.
- Login, lobby e leaderboard chegam via Load Balancer; a partida conecta via WebRTC direto ao engine atribuído pelo matchmaking.
- Nenhuma porta/endereço chumbado no código — tudo por env/`config.js`.

---

## 4. Arquitetura distribuída real (engines, Kafka, Score, Redis, gRPC, leaderboard)

Verificação (atualizada após os itens 1/4/5): a **física saiu do gateway** e passou a viver nos [game-engine](../../game-engine/) (`games/jogo1|2|3.js`); **Kafka** e **Redis** deixaram de ser contêineres ociosos e passaram a ser usados ([game-engine/kafka.js](../../game-engine/kafka.js) publica; [score-service/](../../score-service/) consome e materializa o ranking). Um `grep -rn -i "grpc"` no código-fonte (`.js`, `.cs`, `.csproj`, `.py`) **ainda não retorna nenhum uso** — o **gRPC (item 8)** é a única peça desta seção que continua só no diagrama.

### 4.1 🔴 Game Engines isolados — `game-engine/` (item 1)

- **Situação:** ~~stub; lógica dos 3 jogos dentro do gateway~~ → **resolvido**.
- **Entregar:** extrair os loops de física (Jogo 1/2/3) para **processos/serviços independentes** (Node.js), cada um na sua EC2 (item 3). O gateway passa a só fazer lobby + sinalização. Cada engine termina hospedando o servidor WebRTC da sala (item 2).
- **Aceite:** derrubar o engine do Jogo 1 não afeta partidas dos Jogos 2 e 3 (Particionamento Funcional real).
- **✔ Concluído (v2):** física extraída para o serviço [game-engine](../../game-engine/) (módulos `games/jogo1|2|3.js` + `shared/constants.js`), com `server.js` parametrizado por `GAME`. São **3 processos independentes** (portas 4001/4002/4003). O [game-gateway](../../game-gateway/index.js) virou **relay**: autentica (JWT), faz lobby/roteamento e abre uma conexão-proxy por jogador a cada engine (id do cliente repassado como `playerId`), sem rodar física. **Isolamento validado**: com o engine do Jogo 1 derrubado, Jogos 2 e 3 continuam respondendo (`JOGO1=FALHOU JOGO2=OK JOGO3=OK`). Falta apenas a **EC2 dedicada por engine** (item 3) e a migração do transporte para **WebRTC** (item 2).

### 4.2 🔴 Apache Kafka — produtor/consumidor (item 4)

- **Situação:** ~~Kafka + Zookeeper sobem; ninguém publica/consome~~ → **implementado** (falta E2E com broker real).
- **Entregar:** cada Engine publica `match-completed` ao fim da partida (`kafkajs`); Score Service consome (cliente Kafka Python).
- **Aceite:** com o Score Service **parado**, encerrar partidas **não perde** pontuação — ao subir o serviço, os eventos retidos são processados (Consistência Eventual).
- **✔ Implementado (v2):** produtor `kafkajs` em [game-engine/kafka.js](../../game-engine/kafka.js) (`publishMatchCompleted`, tolerante a falha — nunca lança), inicializado em [game-engine/server.js](../../game-engine/server.js) e disparado nos 3 ganchos de fim de partida: Jogo 1 ([games/jogo1.js](../../game-engine/games/jogo1.js) `handleHit`), Jogo 2 ([games/jogo2.js](../../game-engine/games/jogo2.js) `fimDeJogo`) e Jogo 3 ([games/jogo3.js](../../game-engine/games/jogo3.js) `j3_gameOver`, vitória e derrota). Consumidor Python com **commit manual de offset após persistir** e `auto_offset_reset='earliest'` ([score-service/consumer.py](../../score-service/consumer.py)) → o aceite de Consistência Eventual fica garantido pela retenção do Kafka. Broker/tópico por env (`KAFKA_BROKER`/`MATCH_TOPIC`); compose injeta `kafka:29092` nos 3 engines + Score. **Validado:** sem broker e com broker morto o engine **não quebra** (fallback, testado node-side); a lógica do consumidor/ranking foi validada offline ([selftest.py](../../score-service/selftest.py)).
- **✅ E2E validado (3ª rodada):** na stack Docker completa, partidas reais publicam `match-completed` e o Score consome → ranking populou ao vivo. O produtor virou **resiliente** ([game-engine/kafka.js](../../game-engine/kafka.js) `ensureProducer`): reconecta se o Kafka ficar pronto depois dos engines (corrige o bug que desativava a publicação no boot). **Resta** roteirizar o cenário de **retenção** (Score parado) para a demo — passos em [README §5](../../README.md).

### 4.3 🔴 Score Service (Python/Flask) — `score-service/` (item 5)

- **Situação:** ~~stub; o gateway grava win via REST no Auth~~ → **implementado** (serviço Python real).
- **Entregar:** serviço Python que consome `match-completed`, atualiza ranking no **Redis**, persiste no PostgreSQL e expõe `GET /api/scores` para o leaderboard.
- **Aceite:** fim de partida grava pontuação **sem** o gateway chamar o Auth diretamente.
- **✔ Implementado (v2):** serviço Flask em [score-service/](../../score-service/) — consumidor Kafka em thread de fundo ([consumer.py](../../score-service/consumer.py)) → materializa o ranking por minigame no **Redis** (sorted set) e grava o histórico no **PostgreSQL** (tabela `scores`, criada no boot) ([store.py](../../score-service/store.py)); expõe `GET /api/scores?game=jogoN` + `/health` ([app.py](../../score-service/app.py)). Política por minigame: Jogo 1 = total de vitórias (`ZINCRBY`); Jogo 2/3 = melhor pontuação (`ZADD GT`). Tudo por env ([config.py](../../score-service/config.py)); `Dockerfile` + `requirements.txt` prontos; serviço adicionado ao [docker-compose.yml](../../docker-compose.yml). O fim de partida **não** passa mais pelo Auth para a pontuação — flui pelo Kafka (o `Wins` do Jogo 1 segue como contador legado no Auth, em paralelo). **Validado:** deps instalam (venv Python 3.13), `app.py` importa e sobe degradando com elegância sem Kafka/Redis/PG; rotas REST respondem (`/health` 200, `game` inválido 400, Redis fora 503); `selftest.py` confere a política de ranking.
- **✅ E2E validado (3ª rodada):** na stack Docker, o Score consumiu os eventos e materializou os **3 rankings** (lidos pela API via harness). Adicionados o endpoint **`GET /api/scores/player`** (recorde por jogador, para o Command Center) e **CORS** ([app.py](../../score-service/app.py)) para o frontend ler de outra origem.

### 4.4 🟠 Redis — cache do leaderboard (item 6)

- **Situação:** ~~contêiner sobe; sem uso~~ → **em uso** pelo Score Service (falta a leitura E2E).
- **Entregar:** ranking por minigame em Redis (sorted set), alimentado pelo Score Service.
- **Aceite:** a leitura do leaderboard vem do Redis, não de varredura no PostgreSQL.
- **🟡 Parcial (v2):** o Score Service grava o ranking por minigame em sorted sets `leaderboard:jogoN` (`ZINCRBY`/`ZADD GT`) e a rota `GET /api/scores` lê **direto do Redis** (`ZREVRANGE`), sem varrer o PostgreSQL ([score-service/store.py](../../score-service/store.py)).
- **✅ E2E validado (3ª rodada):** a API lê o ranking **direto do Redis** na stack Docker (sem varrer o PG) e usa `ZSCORE` para o recorde do jogador; a tela que consome existe (item 7).

### 4.5 🟠 gRPC síncrono — validação de JWT (item 8)

- **Situação:** o gateway valida o JWT **localmente** (`jwt.verify(token, JWT_SECRET, ...)`, [game-gateway/index.js:47](../../game-gateway/index.js)); os engines também validam localmente ([game-engine/server.js:42](../../game-engine/server.js)).
- **Entregar:** endpoint gRPC no Auth (C#) para validação de sessão, chamado pelo gateway na conexão/entrada de sala.
- **Aceite:** revogar/expirar a sessão no Auth invalida novas conexões pelo gateway.
- **✔ Implementado (v2):** contrato [auth.proto](../../auth-service/Protos/auth.proto) (cópia em [game-gateway/auth.proto](../../game-gateway/auth.proto)); servidor [AuthValidationService.cs](../../auth-service/Services/AuthValidationService.cs) numa porta **HTTP/2 separada** (`GRPC_PORT`/5005 em [Program.cs](../../auth-service/Program.cs)) valida assinatura/emissor/audiência/expiração **e a existência do usuário** (revogação real — um usuário removido invalida novas conexões); cliente [authClient.js](../../game-gateway/authClient.js) chamado em [game-gateway/index.js](../../game-gateway/index.js) com **fallback local** (erro de transporte → `jwt.verify`, sem quebrar a v1). `AUTH_GRPC_URL` no [docker-compose.yml](../../docker-compose.yml) e no [.env.example](../../.env.example). **Validado:** `dotnet build` (0 erros) + cliente em **5 cenários** (válido, revogação, assinatura inválida, fallback de transporte, modo local puro). E2E ao vivo C#↔Node↔PG roteirizado no [Guia de Deploy AWS §5.4](../../README.md).

### 4.6 🔴 Leaderboard global (item 7)

- **Situação:** ~~não há leaderboard no frontend nem no backend; só o contador `Wins`~~ → **implementado** (backend + tela).
- **Entregar:** pontuação **por minigame** (não só "vitórias"); tela de leaderboard com acesso no dashboard (nome, pontuação, data), servida pelo Score Service.
- **Aceite:** após uma partida, a pontuação obtida aparece no ranking do respectivo minigame.
- **✔ Implementado (v2):** **backend** = `GET /api/scores` do Score Service (ranking por minigame a partir do Redis — item 4.3). **Frontend** = nova **tela de Ranking Global** acessível por botão no dashboard ([frontend/index.html](../../frontend/index.html): `openLeaderboard`/`loadLeaderboard`/`renderLeaderboard`, tela `leaderboard-container`), com uma coluna por jogo (Jogo 1 = vitórias; Jogo 2/3 = melhor pontuação). Endpoint configurável por `SCORE_PORT` em [frontend/config.js](../../frontend/config.js). **Degrada com elegância:** se o Score Service não estiver acessível (ex.: stack DEV sem Kafka/Redis), mostra aviso e **não quebra a v1**. **Validado:** data path write+read com Redis real (`fakeredis`, API `redis-py`: `ZINCRBY`/`ZADD GT`/`ZREVRANGE`) e o contrato HTTP que o frontend consome; sintaxe do JS do cliente conferida.
- **✅ E2E validado (3ª rodada):** na stack Docker, após partidas a pontuação **aparece no ranking** do minigame (**confirmado pelo usuário**). Tela ajustada: **top 5** por jogo, **recorde pessoal no Command Center** (`GET /api/scores/player`) e layout do bloco corrigido (cabe o Jogo 3).

> **Nota:** o requisito de [Possiveis_problemas_v1.md](../v1/Possiveis_problemas_v1.md) — *"a pontuação de cada jogo deve ser salva permanentemente ao perfil"* — hoje é cumprido só parcialmente (contador `Wins` agregado, sem pontuação por jogo).

---

## 5. Dívida técnica e consistência de código (item 9)

### 5.1 🟠 Validação de usuário/senha (4–30) no servidor canônico (9.1)

- **Situação:** o requisito de tamanho (4–30 caracteres, [Possiveis_problemas_v1.md](../v1/Possiveis_problemas_v1.md)) é validado **no cliente** ([frontend/index.html:606-607](../../frontend/index.html)) e no **auth-service-lite** ([server.js:31-32](../../auth-service-lite/server.js)), mas **não** no `auth-service` C# usado no [docker-compose.yml](../../docker-compose.yml). `AuthController.Register` ([AuthController.cs:25](../../auth-service/Controllers/AuthController.cs)) aceita qualquer tamanho → validação **burlável** por chamada direta à API.
- **Entregar:** validação server-side (DataAnnotations no `UserDto` ou checagem no controller).
- **Aceite:** `POST /api/auth/register` fora de 4–30 retorna `400` mesmo sem passar pelo frontend.
- **✔ Concluído (v2):** `UserDto` valida tamanho via DataAnnotations `[StringLength(30, MinimumLength = 4)]` em [auth-service/Models/User.cs:13-22](../../auth-service/Models/User.cs) e o atributo `[ApiController]` ([AuthController.cs:12](../../auth-service/Controllers/AuthController.cs)) devolve `400` automaticamente para payloads fora de 4–30.

### 5.2 🟠 Decidir o serviço de auth canônico (9.2)

- **Situação:** coexistem `auth-service` (C# + PostgreSQL + **BCrypt**, usado no compose) e `auth-service-lite` (Node + JSON + **SHA-256 sem salt**, fora do compose). Regras divergentes (só o lite valida tamanho) e segurança diferente.
- **Entregar:** definir um como oficial; se o lite for só para dev sem Docker, documentar e alinhar validações; senão, removê-lo.
- **Aceite:** uma única fonte de verdade de autenticação.
- **✔ Concluído (v2):** **`auth-service` (C#) é o canônico** (BCrypt + PostgreSQL + EF Core, no compose) — confirmado que **compila** neste ambiente (`dotnet build` → 0 erros, agora com .NET 8). O `auth-service-lite` foi **rebaixado a espelho de DEV** e **alinhado** ao canônico em [auth-service-lite/server.js](../../auth-service-lite/server.js): hashing por **bcrypt** (`bcryptjs`, era SHA-256 sem salt), contrato `/login → { token }` (igual ao C#), **TTL de 2h** e mesmas claims/issuer/audience; validação 4–30 já existia. Cabeçalho do arquivo documenta a decisão. **Validado** (lite no ar): register válido → 201, username `<4` → **400**, login devolve só `{token}`, token com `sub`/`iss=spaceship_auth`/`aud=spaceship_gateway`/**TTL 2h**, e o hash gravado começa com **`$2a$`** (bcrypt). `users.json` resetado (hashes SHA-256 legados são incompatíveis — ver README).

### 5.3 🟡 Regra de vitória do Jogo 1 diverge do GDD (9.3)

- **Situação:** o código encerrava com `p1Score >= 2 || p2Score >= 2` (primeiro a 2) — no gateway monolítico (antes do item 1). O GDD descreve **"3 vitórias consecutivas"** e o código **não** zerava a sequência ao perder um round.
- **Entregar:** alinhar código e GDD (escolher a regra e implementá-la, incluindo reset de sequência se for "consecutivas").
- **Aceite:** condição de vitória idêntica entre jogo e documento.
- **✔ Concluído (v2):** implementadas **3 vitórias consecutivas** com reset da sequência do adversário (`ROUNDS_TO_WIN = 3`) em [game-engine/games/jogo1.js](../../game-engine/games/jogo1.js), alinhado ao GDD (Minigame 1 — Duelo).
- **🔁 Revisão pós-playtest (AWS, 2026-06-27):** a pedido da equipe, a regra mudou para **placar acumulativo com vitória por 2 de vantagem** — cada round soma 1 ponto e o adversário **não** é zerado; vence quem abrir 2 de diferença (menor partida 2×0). Implementação: `WIN_MARGIN = 2` em [game-engine/games/jogo1.js:22](../../game-engine/games/jogo1.js) + condição `Math.abs(p1Score - p2Score) >= WIN_MARGIN` em `handleHit` (linha 87). O **GDD (Minigame 1) foi atualizado para casar**, então o aceite ("condição idêntica entre jogo e documento") **continua cumprido**. O ranking de vitórias do Jogo 1 não muda (o Score Service conta `won`, não o placar).

### 5.4 🟡 Remover manifestos k8s (9.4)

- **Situação:** existe `k8s/` (deployment-auth/gateway/frontend, postgres-statefulset). Como Kubernetes saiu do escopo (decisão v2), esses arquivos viram código morto de infraestrutura — e ainda contêm o bug de `targetPort: 8080` × app na 5000 ([k8s/deployment-auth.yaml](../../k8s/deployment-auth.yaml) × [Program.cs:75](../../auth-service/Program.cs)), que deixa de importar.
- **Entregar:** **remover a pasta `k8s/`** e qualquer referência a ela na documentação.
- **Aceite:** o repositório não contém mais manifestos de orquestração; a distribuição é descrita só via EC2 (item 3).
- **✔ Concluído (v2):** a pasta `k8s/` não existe mais no repositório — nenhum manifesto YAML de orquestração presente (verificado em 2026-06-19).

### 5.5 🟡 Código morto: inimigo `formacao` (9.5)

- **Situação:** o tipo `formacao` era tratado/desenhado no gateway monolítico (antes do item 1) mas **nunca era gerado** — `j3_spawnEnemies` só cria `batalha`, `tanque` e `mae`. Os nomes internos divergiam do GDD (Caçador/Destruidor/Leviatã).
- **Entregar:** remover o tipo ou passar a gerá-lo; padronizar nomenclatura com o GDD.
- **Aceite:** sem ramos de código inalcançáveis para tipos de inimigo.
- **✔ Concluído (v2):** removido o tipo morto `formacao` em [game-engine/games/jogo3.js](../../game-engine/games/jogo3.js) (`j3_updateGameLogic`/`j3_spawnEnemies`) e em [frontend/index.html](../../frontend/index.html) (`j3_gameLoop`); adicionado comentário mapeando os nomes internos ao GDD (`batalha`=Caçador, `tanque`=Destruidor, `mae`=Leviatã) em [game-engine/games/jogo3.js:6](../../game-engine/games/jogo3.js).

### 5.6 🟠 Segredos/credenciais por variável de ambiente (9.6)

- **Situação:** o **mesmo** `JWT_SECRET` padrão está chumbado em [auth-service/Program.cs:22](../../auth-service/Program.cs), [auth-service/Controllers/AuthController.cs:80](../../auth-service/Controllers/AuthController.cs), [game-gateway/index.js:13](../../game-gateway/index.js) e [auth-service-lite/server.js:12](../../auth-service-lite/server.js); a senha do PostgreSQL é literal no compose. *(Isto não é sobre criptografar o tráfego — que está fora de escopo — e sim sobre não publicar segredos no código ao subir na AWS.)*
- **Entregar:** segredo de JWT e credenciais por **variável de ambiente** em cada EC2 (item 3.3).
- **Aceite:** subir em produção sem a variável definida **falha de forma explícita** (não cai no segredo default).
- **✔ Concluído (v2):** removido o segredo default de [Program.cs:22](../../auth-service/Program.cs), [AuthController.cs:80](../../auth-service/Controllers/AuthController.cs), [game-gateway/index.js:23](../../game-gateway/index.js), [auth-service-lite/server.js:13](../../auth-service-lite/server.js) e no novo [game-engine/server.js:23](../../game-engine/server.js) — cada serviço **aborta** sem o segredo. O [docker-compose.yml](../../docker-compose.yml) injeta `JWT_SECRET` (Auth via `JwtSettings__Secret`, Gateway via `JWT_SECRET`) e `POSTGRES_PASSWORD` a partir do `.env` usando `${VAR:?}` (falha se ausente); a senha do Postgres saiu do compose.

### 5.7 🟡 Guia de deploy e links da doc (9.7)

- **Situação:** o `QA_Status_v1.md` referenciava `DEPLOYMENT_GUIDE.md` (removido) e caminhos antigos; a doc foi reorganizada (`Docs/v1`, `Docs/v2`).
- **Entregar:** **novo guia de deploy AWS** (passo a passo do item 3) e correção dos links relativos.
- **Aceite:** todos os links da pasta `Docs/` resolvem.
- **✔ Concluído (v2):** [Guia de Deploy AWS](../../README.md) (topologia 1-serviço-por-EC2, Security Groups, ordem de subida e bateria de testes) + [deploy/aws/README.md](../../deploy/aws/README.md). Os docs de `Docs/v1/*` ganharam aviso de **histórico/superado** — isso resolve a referência morta a `DEPLOYMENT_GUIDE.md` e aos manifestos `k8s/`. O [README.md](../../README.md) aponta para o guia e marca o Docker como **só desenvolvimento local**.

---

## 6. Escalabilidade de dados e testes em nuvem

### 6.1 🟠 Replicação do PostgreSQL (Primary-Replica) (item 10)

- **Situação:** instância única.
- **Entregar:** topologia Primary-Replica (escritas no primário, leituras de leaderboard nas réplicas) — uma EC2 primária e uma réplica (item 3).
- **Aceite:** leituras do ranking servidas por réplica sem onerar o primário.
- **🟡 Preparado (v2):** [deploy/aws/lib/postgres.sh](../../deploy/aws/lib/postgres.sh) sobe o **primário** (`wal_level=replica`, `max_wal_senders`, papel de replicação + `pg_hba` da VPC; chamado pelo `deploy1.sh`) e a **réplica** (`pg_basebackup -R` → standby somente-leitura; chamado pelo `deploy2.sh`). **Falta** executar/validar na AWS — [Guia §5.6](../../README.md) (`pg_is_in_recovery()`; escrita no primário → leitura na réplica).

### 6.2 🟡 Particionamento de dados (item 11)

- **Situação:** só há particionamento **funcional** lógico dos 3 jogos.
- **Entregar:** particionar as tabelas de pontuação (ex.: por minigame).
- **Aceite:** consultas de ranking por minigame atingem só a partição relevante.
- **🟡 Implementado (v2):** a tabela `scores` ([score-service/store.py](../../score-service/store.py) `init_schema`) virou **particionada por LISTA** da coluna `game` — partições físicas `scores_jogo1|jogo2|jogo3` + uma **DEFAULT** (`scores_outros`) para minigames futuros; a `PRIMARY KEY` inclui `game` (exigência do Postgres). A escrita vai na tabela-pai e o Postgres roteia para a partição certa; `partition_for(game)` espelha o roteamento (observabilidade/teste). **Validado offline** ([selftest_partition.py](../../score-service/selftest_partition.py)): roteamento jogoN→partição, DEFAULT para desconhecido e a distribuição do fixture (`test-data/`) por partição. **Pendente:** E2E com PG real (partition pruning via `EXPLAIN`) — fase Docker/AWS (itens 3/12).

### 6.3 🟠 Bateria de testes na AWS EC2 (item 12)

- **Situação:** depende do deploy (item 3); ainda não executada.
- **Entregar:** após o deploy distribuído, nova bateria de testes de rede, latência (WebRTC), replicação, retenção do Kafka e estresse.
- **Aceite:** relatório de testes em produção (incluindo derrubar uma EC2 de engine e uma réplica de banco).
- **🟡 Parcial (v2):** entregues e validados **localmente** dois componentes do item 12: (a) **clientes simulados (req. 4.2)** em [load-test/](../../load-test/) — bots autenticam no Auth, conectam no gateway e jogam os 3 minigames em paralelo (8 bots → **6 partidas concorrentes, 0 erros**; **isolamento de falha** demonstrado: derrubar o engine do Jogo 1 não afeta Jogo 2/3, que seguem concluindo, e o Jogo 1 degrada sem crash); (b) **dados de teste versionados (req. 4.8)** em [test-data/](../../test-data/) (usuários seed + fixture `match-completed` + ranking esperado, com [selftest_dataset.py](../../score-service/selftest_dataset.py)). **Pendente:** a bateria **na AWS** (depende do item 3) — E2E Kafka/Score (retenção), latência WebRTC, replicação — mais o cenário de demo roteirizado (4.3) e o vídeo (4.9).

---

## 7. Ordem de execução sugerida para a v2

1. **Correções rápidas (◐):** itens 9.1, 9.3, 9.4 (remover k8s), 9.5, 9.6, 9.7 — baixo esforço, limpam o terreno.
2. **Eixo distribuído (●):** item 1 (isolar Game Engines) → item 2 (WebRTC nos engines) → itens 4 e 5 (Kafka + Score Service) → item 6 (Redis) → item 7 (Leaderboard).
3. **Validação síncrona (◑):** item 8 (gRPC).
4. **Distribuição AWS (●):** item 3 (1 EC2 por serviço + Load Balancer + matchmaking que balanceia engines) → item 10 (replicação) → item 11 (particionamento).
5. **Validação final (◑):** item 12 (bateria de testes na AWS).

---

## 8. Definição de "Pronto para v2"

### 8.1 Técnico (arquitetura e código)

- [ ] Os 3 jogos rodam em **engines isolados** ✅ (item 1 — 3 processos independentes, isolamento validado), cada um em sua **EC2** 🟡 (item 3 — `deploy4.sh`/`deploy5.sh`/`deploy6.sh`, um engine por EC2, + Guia prontos; falta executar).
- [ ] O canal de jogo usa **WebRTC** 🟡 (item 2 — hot path no DataChannel com fallback Socket.io implementado; falta validar no navegador + medir latência); WS/REST para lobby/sinalização/login ✅.
- [ ] **Cada serviço em uma EC2 distinta** 🟡 (item 3 — scripts nativos + Guia prontos; **sem ALB**: o **matchmaking** do gateway distribui as partidas entre engines). Falta o usuário subir as EC2.
- [x] Fim de partida flui por **Kafka → Score Service → Redis/PostgreSQL** ✅ (itens 4, 5, 6 — **validado E2E na stack Docker**: partidas publicam, Score consome e materializa Redis+PG; produtor resiliente, tolerância a falha por commit-após-persistir).
- [x] Existe **leaderboard global por minigame** ponta a ponta ✅ (item 7 — backend `GET /api/scores` + tela "Ranking Global" (top 5) + recorde pessoal no Command Center; **confirmado visualmente pelo usuário**).
- [x] Validação de sessão via **gRPC** ao Auth ✅ (item 8 — implementado/validado: build C# + cliente em 5 cenários; E2E ao vivo no [Guia §5.4](../../README.md)).
- [x] Validações de usuário/senha **server-side** no auth canônico; segredos por variável de ambiente; **auth canônico decidido** (itens 9.1 ✅, 9.2 ✅, 9.6 ✅). *(C# oficial — compila aqui; lite alinhado a bcrypt/`{token}`/2h)*
- [x] Sem manifestos k8s, sem código morto, sem divergência código×GDD, links da doc válidos (itens 9.3 ✅, 9.4 ✅, 9.5 ✅, **9.7 ✅** — Guia de Deploy AWS + v1 marcada como histórica + README atualizado).
- [ ] PostgreSQL com **replicação** (item 10 🟡 — setup pronto: primário no `deploy1.sh`, réplica no `deploy2.sh`; falta executar na AWS) e **particionamento** (item 11 🟡 — `scores` particionada por minigame, validada offline; E2E roteirizado no Guia §5.5).

### 8.2 Conformidade com a especificação do trabalho

> Espelha o [Checklist de Requisitos da Especificação](../../README.md). Os itens técnicos acima já cobrem as características obrigatórias (1.x), os paradigmas async/pub-sub (2.3, 2.4) e a 3ª linguagem (Python no Score). Faltam, além deles, os **entregáveis de demonstração**:

- [ ] **Serviço acessível na Internet** via deploy público na AWS (req. 1.1 → item 3).
- [x] **Interação síncrona (gRPC)** + **assíncrona/messaging (Kafka)** demonstráveis (reqs. 1.5, 2.3, 2.4 → itens 8, 4, 5) — messaging/pub-sub via Kafka **validado E2E** (itens 4, 5 ✅) e **gRPC implementado/validado** (item 8 ✅; E2E ao vivo no Guia §5.4).
- [ ] **Replicação e particionamento** de dados exercitados na demo (reqs. 1.6, 1.7 → itens 10, 11).
- [x] **Clientes simulados** (bots/script de carga) para exercitar concorrência sistematicamente (req. 4.2 → [load-test/](../../load-test/); validado localmente).
- [ ] **Cenário de demonstração** roteirizado, cobrindo concorrência, sync/async, replicação, particionamento e tolerância a falhas (req. 4.3). *(parcial: [load-test/](../../load-test/) já roteiriza concorrência + tolerância a falha/isolamento; falta sync gRPC e replicação na AWS)*
- [ ] **Demonstração executada na AWS EC2** (req. 4.4 → itens 3, 12).
- [ ] **Documentação de arquitetura e implementação** atualizada para a versão final (req. 4.6).
- [ ] **README** atualizado para o deploy distribuído (req. 4.7 → item 9.7).
- [x] **Dados de teste** versionados (req. 4.8 → [test-data/](../../test-data/): usuários seed + fixture de ranking + oráculo, com selftest).
- [ ] **Vídeo de demonstração** com participação de todos os integrantes (req. 4.9).

> Fora de escopo nesta versão (por decisão): criptografia do tráfego entre serviços (TLS/HTTPS/WSS) e orquestração via Kubernetes.
>
> **Prazo de entrega: 28/06/2026** (código via GitHub Classroom; documentação e vídeo via Plataforma Turing).
