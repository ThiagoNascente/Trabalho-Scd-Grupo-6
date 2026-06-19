# Game Engine

Processo independente que roda a **física de um** dos jogos do Spaceship. A mesma
imagem serve os três: a variável de ambiente `GAME` (`jogo1` | `jogo2` | `jogo3`)
escolhe qual módulo de [`games/`](games/) é carregado. Rodar um engine por jogo
concretiza o **Particionamento Funcional** (derrubar um engine não afeta os demais).

## Transportes

- **Socket.io** (porta `PORT`, padrão 4001/4002/4003): recebe os eventos vindos do
  **Game Gateway (relay)** — lobby, controle e *fallback* do hot path.
- **WebRTC DataChannel** via [geckos.io](https://github.com/geckosio/geckos.io)
  (sinalização em `GECKOS_PORT`, padrão `PORT+1000` = 5001/5002/5003; faixa UDP/ICE
  em `GECKOS_UDP_MIN`..`GECKOS_UDP_MAX`): canal de jogo de baixa latência (UDP),
  direto cliente↔engine, para **inputs** e **estado por tick**. Se a stack WebRTC
  falhar, o engine continua 100% funcional só pelo Socket.io.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GAME` | sim | `jogo1` \| `jogo2` \| `jogo3` |
| `JWT_SECRET` | sim | Segredo HMAC do JWT (igual ao Auth/Gateway) |
| `PORT` | não | Porta Socket.io (padrão por jogo: 4001/4002/4003) |
| `GECKOS_PORT` | não | Porta de sinalização WebRTC (padrão `PORT+1000`) |
| `GECKOS_UDP_MIN` / `GECKOS_UDP_MAX` | não | Faixa de portas UDP/ICE (abrir no Security Group/Docker na AWS) |
| `AUTH_API_URL` | só `jogo1` | Endpoint do Auth para gravar vitórias (Wins) |

## Execução local (sem Docker)

```bash
GAME=jogo1 PORT=4001 JWT_SECRET=... AUTH_API_URL=http://localhost:5000/api/auth node server.js
GAME=jogo2 PORT=4002 JWT_SECRET=... node server.js
GAME=jogo3 PORT=4003 JWT_SECRET=... node server.js
```

> Identidade do jogador: o engine usa o `playerId` repassado pelo gateway (o
> `socket.id` do cliente no gateway), de modo que o estado do jogo casa com o id
> que o cliente conhece — tanto no relay Socket.io quanto no DataChannel WebRTC.
