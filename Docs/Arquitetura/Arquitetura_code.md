# Arquitetura do Spaceship (diagrama)

Diagrama dos serviços e dos **três paradigmas de comunicação** (cliente-servidor,
RPC síncrono e pub-sub/messaging). O agrupamento em caixas reflete a topologia real
do deploy AWS (6 EC2, **sem Kubernetes e sem ALB**); o detalhe de cada serviço está
em [descrição da arquitetura.md](descri%C3%A7%C3%A3o%20da%20arquitetura.md) e o passo a
passo de execução no [README na raiz](../../README.md).

```mermaid
flowchart TD
    subgraph Clientes [Ambiente do Cliente - Navegador]
        N1[Cliente Web A<br/>Canvas API / JS]
        N2[Cliente Web B<br/>Canvas API / JS]
    end

    subgraph Infra_AWS [Nuvem AWS - serviços nativos em EC2, sem Kubernetes e sem ALB]

        subgraph MS_App [EC2 spaceship-app - borda pública]
            Auth[Auth Service<br/>ASP.NET Core / C#]
            Gateway[Game Gateway / Lobby<br/>Node.js - Socket.io relay]
            Score[Score Service<br/>Python / Flask]
        end

        subgraph MS_Engine [1 EC2 por jogo - Motores de Jogo - rede interna]
            EngineA[Engine Jogo 1<br/>Node.js]
            EngineB[Engine Jogo 2<br/>Node.js]
            EngineC[Engine Jogo 3<br/>Node.js]
        end

        subgraph MS_Data1 [EC2 spaceship-data1]
            DB[(PostgreSQL primário<br/>Users + scores particionada)]
            Cache[(Redis<br/>Leaderboard)]
        end

        subgraph MS_Data2 [EC2 spaceship-data2]
            Broker{Apache Kafka<br/>tópico match-completed}
            DBR[(PostgreSQL réplica<br/>somente leitura)]
        end
    end

    %% (1-2) Cliente-Servidor REST: ações de ciclo curto
    N1 -->|1. REST HTTP: login / registro| Auth
    N2 -->|1. REST HTTP: login / registro| Auth
    N1 -->|2. REST HTTP: leaderboard| Score
    N2 -->|2. REST HTTP: leaderboard| Score

    %% (3) Cliente-Servidor WebSocket: lobby + jogo em tempo real (só com o gateway)
    N1 <-->|3. WebSocket Socket.io<br/>lobby + inputs/estado| Gateway
    N2 <-->|3. WebSocket Socket.io<br/>lobby + inputs/estado| Gateway

    %% (4) RPC SÍNCRONO: validação de sessão na conexão
    Gateway <-->|4. Valida JWT - gRPC síncrono| Auth
    Auth -->|escrita/leitura| DB

    %% (5) RELAY: o gateway repassa inputs/estado ao engine dono da sala (rede interna)
    Gateway <-->|5. Relay Socket.io<br/>inputs/estado| EngineA
    Gateway <-->|5. Relay Socket.io<br/>inputs/estado| EngineB
    Gateway <-->|5. Relay Socket.io<br/>inputs/estado| EngineC

    %% (6-9) PUB-SUB / MESSAGING assíncrono: fim de partida -> ranking
    EngineA -->|6. Publica match-completed| Broker
    EngineB -->|6. Publica match-completed| Broker
    EngineC -->|6. Publica match-completed| Broker
    Broker -->|7. Consome assíncrono| Score
    Score -->|8. Atualiza ranking| Cache
    Score -.->|9. Persiste histórico| DB
    DB -.->|replicação em streaming| DBR
```

## Legenda dos fluxos

| # | Origem → Destino | Protocolo / paradigma | Para quê |
|---|---|---|---|
| 1 | Navegador → Auth | REST/HTTP (cliente-servidor, síncrono) | Login e registro |
| 2 | Navegador → Score | REST/HTTP (cliente-servidor, síncrono) | Ler o ranking global |
| 3 | Navegador ↔ Gateway | WebSocket / Socket.io (cliente-servidor) | Lobby e **jogo em tempo real** (inputs + estado por tick) |
| 4 | Gateway ↔ Auth | **gRPC síncrono** (bloqueante) | Validar a sessão (JWT + revogação) na conexão |
| 5 | Gateway ↔ Engines | Socket.io (**relay**, rede interna) | Repassar inputs ao engine da sala e o estado de volta |
| 6 | Engines → Kafka | **Publish** (assíncrono) | Publicar `match-completed` ao fim da partida |
| 7 | Kafka → Score | **Subscribe / messaging** (assíncrono) | Consumir o resultado e materializar o ranking |
| 8 | Score → Redis | comando | Ranking por minijogo (sorted set) |
| 9 | Score → PostgreSQL | persistência | Histórico (`scores` particionada por minijogo) |

> **Sem WebRTC e sem ALB.** O canal de jogo em tempo real é **WebSocket (Socket.io)**:
> o cliente fala **só com o gateway**, que faz **relay** para o engine dono da sala
> (cada jogo no seu processo/EC2 = **particionamento funcional**). O balanceamento das
> partidas é o **matchmaking do gateway** (escolhe o engine por jogo), não um load balancer.
