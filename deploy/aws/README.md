# deploy/aws — scripts de deploy NATIVO na AWS (sem Docker)

Deploy distribuído **condensado em 6 máquinas** (item 3). Você roda **um script
por máquina** — `deploy1.sh` … `deploy6.sh`. Cada um é **idempotente**, chama as
peças por serviço de [`lib/`](lib/) (que instalam a dependência nativa e registram
o serviço no **systemd** — sobe no boot e reinicia se cair) e usa a configuração de
`env.aws`.

> O **passo a passo completo** (abrir as EC2, Security Groups, ordem de subida e
> como testar) está na seção **6 — "Testar na AWS"** do
> **[README na raiz do projeto](../../README.md)**.
> O Docker (`docker-compose.yml`) é **só para teste local** — não use na AWS.

## ⚡ Jeito RÁPIDO: deploy das 6 a partir de UMA máquina (`deploy-all.sh`)

Em vez de entrar em cada uma das 6 EC2 e repetir os passos à mão, você sobe **uma
7ª EC2 (a "orquestradora")** que faz tudo sozinha: conecta nas 6 por SSH, descobre
os IPs/DNS, **gera o `env.aws`**, manda o código e **roda o `deployN.sh` certo em
cada máquina, na ordem certa**. Re-deploy depois vira **um comando só**.

### Preparar a 7ª máquina (uma vez)

1. Abra **mais uma EC2 Ubuntu** (uma `t3.small` basta — ela só orquestra, não roda
   serviço). **O ideal é colocá-la no mesmo Security Group `spaceship-sg`**: assim a
   *Regra 1* (todo o tráfego do próprio SG) já libera o SSH dela para as 6 **pelo IP
   privado** — você **não abre porta nenhuma nova**.
2. Nela: instale o necessário e traga o repositório e a chave `.pem` das EC2:
   ```bash
   sudo apt-get update -y && sudo apt-get install -y git rsync openssh-client openssl
   git clone <URL_DO_REPO> && cd Trabalho-Scd-Grupo-6
   # copie a sua chave .pem para esta máquina (do seu PC), o nome deve ser spaceship-key.pem
   chmod 600 spaceship-key.pem
   ```

### Rodar o deploy

```bash
cp deploy/aws/maquinas.aws.example deploy/aws/maquinas.aws
nano deploy/aws/maquinas.aws      # preencha SÓ o *_SSH de cada máquina (e SSH_KEY)
bash deploy/aws/deploy-all.sh
```

No `maquinas.aws` você quase não preenche nada — só **como conectar** em cada EC2
(`*_SSH`) e o caminho da chave (`SSH_KEY`). O **IP privado** e o **DNS público** de
cada máquina o script **descobre sozinho** (perguntando à própria EC2 via metadata),
então isso **sobrevive à troca do DNS público** quando você desliga/religa as EC2 —
é só rodar de novo. Os **segredos** (`JWT_SECRET`, senhas) são **gerados na 1ª vez** e
**reaproveitados** nas próximas (ficam no `env.aws`, que não vai para o Git).

Como preencher `*_SSH`:
- **7ª máquina no `spaceship-sg` (recomendado):** use o **IP privado** de cada EC2.
- **7ª máquina fora (seu PC):** use o **DNS público** de cada EC2 e libere a porta 22
  (SSH) vinda do IP dela no Security Group.

### Opções úteis

| Comando | Para quê |
|---|---|
| `bash deploy/aws/deploy-all.sh --dry-run` | só mostra o plano e os endereços descobertos; **não altera nada** |
| `bash deploy/aws/deploy-all.sh --yes` | não pergunta "continuar?" (bom para automatizar) |
| `bash deploy/aws/deploy-all.sh --roles=engine2` | re-deploya **só** uma máquina (ex.: mudou o código de um engine) — as outras já no ar |
| `bash deploy/aws/deploy-all.sh --skip-sync` | não reenvia o código; só regenera o `env.aws` e roda os deploys |

