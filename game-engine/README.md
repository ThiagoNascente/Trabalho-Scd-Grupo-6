# Game Engine

Processo independente que roda a **física de um** dos jogos do Spaceship. A mesma
imagem serve os três: a variável de ambiente `GAME` (`jogo1` | `jogo2` | `jogo3`)
escolhe qual módulo de [`games/`](games/) é carregado. Rodar um engine por jogo
concretiza o **Particionamento Funcional** (derrubar um engine não afeta os demais).

## Transporte

- **Socket.io** (porta `PORT`, padrão 4001/4002/4003): todo o tráfego do engine
  chega/sai pelo **Game Gateway (relay)** — lobby, controle, **inputs** e **estado
  por tick**. O cliente **não fala direto** com o engine; quem conecta é o gateway.
  Na AWS essa porta fica na **rede interna** (só o gateway a alcança).

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GAME` | sim | `jogo1` \| `jogo2` \| `jogo3` |
| `JWT_SECRET` | sim | Segredo HMAC do JWT (igual ao Auth/Gateway) |
| `PORT` | não | Porta Socket.io (padrão por jogo: 4001/4002/4003) |
| `AUTH_API_URL` | só `jogo1` | Endpoint do Auth para gravar vitórias (Wins) |
| `KAFKA_BROKER` | não | Broker(s) Kafka p/ publicar `match-completed`; vazio = publicação desativada |
| `MATCH_TOPIC` | não | Tópico Kafka (padrão `match-completed`) |

## Execução local (sem Docker)

```bash
GAME=jogo1 PORT=4001 JWT_SECRET=... AUTH_API_URL=http://localhost:5000/api/auth node server.js
GAME=jogo2 PORT=4002 JWT_SECRET=... node server.js
GAME=jogo3 PORT=4003 JWT_SECRET=... node server.js
```

> Identidade do jogador: o engine usa o `playerId` repassado pelo gateway (o
> `socket.id` do cliente no gateway), de modo que o estado do jogo casa com o id
> que o cliente conhece.
