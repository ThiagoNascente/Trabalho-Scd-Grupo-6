# Guia de Deploy na AWS — Spaceship (v2)

**Item 3 + 9.7 + 12 do [Plano v2](Plano%20de%20correções%20pendentes%20para%20v2.md).** Como subir a stack distribuída na **AWS EC2**, condensada em **6 máquinas** e **sem Docker** (o `docker-compose.yml` é só para teste local). Cada máquina sobe com **um único script** — `deploy1.sh` … `deploy6.sh` em [`deploy/aws/`](../../deploy/aws/) — que, por baixo, chama as peças nativas por serviço (systemd) de [`deploy/aws/lib/`](../../deploy/aws/lib/). A bateria de testes (item 12) reaproveita os bots de [`load-test/`](../../load-test/).

> **Para quem é este guia:** você já sabe abrir EC2, ver o IP, conectar por SSH e
> criar Security Groups. Aqui o foco é **o que instalar, qual script rodar, com
> qual configuração, em que ordem, e como testar** cada característica distribuída.

---

## 0. Decisões que valem para todo o guia

- **Sem Docker na AWS.** Docker foi só para teste local; na nuvem cada serviço roda **nativo** (systemd).
- **6 máquinas, um `deployN.sh` cada.** A especificação descreve o ideal de **1 serviço por EC2** (daria 10–11 máquinas), mas a conta AWS **só permite 9 instâncias simultâneas**. Então **condensamos para 6**, agrupando na mesma máquina serviços que **não brigam por porta** — **sem abrir mão das duas demonstrações que mais importam** em Sistemas Distribuídos:
  - **Replicação Primary-Replica (item 10):** o PostgreSQL **primário** e a **réplica** ficam em **máquinas diferentes** (`deploy1` × `deploy2`).
  - **Particionamento Funcional (item 1):** os **3 engines** ficam **isolados**, um por máquina (`deploy4/5/6`) — derrubar um jogo não derruba os outros.
- **Balanceamento sem ALB.** Quem distribui as **partidas** é o **matchmaking do gateway** (escolhe o engine e devolve o endereço; o cliente conecta direto). O navegador fala direto com o **DNS público** de cada máquina (sem Application Load Balancer).
- **AMI:** **Ubuntu Server 22.04 ou 24.04 LTS** (os scripts usam `apt` + `systemd`). Para Amazon Linux, troque `apt-get`→`dnf` e os nomes dos pacotes.
- **Tipo de instância:** **`t3.medium`** para as três máquinas mais carregadas (`spaceship-data1`, `spaceship-data2`, `spaceship-app` — têm banco/Kafka/.NET) e **`t3.small`** para cada engine.
- **Endereços:** comunicação **entre serviços** usa **IP privado** da VPC; o que o **navegador** acessa usa **DNS público**. O `env.aws` separa isso (`*_PRIVATE` × `*_PUBLIC`), e como há serviços condensados, **vários endereços apontam para a mesma máquina** (o `env.aws.example` traz o mapa).

---

## 1. Topologia — as 6 máquinas

Crie **6 instâncias EC2** (Ubuntu 22.04/24.04). No console, dê a cada uma o **nome
da coluna `Nome`** abaixo na **tag `Name`** (o campo "Name" da lista de instâncias).
Esse nome bate com o `deployN.sh` que ela roda e com os serviços systemd
(`spaceship-<algo>`) — assim fica fácil saber em qual máquina você está e onde
estão os logs.

| # | Nome da instância (tag **Name**) | Script que roda nela | Serviços | Porta(s) que ela usa | Tipo |
|---|---|---|---|---|---|
| 1 | `spaceship-data1` | `deploy1.sh` | PostgreSQL **primário** + Redis | TCP 5432 · TCP 6379 | t3.medium |
| 2 | `spaceship-data2` | `deploy2.sh` | Kafka + PostgreSQL **réplica** | TCP 9092 (+9093 interno) · TCP 5432 | t3.medium |
| 3 | `spaceship-app` | `deploy3.sh` | Auth + Gateway + Score + Frontend | TCP 5000 + 5005 · TCP 3000 · TCP 8000 · TCP 80 | t3.medium |
| 4 | `spaceship-engine1` | `deploy4.sh` | Game Engine `jogo1` | TCP 4001 + 5001 · UDP 20001-20030 | t3.small |
| 5 | `spaceship-engine2` | `deploy5.sh` | Game Engine `jogo2` | TCP 4002 + 5002 · UDP 20001-20030 | t3.small |
| 6 | `spaceship-engine3` | `deploy6.sh` | Game Engine `jogo3` | TCP 4003 + 5003 · UDP 20001-20030 | t3.small |