**O que ele faz, na ordem:** `data1 → data2 → app` em **série** (a réplica do Postgres
depende do primário; o app depende de Postgres/Redis/Kafka) e os **3 engines em
paralelo** (são isolados — ganho de tempo). No fim, faz um **smoke test** e imprime o
link do jogo. Logs por máquina ficam em `deploy/aws/.deploy-logs/`. É **idempotente**:
pode rodar quantas vezes quiser. Por baixo, ele usa **exatamente** os mesmos
`deploy1.sh … deploy6.sh` abaixo — só automatiza o trabalho manual.

## Estrutura

- **`deploy-all.sh`** — o **orquestrador** (jeito rápido): roda na 7ª máquina e faz o
  deploy das 6 sozinho. Usa os `deployN.sh` por baixo.
- **`maquinas.aws.example`** — modelo do **inventário** do `deploy-all.sh` (a lista das
  6 EC2); copie para `maquinas.aws` e preencha os `*_SSH`.
- **`deploy1.sh` … `deploy6.sh`** — o que **você roda** (um por EC2), no jeito manual.
- **`lib/`** — as peças por serviço (`postgres.sh`, `redis.sh`, `kafka.sh`,
  `auth.sh`, `engine.sh`, `gateway.sh`, `score.sh`, `frontend.sh`) que os
  `deployN.sh` chamam. Não precisa rodá-las à mão.
- **`common.sh`** — funções/variáveis compartilhadas (sourced pelos scripts).
- **`env.aws.example`** — modelo de config; o `deploy-all.sh` **gera** o `env.aws`
  sozinho. No jeito manual, copie para `env.aws` e preencha.

## Uso MANUAL (em cada EC2) — alternativa ao `deploy-all.sh`

```bash
# 1) clonar o repo e preparar a config (uma vez por máquina)
git clone <repo> && cd Trabalho-Scd-Grupo-6
cp deploy/aws/env.aws.example deploy/aws/env.aws
nano deploy/aws/env.aws          # segredos + IPs/DNS das 6 EC2 (o cabeçalho traz o mapa)

# 2) rodar, EM CADA MÁQUINA, o deployN.sh dela — nesta ordem:
sudo bash deploy/aws/deploy1.sh   # na spaceship-data1  (PRIMEIRO)
sudo bash deploy/aws/deploy2.sh   # na spaceship-data2  (depois do deploy1)
sudo bash deploy/aws/deploy3.sh   # na spaceship-app
sudo bash deploy/aws/deploy4.sh   # na spaceship-engine1
sudo bash deploy/aws/deploy5.sh   # na spaceship-engine2
sudo bash deploy/aws/deploy6.sh   # na spaceship-engine3
```

| Script | Máquina (tag Name) | Serviços | Porta(s) |
|---|---|---|---|
| `deploy1.sh` | `spaceship-data1` | PostgreSQL **primário** + Redis | 5432 · 6379 |
| `deploy2.sh` | `spaceship-data2` | Kafka + PostgreSQL **réplica** (item 10) | 9092 (+9093) · 5432 |
| `deploy3.sh` | `spaceship-app` | Auth (REST+gRPC) + Gateway + Score + Frontend | 5000+5005 · 3000 · 8000 · 80 |
| `deploy4.sh` | `spaceship-engine1` | Game Engine `jogo1` | 4001 (interno) |
| `deploy5.sh` | `spaceship-engine2` | Game Engine `jogo2` | 4002 (interno) |
| `deploy6.sh` | `spaceship-engine3` | Game Engine `jogo3` | 4003 (interno) |

**Por que 6 (e não 10):** a conta AWS limita a 9 instâncias simultâneas. Condensamos
serviços que não competem por porta, **mantendo separados** o que mais importa em
SD: o **primário × réplica** do PostgreSQL (`deploy1` × `deploy2`, item 10) e os **3
engines isolados** (`deploy4/5/6`, particionamento funcional).

Operação: `sudo systemctl status spaceship-<svc>` · logs `sudo journalctl -u spaceship-<svc> -f`
(o Postgres e o Redis usam os nomes nativos `postgresql` e `redis-server`).
