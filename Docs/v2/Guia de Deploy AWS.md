# Guia de Deploy na AWS — Spaceship (v2)

**Item 3 + 9.7 + 12 do [Plano v2](Plano%20de%20correções%20pendentes%20para%20v2.md).** Como subir a stack distribuída na **AWS EC2**, com **1 serviço por máquina** e **sem Docker** (o `docker-compose.yml` é só para teste local). Cada serviço sobe por um script nativo em [`deploy/aws/`](../../deploy/aws/) (systemd) e a bateria de testes (item 12) reaproveita os bots de [`load-test/`](../../load-test/).

> **Para quem é este guia:** você já sabe abrir EC2, ver o IP, conectar por SSH e
> criar Security Groups. Aqui o foco é **o que instalar, qual script rodar, com
> qual configuração, em que ordem, e como testar** cada característica distribuída.

---

## 0. Decisões que valem para todo o guia

- **Sem Docker na AWS.** Docker foi só para teste local; na nuvem cada serviço roda **nativo** (systemd).
- **1 serviço por EC2** (segue a especificação, req. 1.1/3). São **10 máquinas** (ou 11 com a réplica do banco). Dá para **economizar agrupando** (ver §7), mas o guia descreve o cenário cheio.
- **Balanceamento sem ALB.** Quem distribui as **partidas** é o **matchmaking do gateway** (escolhe o engine e devolve o endereço; o cliente conecta direto). O navegador fala direto com o **DNS público** de cada serviço (sem Application Load Balancer).
- **AMI:** **Ubuntu Server 22.04 ou 24.04 LTS** (os scripts usam `apt` + `systemd`). Para Amazon Linux, troque `apt-get`→`dnf` e os nomes dos pacotes.
- **Tipo de instância:** `t3.small` para a maioria; **`t3.medium` para o Kafka** (Java consome memória). `t3.micro` serve para Redis e frontend.
- **Endereços:** comunicação **entre serviços** usa **IP privado** da VPC; o que o **navegador** acessa usa **DNS público**. Os scripts já separam isso (`*_PRIVATE` × `*_PUBLIC` no `env.aws`).

---

## 1. Topologia — quantas máquinas e o nome de cada uma

**São 10 instâncias EC2** (uma por serviço) — ou **11** se você também subir a
réplica opcional do Postgres (item 10). Crie todas iguais (Ubuntu 22.04/24.04) e,
no console, dê a cada uma o **nome da coluna `Nome`** abaixo na **tag `Name`** (o
campo "Name" que aparece na lista de instâncias, no lápis de edição). Esses nomes
batem com o do serviço systemd (`spaceship-<algo>`), então depois fica fácil saber
em qual máquina você está e onde estão os logs.

| # | Nome da instância (tag **Name**) | Script que roda nela | Porta(s) que ela usa | Quem acessa essas portas |
|---|---|---|---|---|
| 1 | `spaceship-postgres` | `postgres.sh primary` | TCP 5432 | Auth + Score (rede interna) |
| 2 | `spaceship-redis` | `redis.sh` | TCP 6379 | Score (rede interna) |
| 3 | `spaceship-kafka` | `kafka.sh` | TCP 9092 (+9093 interno) | Engines + Score (rede interna) |
| 4 | `spaceship-auth` | `auth.sh` | TCP 5000 (REST) + TCP 5005 (gRPC) | navegador (5000) · gateway (5005, rede interna) |
| 5 | `spaceship-engine-jogo1` | `engine.sh jogo1` | TCP 4001 + TCP 5001 + UDP 20001-20030 | gateway (4001, rede interna) · navegador (5001 + UDP) |
| 6 | `spaceship-engine-jogo2` | `engine.sh jogo2` | TCP 4002 + TCP 5002 + UDP 20001-20030 | idem |
| 7 | `spaceship-engine-jogo3` | `engine.sh jogo3` | TCP 4003 + TCP 5003 + UDP 20001-20030 | idem |
| 8 | `spaceship-gateway` | `gateway.sh` | TCP 3000 | navegador |
| 9 | `spaceship-score` | `score.sh` | TCP 8000 | navegador (lê o ranking) |
| 10 | `spaceship-frontend` | `frontend.sh` | TCP 80 | navegador |
| 11 | `spaceship-postgres-replica` *(opcional, item 10)* | `postgres.sh replica` | TCP 5432 | Score-leitura (rede interna) |

> As máquinas **1, 2 e 3** (`spaceship-postgres`, `spaceship-redis`, `spaceship-kafka`)
> são o **estado compartilhado** do sistema distribuído (banco, cache de ranking e
> fila de eventos). É nelas que a "memória compartilhada" entre as partidas e os
> jogadores realmente vive.
>
> **Dois tipos de acesso, lidos assim:** "**rede interna**" = só as outras máquinas
> alcançam, pelo **IP privado** da VPC — essas portas **não** ficam abertas para a
> internet (é o §3 que garante isso). "**navegador**" = precisa de uma **porta
> pública** aberta.

