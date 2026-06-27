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

## 1. Topologia (1 serviço por EC2)

| # | EC2 (papel) | Script | Porta(s) | Quem acessa |
|---|---|---|---|---|
| 1 | **postgres** (dados compartilhados) | `postgres.sh primary` | 5432 | Auth + Score (privado) |
| 2 | **redis** (ranking / memória compartilhada) | `redis.sh` | 6379 | Score (privado) |
| 3 | **kafka** (mensageria) | `kafka.sh` | 9092 | Engines + Score (privado) |
| 4 | **auth** (C#) | `auth.sh` | 5000 REST + 5005 gRPC | navegador (REST) + gateway/engines (privado) |
| 5 | **engine-jogo1** | `engine.sh jogo1` | 4001 + 5001 + UDP 20001-20030 | gateway (4001 privado) + navegador (WebRTC) |
| 6 | **engine-jogo2** | `engine.sh jogo2` | 4002 + 5002 + UDP | idem |
| 7 | **engine-jogo3** | `engine.sh jogo3` | 4003 + 5003 + UDP | idem |
| 8 | **gateway** (Node) | `gateway.sh` | 3000 | navegador |
| 9 | **score** (Python) | `score.sh` | 8000 | navegador (lê o ranking) |
| 10 | **frontend** (Nginx) | `frontend.sh` | 80 | navegador |
| 11 | **postgres-replica** *(opcional, item 10)* | `postgres.sh replica` | 5432 | Score-leitura (privado) |

> As máquinas **1, 2 e 3** são o **estado compartilhado** do sistema distribuído
> (banco, cache de ranking e fila de eventos). É nelas que a "memória
> compartilhada" entre as partidas e os jogadores realmente vive.

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

## 3. Security Groups (portas)

### Opção A — simples (recomendada p/ começar): um SG único

Crie **um** Security Group (ex.: `spaceship-sg`) e coloque **todas** as EC2 nele:

1. **Regra interna (malha privada):** *Tipo* `All traffic` · *Origem* = **o próprio `spaceship-sg`**. Isso deixa as máquinas conversarem entre si em qualquer porta (banco, Redis, Kafka, gRPC, relay dos engines) sem abrir nada para a internet.
2. **Regras públicas (o que o navegador precisa):**

| Tipo | Porta | Origem | Por quê |
|---|---|---|---|
| SSH | 22 | **Seu IP** | administrar |
| HTTP | 80 | 0.0.0.0/0 | frontend |
| TCP | 3000 | 0.0.0.0/0 | gateway (Socket.io) |
| TCP | 5000 | 0.0.0.0/0 | login (Auth REST) |
| TCP | 5001-5003 | 0.0.0.0/0 | sinalização WebRTC dos engines |
| TCP | 8000 | 0.0.0.0/0 | leitura do ranking (Score) |
| UDP | 20001-20030 | 0.0.0.0/0 | mídia WebRTC dos engines |

> Abrir essas portas públicas em todas as máquinas é inofensivo: onde não há
> serviço escutando, a porta simplesmente não responde. **Não** exponha 5432
> (Postgres), 6379 (Redis), 9092 (Kafka) nem 5005 (gRPC) à internet — eles ficam
> só na malha interna (regra 1).

### Opção B — restritiva (least-privilege, melhor para a nota)

Um SG por serviço, abrindo cada porta **apenas** para a origem que a usa:

| EC2 | Inbound | Origem |
|---|---|---|
| postgres | 5432 | SG do auth, do score e da réplica |
| redis | 6379 | SG do score |
| kafka | 9092 | SG dos 3 engines e do score |
| auth | 5000 (0.0.0.0/0) · 5005 | 5005 só do SG do gateway |
| engine-jogoN | 400N (SG do gateway) · 500N e UDP 20001-20030 (0.0.0.0/0) | — |
| gateway | 3000 | 0.0.0.0/0 |
| score | 8000 | 0.0.0.0/0 |
| frontend | 80 | 0.0.0.0/0 |
| todas | 22 | seu IP |

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
- **Kafka não conecta:** confira `advertised.listeners` (= IP **privado** da EC2 do Kafka) e o SG liberando 9092 para os engines/score. Logs do engine: `journalctl -u spaceship-engine-jogo2 | grep -i kafka` → `produtor conectado`.
- **Ranking vazio:** só partidas **novas** contam; reabra a tela "Ranking Global". Veja `journalctl -u spaceship-score -f` ao encerrar uma partida.
- **CORS no console do navegador:** o Score libera `*`; confira o `SCORE_HOST` no `config.js` gerado (`cat /var/www/html/config.js` na EC2 do frontend).
- **WebRTC não abre (NAT):** é o ponto avançado do item 2. A faixa UDP precisa estar aberta no SG do engine; mesmo sem WebRTC, o jogo roda via **Socket.io** (fallback). Medir a latência WebRTC×WS fica como validação opcional.

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
