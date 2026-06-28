# Roteiro de Apresentação — Spaceship (SCD 2026.1)

Tópicos e pontos de fala para a apresentação do grupo. **Os slides serão feitos à
parte (Google Slides);** este documento é o **roteiro** — o que dizer em cada parte.
Reflete o estado final do projeto (canal de jogo em **WebSocket/Socket.io**, sem
WebRTC). Fontes para aprofundar: [README](../../README.md) e
[Docs/Arquitetura](../Arquitetura/).

> **Sugestão de divisão (4 integrantes, todos participam — req. 4.9):**
> A → Moisés · B → Thiago · C → Ana Liz · D → Vinícius (ajuste como preferirem).
> Tempo-alvo: ~12–15 min + demo ao vivo.

---

## A. O projeto: o que é, estratégias e os jogos

**Ideia central (1 frase):** uma plataforma web de **3 minijogos de naves
multiplayer em tempo real**, feita para **demonstrar na prática** software
concorrente e distribuído (microsserviços, eventos, servidor autoritativo).

**Estratégias do grupo (o "como pensamos"):**
- **Servidor autoritativo:** o cliente só envia inputs e desenha; toda física,
  colisão e pontuação rodam no servidor (anti-trapaça e estado consistente).
- **Um jogo = um motivo para distribuir:** 3 jogos viraram **3 serviços
  independentes** → desculpa natural para particionamento funcional, isolamento
  de falha e escala.
- **Cada requisito de SCD vira uma peça real:** gRPC (síncrono), Kafka
  (assíncrono/pub-sub), Redis (cache), PostgreSQL particionado + réplica.
- **Nada chumbado:** configuração por `.env`/`env.aws`/`config.js` → mesmo código
  do localhost à AWS.

**Os 3 jogos (objetivo, jogadores, inimigos, modo):**

| Jogo | Modo | Jogadores | Inimigos | Objetivo |
|---|---|---|---|---|
| **1 — Duelo** | PvP competitivo | exatamente **2** | — (é PvP) | Abrir **2 pontos de vantagem** (placar acumulativo). |
| **2 — Chuva de Asteroides** | Survival cooperativo | **1 a 4** | asteroides (procedurais, dificuldade crescente) | Sobreviver e destruir asteroides (1 pt cada). |
| **3 — Invasão Alienígena** | Cooperativo + boss | **1 a 4** | Caçador (10), Destruidor (50), boss Leviatã (500) | Sobreviver às ondas e **derrotar o boss**. |

**Universal:** controles ← → / A D + **Espaço** (atirar); **1 HP** (um acerto é
fatal); **ranking global** por minijogo. *(Mostrar 1 print/GIF de cada jogo.)*

---

## B. Arquitetura distribuída: camadas, paradigmas e funções

**Mostrar o diagrama** ([Docs/Arquitetura/Arquitetura_code.md](../Arquitetura/Arquitetura_code.md))
e percorrer as camadas:

1. **Cliente (navegador):** HTML5 Canvas + JS. Renderiza e captura inputs.
2. **Borda pública (`spaceship-app`):**
   - **Auth (C# / ASP.NET Core):** contas, BCrypt, JWT, PostgreSQL.
   - **Gateway (Node.js):** autentica, lobby/matchmaking e **relay** (Socket.io).
   - **Score (Python/Flask):** expõe o ranking (REST).
3. **Motores de jogo (Node.js ×3, EC2 dedicada):** loop de física a 60 Hz,
   colisões e pontuação — **isolados** por jogo.
4. **Dados/eventos:** **Kafka** (barramento), **Redis** (ranking), **PostgreSQL**
   (primário + réplica; tabela `scores` particionada).

**Os 3 paradigmas de comunicação (o coração da matéria) — quem fala com quem:**
- **Cliente-Servidor:** REST/HTTP (login, ranking) + **WebSocket/Socket.io** (lobby
  e jogo em tempo real). O cliente fala **só com o gateway**; o gateway faz **relay**
  para o engine da sala (inputs → engine; estado por tick → cliente).
- **RPC síncrono (gRPC):** ao conectar, o gateway valida a sessão chamando o Auth
  por gRPC **bloqueante** (assinatura + existência do usuário = revogação); com
  fallback local para não travar.
- **Publish-Subscribe / Messaging (Kafka):** ao fim da partida, o engine **publica**
  `match-completed`; o Score **consome** no seu ritmo e materializa o ranking. O
  engine não conhece o Score (**desacoplamento**).

**Frase de efeito:** "três linguagens (C#, JS, Python), três paradigmas, um fluxo
que vai do input do teclado até o ranking global — passando por gRPC e Kafka."

---

## C. Distribuição e concorrência: mecanismos + justificativa da especificação

**Mostrar a tabela** (espelha o **Checklist** no [README §8](../../README.md#8-checklist-da-especificação)).
Para cada característica obrigatória, **apontar o mecanismo concreto:**

| Requisito da especificação | Como o Spaceship cumpre |
|---|---|
| Múltiplos clientes na Internet | Deploy AWS em 6 EC2; borda pública na `spaceship-app`. |
| Integração/coordenação de componentes | 8 serviços coordenados; fluxo `engine→Kafka→Score→Redis/PG→API→tela`. |
| Acessos concorrentes a dados compartilhados | Estado de sala compartilhado entre jogadores; escritas/leituras concorrentes no PG. |
| Processamento no servidor concorrente | Loop autoritativo 60 Hz por sala; várias partidas em paralelo. |
| **Interação síncrona e assíncrona** | **gRPC** (síncrono) + **Kafka** (assíncrono) + REST + WebSocket. |
| **Replicação e particionamento** | **Funcional** (3 engines isolados) + **de dados** (`scores` `PARTITION BY LIST`) + **réplica** PostgreSQL. |
| Consistência e disponibilidade | Consistência eventual (Kafka retém; commit após persistir) + réplica de leitura. |
| Mais de uma linguagem | **C# + JavaScript + Python**. |
| Cliente-servidor / pub-sub / messaging | REST+WebSocket / Kafka / Kafka. |

**Concorrência (destaque):** o servidor processa N partidas ao mesmo tempo
(`setInterval` por sala no event loop do Node) **enquanto** atende os inputs dos
clientes — e o **particionamento funcional** garante que derrubar o engine de um
jogo **não afeta** os outros (demo no tópico D).

**Justificativa (fechamento):** "cada item obrigatório da especificação tem um
componente real por trás — não é teoria: é gRPC validando sessão, Kafka
transportando o fim de partida, PostgreSQL particionado e replicado."

---

## D. Documentação, estrutura e demonstração de deploy

**Documentação (mostrar rapidamente):**
- **[README](../../README.md)** — fonte única: visão geral, guia local, guia AWS,
  configuração de ambiente, justificativa e checklist.
- **[Docs/Arquitetura](../Arquitetura/)** — diagrama + descrição detalhada.
- **[GDD](../GameDesignDocument.md)** — regras dos jogos. Por serviço: READMEs em
  `score-service/`, `game-engine/`, `load-test/`, `test-data/`.

**Estrutura do projeto (1 slide com a árvore):** `frontend/` · `auth-service/`
(C#) · `game-gateway/` · `game-engine/` (×3 por `GAME`) · `score-service/` (Python)
· `deploy/aws/` · `load-test/` · `test-data/` · `docker-compose.yml`.

**Deploy — como é configurado (nada chumbado):**
- **Local:** `docker-compose` + `.env` (1 comando sobe tudo).
- **AWS:** 6 EC2, **sem Docker e sem ALB**; `deploy1.sh`…`deploy6.sh` (systemd);
  `env.aws` define segredos e IPs; o `deploy3` **gera** o `config.js` do frontend.

**Quem conversa com quem (repetir o fluxo, agora no contexto de deploy):**
- Navegador → **`spaceship-app`** (Auth :5000, Gateway :3000, Score :8000, site :80) — **únicas portas públicas**.
- Gateway → **engines** (`:4001/4002/4003`) e Auth gRPC (`:5005`) — **rede interna**.
- Engines → **Kafka** (`data2`); Score → **Redis** + **PostgreSQL** (`data1`); PG **primário → réplica**.
- **Segurança:** só 5 portas públicas; banco, Redis, Kafka, gRPC e engines ficam **fechados para a internet** (malha interna da VPC).

**Demonstração ao vivo sugerida (roteiro):**
1. Abrir o jogo, registrar/login, jogar os 3 minijogos (2 pessoas no Duelo).
2. Abrir o **Ranking Global** (mostra o pipeline Kafka→Score→Redis funcionando).
3. **Isolamento de falha:** derrubar o engine do Jogo 1
   (`systemctl stop spaceship-engine-jogo1`) e mostrar Jogos 2 e 3 **seguindo normais**.
4. (Se der tempo) **revogação via gRPC:** apagar um usuário no PG e mostrar a
   reconexão sendo recusada.

**Encerramento:** recapitular que os 3 paradigmas + concorrência + distribuição
estão todos exercitados e demonstráveis ao vivo.