---

## 2. Antes de subir — checklist de pré-deploy

1. **Par de chaves SSH** criado e baixado (você já sabe usar).
2. **VPC/sub-rede:** use a **VPC padrão** (todas as EC2 na mesma VPC/região, para se enxergarem pelo IP privado). Anote o **CIDR** da sub-rede (na VPC padrão costuma ser `172.31.0.0/16`) — vai no `VPC_CIDR` do `env.aws`.
3. **Segredos definidos** (iguais em todas as máquinas):
   - `JWT_SECRET` — gere com `openssl rand -base64 48`.
   - `POSTGRES_PASSWORD` — senha forte (evite aspas/`$`/espaço para não escapar no script).
4. **Sem nada chumbado:** o cliente já lê tudo de [`frontend/config.js`](../../frontend/config.js) (com **hosts por serviço**, ajuste pré-deploy desta versão) e o `frontend.sh` **gera** esse arquivo com os DNS públicos. Os back-ends leem endereços por variável de ambiente. Você **não edita código** — só preenche o `env.aws`.
5. **gRPC (item 8):** o gateway valida a sessão no Auth via gRPC. Já vem ligado pelo `AUTH_GRPC_URL` que o `gateway.sh` injeta (IP privado do Auth + 5005). Sem o Auth no ar, o gateway cai para validação local (não trava) — mas para **demonstrar o item 8**, suba o Auth antes do gateway.

---

## 3. Security Groups (firewall) — passo a passo

> **O conceito que destrava tudo:** o Security Group (SG) é o firewall da AWS. **Toda
> porta já nasce FECHADA** para a internet. Ela só abre quando você cria uma **regra
> de entrada (inbound)** liberando-a. Ou seja — você **não "fecha" porta nenhuma**;
> você **só abre as poucas que o navegador precisa**, e todo o resto continua
> fechado sozinho. Guarde essa frase: *abrir = criar regra; não expor = não criar a
> regra.*

Vamos usar **um único Security Group** para as 10 instâncias. No total você vai
criar **8 regras de entrada**: **1 interna** (as máquinas conversando entre si) +
**7 públicas** (o que vem da internet). Só isso.

### 3.1 Criar o Security Group e colar as instâncias nele

1. EC2 → menu lateral **Security Groups** → **Create security group**.
2. **Security group name:** `spaceship-sg` · **Description:** `Spaceship` · **VPC:** a
   **VPC padrão** (a mesma das instâncias).
3. Clique em **Create security group** (por enquanto sem regras — vamos adicioná-las
   nos passos 3.2 e 3.3).
4. **Coloque as 10 instâncias dentro deste SG:** na lista de instâncias, selecione
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
| 3 | **HTTP** | TCP | `80` | `0.0.0.0/0` | abrir o site no navegador | `spaceship-frontend` |
| 4 | **Custom TCP** | TCP | `3000` | `0.0.0.0/0` | jogo em tempo real (gateway / Socket.io) | `spaceship-gateway` |
| 5 | **Custom TCP** | TCP | `5000` | `0.0.0.0/0` | login e cadastro (Auth REST) | `spaceship-auth` |
| 6 | **Custom TCP** | TCP | `5001-5003` | `0.0.0.0/0` | "aperto de mão" do WebRTC (engines) | os 3 engines |
| 7 | **Custom TCP** | TCP | `8000` | `0.0.0.0/0` | ler o ranking global (Score) | `spaceship-score` |
| 8 | **Custom UDP** | **UDP** | `20001-20030` | `0.0.0.0/0` | mídia/dados do WebRTC em tempo real (engines) | os 3 engines |

Quatro avisos que evitam os tropeços mais comuns:

- **Type x Protocolo:** ao escolher `SSH` ou `HTTP`, o console **preenche** o
  protocolo e a porta sozinho. Nas demais, escolha **`Custom TCP`** (ou **`Custom
  UDP`** na regra 8) e **digite a porta** no campo *Port range*.
- **A regra 8 é a ÚNICA em UDP.** Se você criá-la como `Custom TCP` por engano, o
  WebRTC não consegue abrir o canal de mídia/dados.
- **`0.0.0.0/0`** = "qualquer lugar da internet". **`My IP`** = só o seu IP atual —
  use-o na regra 2 (SSH). Se sua internet trocar de IP e o SSH parar, edite a regra 2
  e clique em **My IP** de novo.