> As máquinas **1 e 2** (`spaceship-data1`, `spaceship-data2`) são o **estado
> compartilhado** do sistema (banco, cache de ranking e fila de eventos). É nelas
> que a "memória compartilhada" entre as partidas e os jogadores realmente vive.
>
> **Dois tipos de acesso, lidos assim:** "**rede interna**" = só as outras máquinas
> alcançam, pelo **IP privado** da VPC — essas portas **não** ficam abertas para a
> internet (é o §3 que garante isso). "**navegador**" = precisa de uma **porta
> pública** aberta.

### 1.1 Descrição dos 6 deploys

Cada parágrafo diz **o que a máquina instala**, **por que esses serviços estão
juntos** e **qual conceito distribuído** ela demonstra.

- **`deploy1.sh` — `spaceship-data1` (PostgreSQL primário + Redis).** O **banco
  autoritativo de escrita** (tabela `Users` do Auth + tabela `scores`
  **particionada por minigame**, item 11) e o **cache do ranking** (Redis, item 6).
  É o **estado primário** do sistema — por isso roda **primeiro**: todas as outras
  máquinas dependem dela, e a réplica do `deploy2` copia justamente este primário.

- **`deploy2.sh` — `spaceship-data2` (Kafka + PostgreSQL réplica).** O **Kafka** é o
  **barramento de eventos assíncrono** (tópico `match-completed`, itens 4/5): os
  engines publicam o fim de partida e o Score consome. A **réplica** é uma cópia
  **somente-leitura** do primário — é ela que demonstra a **replicação
  Primary-Replica** (item 10). Ela mora numa **máquina separada do primário** de
  propósito; é o que torna a replicação real. Por copiar o primário via
  `pg_basebackup`, o `deploy1` precisa **já estar no ar** quando você rodar o
  `deploy2`.

- **`deploy3.sh` — `spaceship-app` (Auth + Gateway + Score + Frontend).** A
  **camada de borda**: tudo que o **navegador** acessa direto — login/cadastro
  (Auth REST :5000), lobby/matchmaking (Gateway :3000), ranking global (Score
  :8000) e o **site** (Frontend :80). Como **Auth e Gateway** estão na **mesma
  máquina**, a **validação de sessão via gRPC síncrono (item 8)** acontece aqui (o
  gateway chama o Auth em :5005). Continua sendo uma **chamada gRPC real entre dois
  processos** — só que agora no mesmo host — então o item 8 segue válido.

- **`deploy4.sh` / `deploy5.sh` / `deploy6.sh` — `spaceship-engine1/2/3`
  (um Game Engine por máquina).** Cada engine roda **sozinho na sua EC2**:
  `deploy4`=`jogo1`, `deploy5`=`jogo2`, `deploy6`=`jogo3`. Esse isolamento é o
  **Particionamento Funcional** (item 1): **derrubar a máquina de um jogo não afeta
  os outros dois**. É a demonstração de tolerância a falha mais importante da
  entrega — por isso os engines **não** são condensados juntos, mesmo com o limite
  de máquinas.

---

## 2. Antes de subir — checklist de pré-deploy

1. **Par de chaves SSH** criado e baixado (você já sabe usar).
2. **VPC/sub-rede:** use a **VPC padrão** (todas as 6 EC2 na mesma VPC/região, para se enxergarem pelo IP privado). Anote o **CIDR** da sub-rede (na VPC padrão costuma ser `172.31.0.0/16`) — vai no `VPC_CIDR` do `env.aws`.
3. **Segredos definidos** (iguais em todas as máquinas):
   - `JWT_SECRET` — gere com `openssl rand -base64 48`.
   - `POSTGRES_PASSWORD` — senha forte (evite aspas/`$`/espaço para não escapar no script).
   - `PG_REPL_PASSWORD` — senha do papel de replicação (a réplica usa para copiar o primário).
