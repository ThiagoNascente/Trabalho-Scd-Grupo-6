# deploy/aws — scripts de deploy NATIVO na AWS (sem Docker)

Um script `.sh` por serviço, para o cenário **1 serviço por EC2** (item 3). Cada
script é **idempotente**, instala a dependência nativa, registra o serviço no
**systemd** (sobe no boot e reinicia se cair) e usa a configuração de
`env.aws`.

> O **passo a passo completo** (abrir as EC2, Security Groups, ordem de subida e
> como testar) está em **[../../Docs/v2/Guia de Deploy AWS.md](../../Docs/v2/Guia%20de%20Deploy%20AWS.md)**.
> O Docker (`docker-compose.yml`) é **só para teste local** — não use na AWS.

## Uso (em cada EC2)

```bash
# 1) clonar o repo e preparar a config (uma vez por máquina)
git clone <repo> && cd Trabalho-Scd-Grupo-6
cp deploy/aws/env.aws.example deploy/aws/env.aws
nano deploy/aws/env.aws          # preencher segredos + IPs privados/públicos

# 2) rodar o script do serviço daquela máquina (com sudo)
sudo bash deploy/aws/postgres.sh primary     # EC2 do banco
sudo bash deploy/aws/redis.sh                # EC2 do Redis
sudo bash deploy/aws/kafka.sh                # EC2 do Kafka
sudo bash deploy/aws/auth.sh                 # EC2 do Auth (REST + gRPC)
sudo bash deploy/aws/engine.sh jogo1         # EC2 do engine do Jogo 1
sudo bash deploy/aws/engine.sh jogo2         # EC2 do engine do Jogo 2
sudo bash deploy/aws/engine.sh jogo3         # EC2 do engine do Jogo 3
sudo bash deploy/aws/gateway.sh              # EC2 do gateway
sudo bash deploy/aws/score.sh                # EC2 do score
sudo bash deploy/aws/frontend.sh             # EC2 do frontend (gera o config.js público)
# opcional (item 10): réplica de leitura do Postgres, em outra EC2
sudo bash deploy/aws/postgres.sh replica
```

| Script | Serviço | Porta(s) | Acesso |
|---|---|---|---|
| `postgres.sh` | PostgreSQL (primário/réplica) | 5432 | privado |
| `redis.sh` | Redis | 6379 | privado |
| `kafka.sh` | Kafka (KRaft) | 9092 (+9093 controller) | privado |
| `auth.sh` | Auth (C#) | 5000 REST + 5005 gRPC | REST público, gRPC privado |
| `engine.sh jogoN` | Game Engine | 400N + 500N (WebRTC) + UDP | público (WebRTC direto) |
| `gateway.sh` | Gateway (Node) | 3000 | público |
| `score.sh` | Score (Python) | 8000 | público (leitura do ranking) |
| `frontend.sh` | Frontend (Nginx) | 80 | público |

Operação: `sudo systemctl status spaceship-<svc>` · logs `sudo journalctl -u spaceship-<svc> -f`.
