# Spaceship — Plataforma de Jogos Multiplayer 🚀

Plataforma web de **3 minijogos de naves multiplayer em tempo real**, construída
como demonstração prática de **Software Concorrente e Distribuído (SCD)**:
arquitetura de microsserviços orientada a eventos, com servidor autoritativo,
mais de uma linguagem e os três paradigmas de interação (cliente-servidor,
publish-subscribe e messaging).

> **Trabalho Final — SCD 2026.1 (UFG/INF).** Cenário escolhido: **Exemplo 3 —
> Jogo online multijogador**. A especificação oficial está em
> [`Docs/Requisitos do trabalho/SCD-2026-1-EspecificaçãoTrabalhoFinal.pdf`](Docs/Requisitos%20do%20trabalho/SCD-2026-1-Especifica%C3%A7%C3%A3oTrabalhoFinal.pdf).

---

## Sumário

1. [Visão geral e os 3 jogos](#1-visão-geral-e-os-3-jogos)
2. [Arquitetura: serviços e quem fala com quem](#2-arquitetura-serviços-e-quem-fala-com-quem)
3. [Estrutura do projeto](#3-estrutura-do-projeto)
4. [Configuração de ambiente (nada chumbado)](#4-configuração-de-ambiente-nada-chumbado)
5. [Testar localmente (Docker)](#5-testar-localmente-docker)
6. [Testar na AWS (deploy distribuído, 6 EC2, sem Docker)](#6-testar-na-aws-deploy-distribuído-6-ec2-sem-docker)
7. [Justificativa do projeto frente aos requisitos](#7-justificativa-do-projeto-frente-aos-requisitos)
8. [Checklist da especificação](#8-checklist-da-especificação)
9. [Equipe](#9-equipe)

---

## 1. Visão geral e os 3 jogos

O jogador entra no navegador, faz **login/registro**, escolhe um dos **3
minijogos** e joga em **salas (lobby)** com outros jogadores. Toda a física,
colisão e pontuação são processadas no **servidor autoritativo** — o cliente só
envia inputs de teclado (← → / A D e **Espaço** para atirar) e renderiza o estado
recebido a ~60 Hz. Cada jogador tem **1 HP** (um acerto é fatal) e cada minijogo
tem um **ranking global** próprio.

| Minijogo | Modo | Jogadores | Inimigos | Objetivo |
|---|---|---|---|---|
| **Jogo 1 — Duelo** | PvP competitivo | exatamente **2** | nenhum (PvP) | Abrir **2 pontos de vantagem** no placar (placar acumulativo). |
| **Jogo 2 — Chuva de Asteroides** | Survival cooperativo | **1 a 4** | asteroides (geração procedural, dificuldade crescente) | Sobreviver e destruir asteroides (**1 pt** cada). |
| **Jogo 3 — Invasão Alienígena** | Cooperativo + boss | **1 a 4** | Caçador (10 pts), Destruidor (50 pts), boss Leviatã (500 pts) | Sobreviver às ondas e **derrotar o boss**. |

Detalhe completo de regras, inimigos e telas no
[Game Design Document](Docs/GameDesignDocument.md).

---

## 2. Arquitetura: serviços e quem fala com quem

Arquitetura de **microsserviços orientada a eventos (EDA)** com **servidor
autoritativo**. Cada serviço é especialista, em sua própria linguagem, e se
comunica por **múltiplos protocolos**.

| Serviço | Linguagem / Tecnologia | Responsabilidade | Concorrência |
|---|---|---|---|
| **Frontend** | HTML5 Canvas + JS | Login, menu, render da partida, captura de inputs | Event-driven no navegador |
| **Auth Service** | C# / ASP.NET Core + EF Core + PostgreSQL | Contas, BCrypt, JWT; **gRPC** de validação de sessão | Multi-threading (Kestrel) |
| **Game Gateway** (relay) | Node.js + Socket.io | Ponto de entrada do cliente: autentica, lobby/matchmaking e **roteia** (relay) inputs↔estado entre cliente e o engine do jogo | Event loop não-bloqueante |
| **Game Engines ×3** | Node.js (1 processo por jogo) | Loop de física a 60 Hz, colisões, pontuação — **isolados** (`GAME=jogo1\|2\|3`) | `setInterval` por sala |
| **Score Service** | **Python** / Flask | Consome `match-completed` do Kafka, materializa ranking no Redis e histórico no PostgreSQL; expõe `GET /api/scores` | Thread de consumo + REST |
| **Message Broker** | Apache Kafka | Barramento de eventos de fim de partida (desacoplado, persistente) | — |
| **Dados** | PostgreSQL (primário+réplica) · Redis | Persistência (usuários, `scores` particionada) · cache do ranking | — |

### Quem conversa com quem (paradigmas de comunicação)

```
Navegador ──REST/HTTP──────────────▶ Auth Service        (login, registro)
Navegador ──REST/HTTP──────────────▶ Score Service       (ler o ranking global)
Navegador ──WebSocket (Socket.io)──▶ Game Gateway        (lobby + jogo em tempo real)
                                          │
                       gRPC SÍNCRONO ◀────┤  valida a sessão (JWT) no Auth na conexão
                                          │
                      Socket.io (relay) ──┼──▶ Game Engine jogo1
                                          ├──▶ Game Engine jogo2
                                          └──▶ Game Engine jogo3
Game Engine ──publica 'match-completed'──▶ Kafka ──consome──▶ Score Service
                                                                  │
                                                  Redis (ranking) ◀┴─▶ PostgreSQL (histórico)
```

- **Cliente-Servidor:** REST (HTTP) para ações de ciclo curto (login, ranking) e
  **WebSocket (Socket.io)** para o lobby e o **jogo em tempo real**. O cliente fala
  **só com o gateway**; o gateway abre uma conexão-relay a cada engine e repassa
  inputs (cliente→engine) e estado por tick (engine→cliente).
- **RPC síncrono (gRPC):** na conexão ao gateway, ele valida o JWT chamando o Auth
  por **gRPC bloqueante** (confere assinatura **e** existência do usuário —
  revogação). Sem o Auth, cai para validação local (não trava). Ver
  [`game-gateway/authClient.js`](game-gateway/authClient.js).
- **Publish-Subscribe / Messaging (Kafka):** ao fim de cada partida o engine
  **publica** `match-completed`; o Score **consome** no seu ritmo. O engine não
  conhece o Score (desacoplamento). Se o Score cair, o Kafka **retém** os eventos
  (**consistência eventual**).
- **Particionamento funcional:** os 3 engines são processos independentes — derrubar
  um jogo **não afeta** os outros.

> O diagrama completo (Mermaid) e a descrição detalhada estão em
> [`Docs/Arquitetura/`](Docs/Arquitetura/).

---

## 3. Estrutura do projeto

- **`/frontend`** — cliente web (HTML/CSS/JS, Canvas). Config de host/portas em
  [`frontend/config.js`](frontend/config.js) (nada chumbado no `index.html`).
- **`/auth-service`** — Auth canônico em **C# / ASP.NET Core** (BCrypt + PostgreSQL,
  REST `/api/auth` + gRPC de validação).
- **`/auth-service-lite`** — espelho do Auth em **Node.js** (`users.json`) para rodar
  **sem Docker** em DEV, alinhado ao canônico (bcrypt, mesmo contrato/claims).
- **`/game-gateway`** — Gateway/Lobby em **Node.js**: autentica, faz matchmaking e
  **roteia** (relay). **Não roda física.**
- **`/game-engine`** — Game Engine em **Node.js**: roda a física de **um** jogo. A
  mesma imagem serve os 3, escolhendo pela variável `GAME` (`jogo1`/`jogo2`/`jogo3`).
  São **3 processos independentes** (particionamento funcional).
- **`/score-service`** — Serviço de pontuação em **Python/Flask** (3ª linguagem):
  consome `match-completed` do **Kafka**, materializa o ranking por minijogo no
  **Redis** e grava o histórico no **PostgreSQL** (tabela `scores` **particionada
  por minijogo**). Expõe `GET /api/scores`.
- **`/load-test`** — **clientes simulados** (bots) que exercitam concorrência jogando
  os 3 minijogos em paralelo (req. 4.2). Ver [load-test/README.md](load-test/README.md).
- **`/test-data`** — **dados de teste** versionados (usuários seed + fixture de
  ranking, req. 4.8). Ver [test-data/README.md](test-data/README.md).
- **`/deploy/aws`** — scripts de **deploy nativo na AWS** (systemd, sem Docker).
- **`docker-compose.yml`** — stack completa de **desenvolvimento local**.

---

## 4. Configuração de ambiente (nada chumbado)

Nenhum IP ou segredo fica chumbado no código. Há **três** pontos de configuração,
cada um para um cenário:

| Arquivo | Quem lê | Para quê |
|---|---|---|
| **`.env`** (copie de [`.env.example`](.env.example)) | `docker-compose.yml` (back-end local) | Segredos e portas da stack Docker. |
| **`deploy/aws/env.aws`** (copie de [`env.aws.example`](deploy/aws/env.aws.example)) | os scripts `deploy/aws/*.sh` | Segredos + IPs privados/públicos das 6 EC2. |
| **`frontend/config.js`** | o navegador | Host/portas dos serviços que o cliente acessa (Auth, Gateway, Score). Na AWS é **gerado** pelo `deploy3`. |

**Preparo local (`.env`):**
```bash
cp .env.example .env
# defina POSTGRES_PASSWORD e JWT_SECRET (sem eles o `docker compose up` aborta de propósito)
```

**Preparo AWS (`env.aws`):** copie `deploy/aws/env.aws.example` para
`deploy/aws/env.aws` e preencha segredos + IPs/DNS das 6 máquinas. O cabeçalho do
arquivo traz o **mapa de qual variável é de qual EC2**. Detalhes na
[seção 6](#6-testar-na-aws-deploy-distribuído-6-ec2-sem-docker).

> **Regra de ouro dos endereços (AWS):** `*_PRIVATE` = IP privado da VPC
> (comunicação **entre serviços**); `*_PUBLIC` = DNS público da EC2 (o que o
> **navegador** acessa).

---

## 5. Testar localmente (Docker)

Stack completa em contêineres: **Postgres, Redis, Zookeeper, Kafka, Auth (C#),
Gateway, 3 Game Engines, Score Service e Frontend**. É a forma de validar o
leaderboard, o Kafka, o Redis, o gRPC e o particionamento em PostgreSQL real.

> ⚠️ Rode **todos os comandos na raiz do projeto**. O Docker aqui é **só para
> desenvolvimento/teste local** — o deploy na nuvem é nativo (seção 6).

### 5.1 Subir tudo
```bash
cp .env.example .env          # (1ª vez) defina POSTGRES_PASSWORD e JWT_SECRET
sudo docker compose up -d --build
```
A 1ª vez demora (build das imagens). Ao terminar, abra **http://localhost:8080**.

> "**port already allocated**"? É a stack lite (seção 5.5) ocupando as portas:
> `./dev-stack.sh stop` e suba de novo.

### 5.2 Verificar que subiu
```bash
sudo docker compose ps
curl -s -o /dev/null -w "frontend :8080 -> %{http_code}\n" http://localhost:8080
curl -s -o /dev/null -w "auth     :5000 -> %{http_code}\n" http://localhost:5000/api/auth/wins/healthcheck
curl -s -o /dev/null -w "score    :8000 -> %{http_code}\n" http://localhost:8000/health
```
Logs em tempo real (Ctrl+C sai dos logs, **não** derruba a stack):
```bash
sudo docker compose logs -f score-service kafka
```

### 5.3 (Opcional) Popular o ranking com bots
```bash
cd load-test && npm install && node run.js --bots=8 --game=mix; cd ..
curl -s "http://localhost:8000/api/scores?limit=5" | python3 -m json.tool
```

### 5.4 Verificar os mecanismos distribuídos (E2E)

**gRPC síncrono (validação de sessão):** na conexão, o gateway valida a sessão
chamando o Auth por gRPC.
```bash
sudo docker compose logs game-gateway | grep -i grpc
# esperado: "validação de sessão via gRPC em auth-service:5005"
```
Teste a **revogação** (o que a validação local não pegaria): registre/jogue com um
usuário, remova-o no banco e tente reconectar — o gateway recusa.
```bash
sudo docker exec -it spaceship_postgres psql -U postgres -d authdb -c "DELETE FROM \"Users\" WHERE \"Username\"='SEU_USER';"
```

**Pipeline assíncrono `fim de partida → Kafka → Score → Redis`:**
```bash
sudo docker compose logs game-engine-2 | grep -i kafka   # "[kafka] produtor conectado em kafka:29092"
sudo docker exec spaceship_redis redis-cli ZREVRANGE leaderboard:jogo2 0 -1 WITHSCORES
sudo docker compose logs --tail=30 score-service
```

**Particionamento de dados por minijogo (tabela `scores`):**
```bash
sudo docker exec -it spaceship_postgres psql -U postgres -d authdb -c "\d+ scores"
sudo docker exec -it spaceship_postgres psql -U postgres -d authdb -c "EXPLAIN (COSTS OFF) SELECT * FROM scores WHERE game='jogo2';"
```
Esperado: o `EXPLAIN` cita só `scores_jogo2` (*partition pruning*).

### 5.5 Derrubar tudo
```bash
sudo docker compose down        # mantém os dados do banco (volume)
# sudo docker compose down -v   # também APAGA os dados (zera Postgres e ranking)
```

### 5.6 Alternativa sem Docker (stack lite)
Para testar só os **clientes simulados** e o **auth**, sem Kafka/Redis/PG (o
"Ranking Global" fica indisponível, degradando sem quebrar). Usa o
`auth-service-lite`. Ver [load-test/README.md](load-test/README.md).
```bash
./dev-stack.sh deps     # (1ª vez) instala node_modules dos serviços
./dev-stack.sh start    # sobe auth(5000) + engines(4001/2/3) + gateway(3000)
python3 -m http.server 8080 --directory frontend   # para jogar no navegador
./dev-stack.sh stop     # derruba e libera as portas
```

### Portas da stack local

| Serviço | Porta | Observação |
|---|---|---|
| Frontend (nginx) | 8080 | abrir no navegador |
| Auth (C#) | 5000 / 5005 | REST `/api/auth` · gRPC (validação) |
| Gateway (relay) | 3000 | Socket.io (cliente↔gateway) |
| Game Engines 1/2/3 | 4001/4002/4003 | Socket.io interno (relay do gateway) |
| Score Service | 8000 | `GET /api/scores` |
| PostgreSQL | 5432 | tabela `scores` particionada |
| Redis | 6379 | ranking (sorted sets) |
| Kafka / Zookeeper | 9092 / 2181 | tópico `match-completed` |

---

## 6. Testar na AWS (deploy distribuído, 6 EC2, sem Docker)

Deploy distribuído **condensado em 6 máquinas EC2**, cada serviço **nativo**
(systemd). Você roda **um script por máquina** — `deploy1.sh` … `deploy6.sh` em
[`deploy/aws/`](deploy/aws/) — que chama as peças por serviço de
[`deploy/aws/lib/`](deploy/aws/lib/) e usa a config de `env.aws`.

> **Para quem é este guia:** você já sabe abrir EC2, ver IP, conectar por SSH e
> criar Security Groups. O foco aqui é **o que instalar, qual script rodar, com
> qual config, em que ordem e como testar**.

### 6.0 Decisões que valem para todo o deploy

- **Sem Docker na AWS.** Cada serviço roda nativo (systemd: sobe no boot, reinicia se cair).
- **6 máquinas (não 10–11).** O ideal de "1 serviço por EC2" daria ~10 máquinas, mas
  a conta AWS **só permite 9 instâncias**. Condensamos para 6 agrupando serviços que
  **não brigam por porta**, **sem abrir mão** das duas demonstrações que mais importam:
  - **Replicação Primary-Replica (PostgreSQL):** primário e réplica em **máquinas
    diferentes** (`deploy1` × `deploy2`).
  - **Particionamento funcional:** os **3 engines isolados**, um por máquina (`deploy4/5/6`).
- **O navegador fala só com a `spaceship-app`.** Os **engines ficam privados** — quem
  conecta neles é o **gateway**, pela rede interna da VPC. Não há porta pública de
  engine (nem ALB): o balanceamento das partidas é o **matchmaking do gateway**, que
  roteia cada jogo para o seu engine.
- **AMI:** Ubuntu Server 22.04/24.04 LTS (`apt` + `systemd`).
- **Tipos:** `t3.medium` para as 3 máquinas mais carregadas (data1, data2, app) e
  `t3.small` para cada engine.

### 6.1 Topologia — as 6 máquinas

Crie **6 EC2** (Ubuntu). Dê a cada uma a **tag `Name`** abaixo — bate com o
`deployN.sh` que ela roda e com os serviços systemd (`spaceship-<algo>`).

| # | Nome (tag **Name**) | Script | Serviços | Portas | Tipo |
|---|---|---|---|---|---|
| 1 | `spaceship-data1` | `deploy1.sh` | PostgreSQL **primário** + Redis | TCP 5432 · 6379 *(interno)* | t3.medium |
| 2 | `spaceship-data2` | `deploy2.sh` | Kafka + PostgreSQL **réplica** | TCP 9092 (+9093) · 5432 *(interno)* | t3.medium |
| 3 | `spaceship-app` | `deploy3.sh` | Auth + Gateway + Score + Frontend | TCP **80, 3000, 5000, 8000** (públicas) + 5005 *(interno)* | t3.medium |
| 4 | `spaceship-engine1` | `deploy4.sh` | Game Engine `jogo1` | TCP 4001 *(interno)* | t3.small |
| 5 | `spaceship-engine2` | `deploy5.sh` | Game Engine `jogo2` | TCP 4002 *(interno)* | t3.small |
| 6 | `spaceship-engine3` | `deploy6.sh` | Game Engine `jogo3` | TCP 4003 *(interno)* | t3.small |

> **Dois tipos de acesso:** "**interno**" = só as outras máquinas alcançam, pelo **IP
> privado** da VPC (não fica aberto para a internet). "**pública**" = precisa de porta
> aberta no Security Group. Só a `spaceship-app` tem portas públicas.

### 6.2 Pré-deploy

1. **Par de chaves SSH** criado.
2. **VPC padrão** para as 6 EC2 (mesma VPC/região, para se enxergarem pelo IP
   privado). Anote o **CIDR** da sub-rede (na VPC padrão, `172.31.0.0/16`) → vai no
   `VPC_CIDR` do `env.aws`.
3. **Segredos** (iguais em todas as máquinas): `JWT_SECRET` (`openssl rand -base64 48`),
   `POSTGRES_PASSWORD`, `PG_REPL_PASSWORD` (papel de replicação).
4. **Um `env.aws` para todas:** preencha **um** completo no seu PC (IPs/DNS das 6 EC2)
   e copie igual para cada máquina (`scp`). Como Auth, Gateway e Score moram na
   `spaceship-app`, os três `*_PUBLIC` recebem o **mesmo DNS público** — o da `spaceship-app`.

### 6.3 Security Groups (firewall)

> **O conceito que destrava tudo:** toda porta **nasce FECHADA** para a internet. Ela
> só abre quando você cria uma **regra de entrada (inbound)**. Você **não "fecha"
> porta** — só **abre as poucas** que o navegador precisa; o resto fica fechado sozinho.

Use **um único Security Group** (`spaceship-sg`) para as 6 instâncias. No total,
**6 regras de entrada**: **1 interna** + **5 públicas**.

1. EC2 → **Security Groups** → **Create security group** → nome `spaceship-sg`, VPC
   padrão → **Create**.
2. Coloque as 6 instâncias nele: selecione cada uma → **Actions → Security → Change
   security groups** → adicione `spaceship-sg` → **Save**.
3. Em `spaceship-sg` → **Inbound rules** → **Edit inbound rules** e adicione:

| Regra | Type (menu) | Protocolo | Port range | Source | Para quê |
|---|---|---|---|---|---|
| 1 | **All traffic** | All | All | **Custom → o próprio `spaceship-sg`** | malha interna (banco, Redis, Kafka, gRPC, relay engines) |
| 2 | **SSH** | TCP | `22` | `0.0.0.0/0` | administrar via SSH |
| 3 | **HTTP** | TCP | `80` | `0.0.0.0/0` | abrir o site (`spaceship-app`) |
| 4 | **Custom TCP** | TCP | `3000` | `0.0.0.0/0` | jogo em tempo real (gateway / Socket.io) |
| 5 | **Custom TCP** | TCP | `5000` | `0.0.0.0/0` | login e cadastro (Auth REST) |
| 6 | **Custom TCP** | TCP | `8000` | `0.0.0.0/0` | ler o ranking global (Score) |

A **Regra 1** (origem = o próprio SG, **não** `0.0.0.0/0`) é o que faz banco, Redis,
Kafka, o gRPC do Auth e o **relay gateway↔engines** funcionarem **sem expor nada à
internet**.

**As portas que você NÃO abre** (continuam só na malha interna, Regra 1): PostgreSQL
`5432`, Redis `6379`, Kafka `9092/9093`, Auth gRPC `5005` e os engines `4001-4003`.
Como você nunca cria regra pública para elas, ficam invisíveis para a internet e
vivas dentro da VPC.

### 6.4 Subida (ordem importa)

> **⚡ Atalho (recomendado): deploy das 6 a partir de UMA máquina.** Em vez de repetir
> os passos abaixo em cada EC2, suba uma **7ª EC2 orquestradora** e rode **um comando**:
> ela conecta nas 6, gera o `env.aws`, manda o código e roda os `deployN.sh` na ordem
> certa. Passo a passo em **[`deploy/aws/README.md`](deploy/aws/README.md)** (seção
> *"Jeito RÁPIDO: `deploy-all.sh`"*). O procedimento manual abaixo continua valendo
> (é o que o `deploy-all.sh` automatiza por baixo).

Em **cada** EC2, uma vez:
```bash
sudo apt-get update -y && sudo apt-get install -y git
git clone <URL_DO_REPO> && cd Trabalho-Scd-Grupo-6
cp deploy/aws/env.aws.example deploy/aws/env.aws
nano deploy/aws/env.aws        # segredos + IPs privados/públicos das 6 EC2
```
Depois rode, **em cada máquina, o `deployN.sh` dela**, nesta ordem (primeiro o estado
compartilhado; a réplica depende do primário; o app antes dos engines):
```bash
sudo bash deploy/aws/deploy1.sh   # spaceship-data1 — Postgres primário + Redis  [PRIMEIRO]
sudo bash deploy/aws/deploy2.sh   # spaceship-data2 — Kafka + Postgres réplica
sudo bash deploy/aws/deploy3.sh   # spaceship-app   — Auth + Gateway + Score + Frontend
sudo bash deploy/aws/deploy4.sh   # spaceship-engine1 (jogo1)
sudo bash deploy/aws/deploy5.sh   # spaceship-engine2 (jogo2)
sudo bash deploy/aws/deploy6.sh   # spaceship-engine3 (jogo3)
```
Estado/logs: `sudo systemctl status spaceship-<svc>` ·
`sudo journalctl -u spaceship-<svc> -f` (Postgres/Redis usam `postgresql` e `redis-server`).

### 6.5 Bateria de testes na AWS

Abra `http://<DNS_PÚBLICO_DA_spaceship-app>`, registre, faça login e jogue os 3
minijogos. `<APP_PUB>` abaixo é esse DNS público.

```bash
# Smoke test
curl -s -o /dev/null -w "frontend %{http_code}\n" http://<APP_PUB>
curl -s -o /dev/null -w "auth     %{http_code}\n" http://<APP_PUB>:5000/api/auth/wins/x   # 404 = no ar
curl -s -o /dev/null -w "gateway  %{http_code}\n" http://<APP_PUB>:3000/socket.io/         # 400 = no ar
curl -s "http://<APP_PUB>:8000/health"

# Concorrência / clientes simulados (req. 4.2)
cd load-test && npm install
node run.js --bots=8 --game=mix --gateway=http://<APP_PUB>:3000 --auth=http://<APP_PUB>:5000/api/auth
curl -s "http://<APP_PUB>:8000/api/scores?limit=5" | python3 -m json.tool
```

- **gRPC (revogação):** na `spaceship-app`, `journalctl -u spaceship-gateway | grep -i grpc`;
  remova um usuário no Postgres **primário** (`spaceship-data1`) e tente reconectar — recusa.
- **Particionamento (item dados):** na `spaceship-data1`,
  `sudo -u postgres psql -d authdb -c "EXPLAIN (COSTS OFF) SELECT * FROM scores WHERE game='jogo2';"`
  → cita só `scores_jogo2`.
- **Replicação:** na `spaceship-data2` (réplica),
  `sudo -u postgres psql -tc "SELECT pg_is_in_recovery();"` → `t`; escreva no primário
  (jogue/rode os bots) e leia a `scores` na réplica — as linhas aparecem propagadas.
- **Tolerância a falha / isolamento:** na `spaceship-engine1`,
  `sudo systemctl stop spaceship-engine-jogo1` — Jogos 2 e 3 seguem normais; só o Jogo 1
  fica indisponível. Religue com `start`.

### 6.6 Desligar para não gastar
Pare (sem terminar) as 6 instâncias quando não estiver testando — os serviços systemd
sobem sozinhos ao religar a EC2. Religue a `spaceship-data1` **antes** da `spaceship-data2`
(a réplica espera o primário).

---

## 7. Justificativa do projeto frente aos requisitos

A arquitetura foi desenhada para cobrir, de forma integrada, cada característica
obrigatória da especificação:

- **Serviço acessível a múltiplos clientes na Internet:** deploy na AWS com **1
  serviço por EC2** (condensado em 6), a `spaceship-app` como porta de entrada pública
  (Frontend, Auth, Gateway, Score) e os engines distribuídos atrás dela. O matchmaking
  do gateway distribui as partidas entre os engines.
- **Integração e coordenação de vários componentes distribuídos (implementados no
  trabalho):** Auth (C#), Gateway-relay (Node), 3 Game Engines (Node), Score (Python),
  Frontend, PostgreSQL, Redis e Kafka — coordenados no fluxo
  `engine → Kafka → Score → Redis/PG → API → tela`, validado E2E.
- **Acessos concorrentes a dados compartilhados:** o estado de cada sala é modificado
  simultaneamente por vários jogadores; o PostgreSQL recebe escritas/leituras
  concorrentes.
- **Processamento no servidor, concorrente com os clientes:** servidor autoritativo
  com loop de física a 60 Hz por sala, processando enquanto os clientes enviam inputs;
  várias partidas concorrentes.
- **Interação remota síncrona e assíncrona:** **gRPC bloqueante** (validação de sessão)
  e **Kafka assíncrono** (resultado de partida), além de REST (síncrono) e WebSocket
  (push assíncrono de estado).
- **Replicação e particionamento:** **particionamento funcional** (3 engines isolados)
  + **particionamento de dados** (`scores` `PARTITION BY LIST` por minijogo) +
  **replicação Primary-Replica** do PostgreSQL (primário e réplica em EC2 separadas).
- **Consistência e disponibilidade:** consistência transacional no Auth (BCrypt +
  EF Core); **consistência eventual** no ranking (o Kafka retém eventos se o Score
  cair; commit de offset só após persistir); réplica de leitura para disponibilidade.
- **Mais de uma linguagem + 3 paradigmas:** **C# + JavaScript + Python**;
  **cliente-servidor** (REST/WebSocket), **publish-subscribe** e **messaging** (Kafka).

A descrição arquitetural completa e o diagrama estão em
[`Docs/Arquitetura/`](Docs/Arquitetura/).

---

## 8. Checklist da especificação

> Legenda: ✅ cumprido · 🟡 implementado/preparado, validar na execução AWS · ⛔ pendente.

### Características obrigatórias
| # | Requisito | Status | Como é cumprido |
|---|---|---|---|
| 1.1 | Acessível a múltiplos clientes na Internet | 🟡 | Deploy AWS pronto (scripts `deploy/aws/` + [seção 6](#6-testar-na-aws-deploy-distribuído-6-ec2-sem-docker)); falta executar/manter no ar. |
| 1.2 | Integração e coordenação de componentes distribuídos | ✅ | 8 componentes reais coordenados; fluxo E2E validado na stack Docker. |
| 1.3 | Acessos concorrentes a dados compartilhados | ✅ | Estado de sala compartilhado + escritas/leituras concorrentes no PG. |
| 1.4 | Processamento no servidor, concorrente com os clientes | ✅ | Servidor autoritativo, loop 60 Hz por sala, várias partidas em paralelo. |
| 1.5 | Interação remota síncrona **e** assíncrona | ✅ | gRPC (síncrono) + Kafka (assíncrono) + REST + WebSocket. |
| 1.6 | Replicação **e** particionamento | 🟡 | Particionamento funcional (engines) ✅ e de dados (`scores`) ✅; replicação PG pronta — validar na AWS. |
| 1.7 | Consistência de dados e disponibilidade | 🟡 | Consistência eventual (Kafka + commit pós-persistência) ✅; réplica de leitura — validar na AWS. |

### Modelos / paradigmas
| # | Requisito | Status |
|---|---|---|
| 2.1 | Mais de uma linguagem | ✅ C# + JavaScript + Python |
| 2.2 | Cliente-Servidor | ✅ REST + WebSocket |
| 2.3 | Publish-Subscribe | ✅ Kafka (engines publicam, Score assina) |
| 2.4 | Messaging (assíncrono) | ✅ Produtor/consumidor `match-completed` |

### Cenário — jogo online multijogador
| # | Requisito | Status |
|---|---|---|
| 3.1 | Vários jogadores veem o estado compartilhado | ✅ `gameUpdate`/estado por tick a todos da sala |
| 3.2 | Jogadores executam ações que mudam o estado | ✅ Inputs aplicados pelo servidor autoritativo |
| 3.3 | Notificações de mudanças de outros jogadores | ✅ Broadcast de estado/eventos da sala |
| 3.4 | Notificações por manutenção das regras do jogo | ✅ Fases do boss, dificuldade progressiva, geração de inimigos |

### Formato e entregáveis
| # | Requisito | Status | Observação |
|---|---|---|---|
| 4.1 | Grupo de 3–4 alunos | ✅ | 4 integrantes ([seção 9](#9-equipe)). |
| 4.2 | Serviços + clientes simulados | ✅ | [`load-test/`](load-test/) — bots jogam os 3 minijogos em paralelo. |
| 4.3 | Cenário de demonstração representativo | 🟡 | Roteiro de concorrência/falha no harness + [bateria AWS §6.5](#65-bateria-de-testes-na-aws); executar na AWS. |
| 4.4 | Demonstração na AWS (EC2) | 🟡 | Deploy preparado; falta o grupo executar. |
| 4.5 | Código-fonte (e executáveis) | ✅ | Repositório + imagens Docker por serviço. |
| 4.6 | Documentação (arquitetura e implementação) | ✅ | Este README + [`Docs/Arquitetura/`](Docs/Arquitetura/) + [GDD](Docs/GameDesignDocument.md). |
| 4.7 | Instruções de uso (README) | ✅ | Este arquivo. |
| 4.8 | Dados de teste | ✅ | [`test-data/`](test-data/) (usuários seed + fixture + ranking esperado). |
| 4.9 | Vídeo de demonstração (todos participam) | ⛔ | A produzir pelo grupo. |

---

## 9. Equipe

- **Game Design:** Moisés Ferreira Protázio Bastos
- **Programadores:** Thiago Nascente Borges · Vinicius Silva Benevides
- **Testes:** Ana Liz Bomfim Gomes