4. **Sem nada chumbado:** o cliente lê tudo de [`frontend/config.js`](../../frontend/config.js) (hosts por serviço) e o `deploy3` **gera** esse arquivo com os DNS públicos. Os back-ends leem endereços por variável de ambiente. Você **não edita código** — só preenche o `env.aws`.
5. **Um `env.aws` para todas:** preencha **um** `env.aws` completo (com os IPs/DNS das 6 EC2) e copie igual para cada máquina. O cabeçalho do [`env.aws.example`](../../deploy/aws/env.aws.example) traz o **mapa de qual variável é de qual `deployN`** — incluindo o ponto que mais confunde: como Auth, Gateway e Score estão na **mesma** `spaceship-app`, os três `*_PUBLIC` (`AUTH_HOST_PUBLIC`, `GATEWAY_HOST_PUBLIC`, `SCORE_HOST_PUBLIC`) recebem o **mesmo DNS público** — o da `spaceship-app`.
6. **gRPC (item 8):** o gateway valida a sessão no Auth via gRPC. Como os dois estão na `spaceship-app`, o `AUTH_GRPC_URL` aponta para o **IP privado dessa própria máquina** (:5005). Sem o Auth no ar, o gateway cai para validação local (não trava) — mas o `deploy3` já sobe o Auth **antes** do gateway, então o item 8 fica ligado de fábrica.

---

## 3. Security Groups (firewall) — passo a passo

> **O conceito que destrava tudo:** o Security Group (SG) é o firewall da AWS. **Toda
> porta já nasce FECHADA** para a internet. Ela só abre quando você cria uma **regra
> de entrada (inbound)** liberando-a. Ou seja — você **não "fecha" porta nenhuma**;
> você **só abre as poucas que o navegador precisa**, e todo o resto continua
> fechado sozinho. Guarde essa frase: *abrir = criar regra; não expor = não criar a
> regra.*

Vamos usar **um único Security Group** para as 6 instâncias. No total você vai
criar **8 regras de entrada**: **1 interna** (as máquinas conversando entre si) +
**7 públicas** (o que vem da internet). Só isso.

### 3.1 Criar o Security Group e colar as instâncias nele

1. EC2 → menu lateral **Security Groups** → **Create security group**.
2. **Security group name:** `spaceship-sg` · **Description:** `Spaceship` · **VPC:** a
   **VPC padrão** (a mesma das instâncias).
3. Clique em **Create security group** (por enquanto sem regras — vamos adicioná-las
   nos passos 3.2 e 3.3).
4. **Coloque as 6 instâncias dentro deste SG:** na lista de instâncias, selecione
   uma → **Actions → Security → Change security groups** → escolha `spaceship-sg` →
   **Add → Save**. Repita para cada instância. *(Quem cria as EC2 já pode escolher
   `spaceship-sg` na hora.)*

### 3.2 Regra 1 — malha interna (as máquinas falando entre si)

Esta única regra é o que faz o banco, o Redis, o Kafka e o gRPC funcionarem **sem
expor nada à internet**. Em `spaceship-sg` → aba **Inbound rules** → **Edit inbound
rules** → **Add rule**, e preencha exatamente assim:

| Campo no console | O que selecionar/digitar |
|---|---|
| **Type** | `All traffic` |
| **Protocol** | `All` *(preenche sozinho)* |
| **Port range** | `All` *(preenche sozinho)* |
| **Source** | `Custom` → comece a digitar `sg-` e **escolha o próprio `spaceship-sg`** |

Em português: *"qualquer máquina que esteja neste SG pode falar com as outras em
qualquer porta"*. Como a origem é o **próprio SG** (e **não** `0.0.0.0/0`), isso
vale **só entre as suas instâncias** — a internet não entra por aqui.

### 3.3 Regras 2 a 8 — públicas (o que vem da internet)

Continue em **Edit inbound rules** e clique em **Add rule** **uma vez para cada
linha** abaixo. A coluna **Type** é exatamente a opção que você escolhe no menu
suspenso do console:

| Regra | Type (menu do console) | Protocolo | Port range | Source | Para que serve | Máquina que de fato escuta |
|---|---|---|---|---|---|---|
| 2 | **SSH** | TCP | `22` | **My IP** | conectar via SSH para administrar | todas |
| 3 | **HTTP** | TCP | `80` | `0.0.0.0/0` | abrir o site no navegador | `spaceship-app` |
| 4 | **Custom TCP** | TCP | `3000` | `0.0.0.0/0` | jogo em tempo real (gateway / Socket.io) | `spaceship-app` |
| 5 | **Custom TCP** | TCP | `5000` | `0.0.0.0/0` | login e cadastro (Auth REST) | `spaceship-app` |
| 6 | **Custom TCP** | TCP | `5001-5003` | `0.0.0.0/0` | "aperto de mão" do WebRTC (engines) | `spaceship-engine1/2/3` |
| 7 | **Custom TCP** | TCP | `8000` | `0.0.0.0/0` | ler o ranking global (Score) | `spaceship-app` |
| 8 | **Custom UDP** | **UDP** | `20001-20030` | `0.0.0.0/0` | mídia/dados do WebRTC em tempo real (engines) | `spaceship-engine1/2/3` |

