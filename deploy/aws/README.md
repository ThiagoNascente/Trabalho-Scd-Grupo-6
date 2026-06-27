# deploy/aws — scripts de deploy NATIVO na AWS (sem Docker)

Deploy distribuído **condensado em 6 máquinas** (item 3). Você roda **um script
por máquina** — `deploy1.sh` … `deploy6.sh`. Cada um é **idempotente**, chama as
peças por serviço de [`lib/`](lib/) (que instalam a dependência nativa e registram
o serviço no **systemd** — sobe no boot e reinicia se cair) e usa a configuração de
`env.aws`.

> O **passo a passo completo** (abrir as EC2, Security Groups, ordem de subida e
> como testar) está em **[../../Docs/v2/Guia de Deploy AWS.md](../../Docs/v2/Guia%20de%20Deploy%20AWS.md)**.
> O Docker (`docker-compose.yml`) é **só para teste local** — não use na AWS.

## Estrutura

- **`deploy1.sh` … `deploy6.sh`** — o que **você roda** (um por EC2).
- **`lib/`** — as peças por serviço (`postgres.sh`, `redis.sh`, `kafka.sh`,
  `auth.sh`, `engine.sh`, `gateway.sh`, `score.sh`, `frontend.sh`) que os
  `deployN.sh` chamam. Não precisa rodá-las à mão.
- **`common.sh`** — funções/variáveis compartilhadas (sourced pelos scripts).
- **`env.aws.example`** — modelo de config; copie para `env.aws` e preencha.

## Uso (em cada EC2)

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
| `deploy4.sh` | `spaceship-engine1` | Game Engine `jogo1` | 4001 + 5001 + UDP 20001-20030 |
| `deploy5.sh` | `spaceship-engine2` | Game Engine `jogo2` | 4002 + 5002 + UDP 20001-20030 |
| `deploy6.sh` | `spaceship-engine3` | Game Engine `jogo3` | 4003 + 5003 + UDP 20001-20030 |

**Por que 6 (e não 10):** a conta AWS limita a 9 instâncias simultâneas. Condensamos
serviços que não competem por porta, **mantendo separados** o que mais importa em
SD: o **primário × réplica** do PostgreSQL (`deploy1` × `deploy2`, item 10) e os **3
engines isolados** (`deploy4/5/6`, particionamento funcional).

Operação: `sudo systemctl status spaceship-<svc>` · logs `sudo journalctl -u spaceship-<svc> -f`
(o Postgres e o Redis usam os nomes nativos `postgresql` e `redis-server`).
