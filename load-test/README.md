# Clientes simulados / Harness de concorrência (requisito 4.2)

Bots que **simulam jogadores reais** para exercitar o sistema sistematicamente:
autenticam no Auth (REST, igual ao navegador), conectam no **Gateway** por
Socket.io (passando pelo relay e pelos 3 Game Engines) e jogam os 3 minigames
de forma automática, em **paralelo**. Ao final imprimem um relatório de carga.

Atende ao requisito **4.2** (implementação + clientes simulados para demonstrar o
uso) e dá base ao **4.3** (cenário de demonstração). Também exercita as
características de **concorrência** (1.3/1.4) e permite demonstrar **tolerância a
falha / particionamento funcional** (1.6) derrubando um engine.

## Pré-requisitos

A stack precisa estar no ar (Auth + Gateway + 3 Engines). **Atalho (sem Docker):**
na raiz do projeto, `./dev-stack.sh start` sobe tudo e `./dev-stack.sh stop`
derruba. Para subir na mão, ver o resumo abaixo (ou a seção **5 — Testar
localmente** do [README na raiz](../README.md)):

```bash
# Auth (lite) :5000
JWT_SECRET=$SEGREDO AUTH_PORT=5000 node auth-service-lite/server.js
# Engines :4001/:4002/:4003  (o mesmo $SEGREDO em todos)
GAME=jogo1 PORT=4001 JWT_SECRET=$SEGREDO AUTH_API_URL=http://localhost:5000/api/auth node game-engine/server.js
GAME=jogo2 PORT=4002 JWT_SECRET=$SEGREDO node game-engine/server.js
GAME=jogo3 PORT=4003 JWT_SECRET=$SEGREDO node game-engine/server.js
# Gateway relay :3000
JWT_SECRET=$SEGREDO ENGINE1_URL=http://localhost:4001 ENGINE2_URL=http://localhost:4002 ENGINE3_URL=http://localhost:4003 node game-gateway/index.js
```

No compose/AWS, aponte `--gateway`/`--auth` para os endereços públicos.

## Uso

```bash
cd load-test && npm install

# 8 bots, mix dos 3 jogos (default)
node run.js

# variações
node run.js --bots=16 --game=mix
node run.js --bots=4  --game=jogo2
node run.js --bots=8  --game=jogo1 --rounds=3
node run.js --gateway=http://SEU_LB:3000 --auth=http://SEU_LB:5000/api/auth
```

Flags: `--bots`, `--game` (`mix|jogo1|jogo2|jogo3`), `--rounds`,
`--gateway`, `--auth`, `--match-timeout`, `--start-timeout`, `--connect-timeout`.
Equivalentes por env: `GATEWAY_URL`, `AUTH_API_URL`, `BOTS`.

No `mix`, cada grupo de 4 bots vira **1 duelo (jogo1) + 1 jogo2 + 1 jogo3**
rodando em paralelo. Os usuários vêm de `test-data/seed-users.json` (req. 4.8);
se pedir mais bots que usuários, o harness sintetiza `carga_NNN` (registro
idempotente).

## O que o relatório mostra

- **Conexões:** sucesso/falha + latência de conexão (média/p95).
- **Partidas:** iniciadas/concluídas/timeout, por minigame, e o **pico de
  partidas simultâneas** (concorrência real exercitada).
- **Throughput:** inputs enviados e mensagens de estado recebidas (e taxa/s).
- **Latências:** tempo até o 1º estado e duração das partidas.
- **Erros:** categorizados (ex.: `jogoX:create-timeout`).

> O tempo até o 1º estado inclui a contagem regressiva de 3s do Jogo 1 (duelo) —
> por isso a média fica na casa dos segundos quando há jogo1 no mix.

## Demonstração de tolerância a falha (particionamento funcional — 1.6)

Os engines são processos independentes (1 por jogo). Com a stack no ar:

```bash
# derruba só o engine do Jogo 1
fuser -k 4001/tcp

node run.js --bots=2 --game=jogo3   # jogo3 continua CONCLUINDO (isolado)
node run.js --bots=2 --game=jogo1   # jogo1 degrada: erro jogo1:create-timeout, sem crash
```

Derrubar um engine **não afeta** os demais jogos — evidência de
*Particionamento Funcional* pedido na arquitetura.

## Seed avulso

Para apenas registrar os usuários de teste (sem jogar):

```bash
AUTH_API_URL=http://localhost:5000/api/auth node seed.js
```