Quatro avisos que evitam os tropeços mais comuns:

- **Type x Protocolo:** ao escolher `SSH` ou `HTTP`, o console **preenche** o
  protocolo e a porta sozinho. Nas demais, escolha **`Custom TCP`** (ou **`Custom
  UDP`** na regra 8) e **digite a porta** no campo *Port range*.
- **A regra 8 é a ÚNICA em UDP.** Se você criá-la como `Custom TCP` por engano, o
  WebRTC não consegue abrir o canal de mídia/dados.
- **`0.0.0.0/0`** = "qualquer lugar da internet". **`My IP`** = só o seu IP atual —
  use-o na regra 2 (SSH). Se sua internet trocar de IP e o SSH parar, edite a regra 2
  e clique em **My IP** de novo.
- **"Mas isso abre a porta 80 nas 6 máquinas!"** Sim, e é **inofensivo**: o SG é
  compartilhado, mas só a `spaceship-app` tem algo escutando na 80; nas outras a
  porta simplesmente **não responde**. O mesmo vale para 3000, 5000, 8000 etc.

Pronto: clique em **Save rules**. Você deve ver **8 regras de entrada** (1 interna +
7 públicas).

### 3.4 As portas que você NÃO abre — e por que não precisa fazer nada

Repare que a tabela do 3.3 **não tem** linha para o banco, o Redis, o Kafka nem o
gRPC. **Isso é de propósito.** E aqui está o ponto que costuma confundir: você **não
precisa "fechar" essas portas** — como você **nunca criou uma regra pública** para
elas, elas **já estão fechadas para a internet** desde o começo. Elas continuam
funcionando entre as máquinas porque a **Regra 1 (malha interna)** libera qualquer
porta **dentro do SG**:

| Porta | Serviço | Fica acessível só por... |
|---|---|---|
| TCP **5432** | PostgreSQL (primário em `spaceship-data1`, réplica em `spaceship-data2`) | outras máquinas do SG (Regra 1) |
| TCP **6379** | Redis (`spaceship-data1`) | outras máquinas do SG (Regra 1) |
| TCP **9092** + **9093** | Kafka — cliente + controller (`spaceship-data2`) | outras máquinas do SG (Regra 1) |
| TCP **5005** | Auth — gRPC, item 8 (`spaceship-app`) | o gateway (mesma máquina) e a malha interna |
| TCP **4001-4003** | relay engine↔gateway, Socket.io interno (engines) | o `spaceship-app` (Regra 1) |

Resumindo a regra mental: **"expor uma porta" = criar uma regra com origem
`0.0.0.0/0`** para ela. Como você nunca digita 5432 / 6379 / 9092 / 5005 / 4001-4003
na lista pública (3.3), elas ficam **invisíveis para a internet**, mas **vivas dentro
da VPC**. Não há botão de "fechar" — o fechado é o estado padrão.

> *Existe um modo mais rígido (um SG por serviço, abrindo cada porta só para a
> origem exata que a usa). É o ideal em produção, mas dá bastante trabalho extra e
> **não é necessário** para esta entrega — por isso este guia fica no SG único acima.*

---

## 4. Passo a passo de subida

Em **cada uma das 6** EC2, conecte por SSH e faça uma vez:

```bash
sudo apt-get update -y && sudo apt-get install -y git
git clone <URL_DO_REPO> && cd Trabalho-Scd-Grupo-6
cp deploy/aws/env.aws.example deploy/aws/env.aws
nano deploy/aws/env.aws        # preencha segredos + IPs privados/públicos das 6 EC2
```

> Dica: preencha **um** `env.aws` completo no seu PC e copie igual para todas as
> máquinas (`scp`). Pegue os IPs **privados** no console (ou `hostname -I` dentro
> da EC2) e os **DNS públicos** na aba da instância. O cabeçalho do `env.aws.example`
> diz qual variável é de qual máquina.

Depois rode, **em cada máquina, o `deployN.sh` dela**, nesta **ordem** (primeiro o
estado compartilhado; a réplica depende do primário; o app antes dos engines):

