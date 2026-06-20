# Dados de teste versionados (requisito 4.8)

Conjunto de dados de teste **versionado** para exercitar e validar o sistema de
forma reprodutível, conforme o requisito **4.8** da especificação. Cobre dois
usos complementares:

| Arquivo | Para que serve | Quem consome |
|---|---|---|
| `seed-users.json` | Usuários de teste (login/senha) para os **clientes simulados** | `load-test/` (harness de bots) e `load-test/seed.js` |
| `sample-match-events.json` | Fixture determinístico de eventos `match-completed` (payload do Kafka) | `score-service/selftest_dataset.py` |
| `expected-rankings.json` | Oráculo: ranking esperado após aplicar o fixture | `score-service/selftest_dataset.py` |

Todos os usuários respeitam a regra **4–30 caracteres** do auth canônico
(itens 9.1/9.2), então o mesmo arquivo serve para o `auth-service` (C#) e para o
`auth-service-lite` (Node).

## 1. Usuários seed (`seed-users.json`)

12 pilotos com a mesma senha padrão (`orbita-2026`). O harness de carga registra
(idempotente — ignora "já existe") e autentica cada um antes de jogar. Para
semear sem rodar o harness:

```bash
# precisa do Auth no ar (lite na :5000 ou o C# no compose)
AUTH_API_URL=http://localhost:5000/api/auth node load-test/seed.js
```

## 2. Fixture de ranking (`sample-match-events.json` + `expected-rankings.json`)

Os eventos reproduzem exatamente o payload que cada **Game Engine** publica no
Kafka ao fim da partida (`{ game, finishedAt, players:[{username, score, won}] }`)
e exercitam as duas políticas de ranking do Score Service:

- **jogo1 (PvP/Duelo):** ranking = total de **vitórias** (`ZINCRBY`; só o vencedor pontua).
- **jogo2 / jogo3 (cooperativo):** ranking = **melhor pontuação** (`ZADD GT`; mantém o máximo).

O `expected-rankings.json` é o resultado esperado de aplicar **todos** os eventos.
A validação roda **offline** (sem Kafka/Redis/PostgreSQL), pela função pura
`store.leaderboard_ops`:

```bash
cd score-service && python selftest_dataset.py
```

Saída esperada: `SELFTEST DATASET OK`.

## Versionamento

Cada arquivo tem um campo `version`. Ao mudar o fixture, incremente a versão e
atualize o `expected-rankings.json` correspondente (o selftest é o guardião).