- **"Mas isso abre a porta 80 nas 10 máquinas!"** Sim, e é **inofensivo**: o SG é
  compartilhado, mas só a `spaceship-frontend` tem algo escutando na 80; nas outras a
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
| TCP **5432** | PostgreSQL | outras máquinas do SG (Regra 1) |
| TCP **6379** | Redis | outras máquinas do SG (Regra 1) |
| TCP **9092** + **9093** | Kafka (cliente + controller) | outras máquinas do SG (Regra 1) |
| TCP **5005** | Auth — gRPC (item 8) | outras máquinas do SG (Regra 1) |
| TCP **4001-4003** | relay engine↔gateway (Socket.io interno) | o `spaceship-gateway` (Regra 1) |

Resumindo a regra mental: **"expor uma porta" = criar uma regra com origem
`0.0.0.0/0`** para ela. Como você nunca digita 5432 / 6379 / 9092 / 5005 / 4001-4003
na lista pública (3.3), elas ficam **invisíveis para a internet**, mas **vivas dentro
da VPC**. Não há botão de "fechar" — o fechado é o estado padrão.

> *Existe um modo mais rígido (um SG por serviço, abrindo cada porta só para a
> origem exata que a usa). É o ideal em produção, mas dá bastante trabalho extra e
> **não é necessário** para esta entrega — por isso este guia fica no SG único acima.*

---

## 4. Passo a passo de subida

Em **cada** EC2, conecte por SSH e faça uma vez:

```bash
sudo apt-get update -y && sudo apt-get install -y git
git clone <URL_DO_REPO> && cd Trabalho-Scd-Grupo-6
cp deploy/aws/env.aws.example deploy/aws/env.aws
nano deploy/aws/env.aws        # preencha segredos + IPs privados/públicos
```

> Dica: preencha **um** `env.aws` completo no seu PC e copie igual para todas as
> máquinas (`scp`). Pegue os IPs **privados** no console (ou `hostname -I` dentro
> da EC2) e os **DNS públicos** na aba da instância.

Depois rode o script da máquina (na **ordem** abaixo — primeiro o estado compartilhado, por último o frontend):

```bash
# 1) dados/mensageria (máquinas 1-3)
sudo bash deploy/aws/postgres.sh primary
sudo bash deploy/aws/redis.sh
sudo bash deploy/aws/kafka.sh

# 2) auth ANTES do gateway (para o gRPC do item 8 já validar de verdade)
sudo bash deploy/aws/auth.sh

# 3) engines (máquinas 5-7)
sudo bash deploy/aws/engine.sh jogo1
sudo bash deploy/aws/engine.sh jogo2
sudo bash deploy/aws/engine.sh jogo3

# 4) gateway e score
sudo bash deploy/aws/gateway.sh
sudo bash deploy/aws/score.sh

# 5) frontend (gera o config.js com os DNS públicos)
sudo bash deploy/aws/frontend.sh

# 6) opcional (item 10): réplica de leitura do Postgres, em OUTRA EC2
sudo bash deploy/aws/postgres.sh replica
```

Cada script registra um serviço **systemd** (`spaceship-<algo>`): sobe no boot e
reinicia se cair. Para ver o estado/logs:

```bash
sudo systemctl status spaceship-auth
sudo journalctl -u spaceship-engine-jogo1 -f
```

---

## 5. Bateria de testes (item 12) — só subir e exercitar

> O item 12 na AWS é **subir os serviços e exercitá-los** — não há código de
> teste novo: reaproveitamos os bots de [`load-test/`](../../load-test/) e
> alguns comandos de checagem.

### 5.1 Smoke test (cada serviço respondeu?)

Do seu PC, trocando pelos **DNS públicos**:

```bash
curl -s -o /dev/null -w "frontend %{http_code}\n" http://<FRONTEND_PUB>
curl -s -o /dev/null -w "auth     %{http_code}\n" http://<AUTH_PUB>:5000/api/auth/wins/x   # 404 = no ar
curl -s -o /dev/null -w "gateway  %{http_code}\n" http://<GATEWAY_PUB>:3000/socket.io/      # 400 = no ar
curl -s "http://<SCORE_PUB>:8000/health"
```

### 5.2 Jogar no navegador

Abra `http://<FRONTEND_PUB>`, **registre**, faça **login** e jogue os 3 minigames.
No DevTools (console) você verá `"[WebRTC] canal de jogo aberto: jogoX"` se o
DataChannel abrir; senão, cai para Socket.io (a partida funciona mesmo assim).

### 5.3 Clientes simulados / concorrência (req. 4.2)

Do seu PC (ou de uma EC2 extra) apontando para os **DNS públicos**:

```bash
cd load-test && npm install
node run.js --bots=8 --game=mix \
  --gateway=http://<GATEWAY_PUB>:3000 \
  --auth=http://<AUTH_PUB>:5000/api/auth
```

Esperado: vários bots conectam, jogam **partidas concorrentes** e o relatório
fecha com **0 erros**. Confira o ranking materializado:

```bash
curl -s "http://<SCORE_PUB>:8000/api/scores?limit=5" | python3 -m json.tool
```

### 5.4 Interação síncrona — gRPC (item 8)

1. Confirme que o gateway está validando via gRPC (não só local):
   ```bash
   sudo journalctl -u spaceship-gateway | grep -i grpc
   # esperado: "validação de sessão via gRPC em <AUTH_PRIV>:5005"
   ```
2. **Revogação** (o que a validação local não pegaria): registre um usuário, jogue,
   depois **remova-o** no Postgres e tente conectar de novo com o mesmo token —
   o gateway recusa (o Auth respondeu, via gRPC, que o usuário não existe mais):
   ```bash
   # na EC2 do postgres:
   sudo -u postgres psql -d authdb -c "DELETE FROM \"Users\" WHERE \"Username\"='SEU_USER';"
   ```
   Uma **nova** conexão desse usuário pelo gateway passa a falhar na autenticação.

### 5.5 Particionamento de dados (item 11)

Na EC2 do Postgres, veja o **partition pruning** (só a partição do jogo é lida):

```bash
sudo -u postgres psql -d authdb -c "\d+ scores"
sudo -u postgres psql -d authdb -c "EXPLAIN (COSTS OFF) SELECT * FROM scores WHERE game='jogo2';"
sudo -u postgres psql -d authdb -c "SELECT tableoid::regclass AS particao, count(*) FROM scores GROUP BY 1;"
```

Esperado: o `EXPLAIN` cita só `scores_jogo2`; a contagem mostra as linhas distribuídas por partição.

### 5.6 Replicação Primary-Replica (item 10)

Na **réplica**: deve estar em modo recovery (somente leitura):

```bash
sudo -u postgres psql -tc "SELECT pg_is_in_recovery();"   # -> t
```

Escreva no **primário** (jogue uma partida) e leia o ranking na **réplica** —
os dados aparecem propagados (consistência eventual da replicação em streaming).

### 5.7 Tolerância a falha / isolamento (Particionamento Funcional)

Derrube o engine de um jogo e veja os outros seguirem:

```bash
sudo systemctl stop spaceship-engine-jogo1     # na EC2 do engine 1
```

Jogos 2 e 3 continuam normais; o Jogo 1 fica indisponível sem derrubar o resto.
Religue com `sudo systemctl start spaceship-engine-jogo1`.

---

## 6. Operação e solução de problemas

- **Estado/logs:** `systemctl status spaceship-<svc>` · `journalctl -u spaceship-<svc> -f`.
- **Reaplicar config:** editou o `env.aws`? rode o script do serviço de novo (idempotente).
- **Kafka não conecta:** confira `advertised.listeners` (= IP **privado** da EC2 do Kafka) e se as máquinas estão todas no `spaceship-sg` — é a **Regra 1** (malha interna) que libera o 9092 entre engines/score (não há regra pública de 9092). Logs do engine: `journalctl -u spaceship-engine-jogo2 | grep -i kafka` → `produtor conectado`.
- **Ranking vazio:** só partidas **novas** contam; reabra a tela "Ranking Global". Veja `journalctl -u spaceship-score -f` ao encerrar uma partida.
- **CORS no console do navegador:** o Score libera `*`; confira o `SCORE_HOST` no `config.js` gerado (`cat /var/www/html/config.js` na EC2 do frontend).
- **WebRTC não abre (NAT):** é o ponto avançado do item 2. A faixa UDP precisa estar aberta (**regra 8** do `spaceship-sg`, `Custom UDP 20001-20030`); mesmo sem WebRTC, o jogo roda via **Socket.io** (fallback). Medir a latência WebRTC×WS fica como validação opcional.

---

## 7. Economizar (opcional) — agrupar serviços

Se 10 máquinas pesarem no orçamento, dá para **co-localizar** scripts na mesma EC2
(eles não conflitam de porta, exceto os 3 engines que usam portas próprias):

- **infra** (1 EC2): `postgres.sh` + `redis.sh` + `kafka.sh`.
- **app** (1 EC2): `auth.sh` + `gateway.sh` + `score.sh` + `frontend.sh`.
- **engines** (3 EC2, separadas): `engine.sh jogo1|jogo2|jogo3` — mantenha-as
  separadas para **demonstrar o isolamento/particionamento funcional** (o ponto
  mais relevante de Sistemas Distribuídos nesta entrega).

Nesse modo, ajuste o `env.aws`: os `*_PRIVATE`/`*_PUBLIC` de serviços co-locados
apontam para o **mesmo** IP/DNS.

---

## 8. Desligar para não gastar

Pare (sem terminar) as instâncias quando não estiver testando — os scripts são
systemd e **sobem sozinhos** quando você ligar a EC2 de novo. Termine as
instâncias só quando o trabalho estiver entregue.