```bash
# 1) na spaceship-data1 — PostgreSQL primário + Redis  [RODE PRIMEIRO]
sudo bash deploy/aws/deploy1.sh

# 2) na spaceship-data2 — Kafka + PostgreSQL réplica  [depois que o deploy1 estiver no ar]
sudo bash deploy/aws/deploy2.sh

# 3) na spaceship-app — Auth + Gateway + Score + Frontend
sudo bash deploy/aws/deploy3.sh

# 4) nas spaceship-engine1 / engine2 / engine3 — um engine por máquina
sudo bash deploy/aws/deploy4.sh     # na spaceship-engine1 (jogo1)
sudo bash deploy/aws/deploy5.sh     # na spaceship-engine2 (jogo2)
sudo bash deploy/aws/deploy6.sh     # na spaceship-engine3 (jogo3)
```

Cada `deployN.sh` chama, por baixo, as peças de `deploy/aws/lib/` e registra **um
serviço systemd por serviço** (`spaceship-<algo>`): sobe no boot e reinicia se cair.
Como cada serviço é um unit independente, a demonstração de isolamento (§5.7)
continua valendo — dá para parar **só** o engine de um jogo. Para ver estado/logs:

```bash
# na spaceship-app, por exemplo:
sudo systemctl status spaceship-auth spaceship-gateway spaceship-score
# logs de um serviço específico:
sudo journalctl -u spaceship-engine-jogo1 -f
```

Os nomes dos serviços systemd por máquina:

| Máquina | Serviços systemd |
|---|---|
| `spaceship-data1` | `postgresql` · `redis-server` |
| `spaceship-data2` | `spaceship-kafka` · `postgresql` (réplica) |
| `spaceship-app` | `spaceship-auth` · `spaceship-gateway` · `spaceship-score` · `nginx` |
| `spaceship-engine1/2/3` | `spaceship-engine-jogo1` / `-jogo2` / `-jogo3` |

---

## 5. Bateria de testes (item 12) — só subir e exercitar

> O item 12 na AWS é **subir os serviços e exercitá-los** — não há código de
> teste novo: reaproveitamos os bots de [`load-test/`](../../load-test/) e
> alguns comandos de checagem. Aqui `<APP_PUB>` é o **DNS público da
> `spaceship-app`** (Auth, Gateway, Score e Frontend estão todos nela).

### 5.1 Smoke test (cada serviço respondeu?)

Do seu PC, trocando pelo **DNS público da `spaceship-app`**:

```bash
curl -s -o /dev/null -w "frontend %{http_code}\n" http://<APP_PUB>
curl -s -o /dev/null -w "auth     %{http_code}\n" http://<APP_PUB>:5000/api/auth/wins/x   # 404 = no ar
curl -s -o /dev/null -w "gateway  %{http_code}\n" http://<APP_PUB>:3000/socket.io/         # 400 = no ar
curl -s "http://<APP_PUB>:8000/health"
```

### 5.2 Jogar no navegador

Abra `http://<APP_PUB>`, **registre**, faça **login** e jogue os 3 minigames.
No DevTools (console) você verá `"[WebRTC] canal de jogo aberto: jogoX"` se o
DataChannel abrir; senão, cai para Socket.io (a partida funciona mesmo assim).

### 5.3 Clientes simulados / concorrência (req. 4.2)

Do seu PC (ou de uma EC2 extra) apontando para a `spaceship-app`:

```bash
cd load-test && npm install
node run.js --bots=8 --game=mix \
  --gateway=http://<APP_PUB>:3000 \
  --auth=http://<APP_PUB>:5000/api/auth
```

Esperado: vários bots conectam, jogam **partidas concorrentes** e o relatório
fecha com **0 erros**. Confira o ranking materializado:

```bash
curl -s "http://<APP_PUB>:8000/api/scores?limit=5" | python3 -m json.tool
```

### 5.4 Interação síncrona — gRPC (item 8)

1. Confirme que o gateway está validando via gRPC (não só local). **Na `spaceship-app`:**
   ```bash
   sudo journalctl -u spaceship-gateway | grep -i grpc
   # esperado: "validação de sessão via gRPC em <IP_PRIVADO_DA_APP>:5005"
   ```
2. **Revogação** (o que a validação local não pegaria): registre um usuário, jogue,
   depois **remova-o** no Postgres **primário** e tente conectar de novo com o mesmo
   token — o gateway recusa (o Auth respondeu, via gRPC, que o usuário não existe
   mais). **Na `spaceship-data1`:**
   ```bash
   sudo -u postgres psql -d authdb -c "DELETE FROM \"Users\" WHERE \"Username\"='SEU_USER';"
   ```
   Uma **nova** conexão desse usuário pelo gateway passa a falhar na autenticação.

### 5.5 Particionamento de dados (item 11)

Na **`spaceship-data1`** (Postgres primário), veja o **partition pruning** (só a
partição do jogo é lida):

```bash
sudo -u postgres psql -d authdb -c "\d+ scores"
sudo -u postgres psql -d authdb -c "EXPLAIN (COSTS OFF) SELECT * FROM scores WHERE game='jogo2';"
sudo -u postgres psql -d authdb -c "SELECT tableoid::regclass AS particao, count(*) FROM scores GROUP BY 1;"
```

Esperado: o `EXPLAIN` cita só `scores_jogo2`; a contagem mostra as linhas distribuídas por partição.

### 5.6 Replicação Primary-Replica (item 10)

Na **`spaceship-data2`** (réplica): deve estar em modo recovery (somente leitura):

```bash
sudo -u postgres psql -tc "SELECT pg_is_in_recovery();"   # -> t
```

Escreva no **primário** (`spaceship-data1`, jogue uma partida ou rode os bots do
§5.3) e **leia a tabela `scores` na réplica** (`spaceship-data2`) — as linhas novas
aparecem propagadas (consistência eventual da replicação em streaming):

```bash
# na spaceship-data2 (réplica):
sudo -u postgres psql -d authdb -c "SELECT game, count(*) FROM scores GROUP BY game;"
```

Tentar **escrever** na réplica falha de propósito (`cannot execute INSERT in a
read-only transaction`) — é o que confirma que ela é a cópia somente-leitura.

### 5.7 Tolerância a falha / isolamento (Particionamento Funcional)

Derrube o engine de um jogo e veja os outros seguirem. **Na `spaceship-engine1`:**

```bash
sudo systemctl stop spaceship-engine-jogo1
```

Jogos 2 e 3 continuam normais; o Jogo 1 fica indisponível sem derrubar o resto.
Religue com `sudo systemctl start spaceship-engine-jogo1`. Para simular a **queda da
máquina inteira**, pare/inicie a própria EC2 `spaceship-engine1` no console — os
outros dois jogos seguem no ar.

---

## 6. Operação e solução de problemas

- **Estado/logs:** `systemctl status spaceship-<svc>` · `journalctl -u spaceship-<svc> -f`. (Postgres e Redis usam os nomes nativos `postgresql` e `redis-server`.)
- **Reaplicar config:** editou o `env.aws`? rode de novo o `deployN.sh` da máquina (idempotente — reinstala/reescreve só o necessário).
- **A réplica (deploy2) falhou ao subir:** quase sempre é o **primário (deploy1) ainda não estava no ar** quando você rodou o `deploy2`. Confirme o `deploy1`, depois rode `sudo bash deploy/aws/deploy2.sh` de novo (o Kafka já estará no ar; só a réplica é refeita).
- **Kafka não conecta:** confira `advertised.listeners` (= IP **privado** da `spaceship-data2`) e se as 6 máquinas estão todas no `spaceship-sg` — é a **Regra 1** (malha interna) que libera o 9092 entre engines/score (não há regra pública de 9092). Logs do engine: `journalctl -u spaceship-engine-jogo2 | grep -i kafka` → `produtor conectado`.
- **Ranking vazio:** só partidas **novas** contam; reabra a tela "Ranking Global". Veja `journalctl -u spaceship-score -f` (na `spaceship-app`) ao encerrar uma partida.
- **CORS no console do navegador:** o Score libera `*`; confira o `SCORE_HOST` no `config.js` gerado (`cat /var/www/html/config.js` na `spaceship-app`) — ele deve ser o DNS público da própria `spaceship-app`.
- **WebRTC não abre (NAT):** é o ponto avançado do item 2. A faixa UDP precisa estar aberta (**regra 8** do `spaceship-sg`, `Custom UDP 20001-20030`); mesmo sem WebRTC, o jogo roda via **Socket.io** (fallback). Medir a latência WebRTC×WS fica como validação opcional.

---

## 7. Desligar para não gastar

Pare (sem terminar) as 6 instâncias quando não estiver testando — os serviços são
systemd e **sobem sozinhos** quando você ligar a EC2 de novo. Se você parar e religar
a `spaceship-data1`, suba-a **antes** da `spaceship-data2` (a réplica espera o
primário). Termine as instâncias só quando o trabalho estiver entregue.
