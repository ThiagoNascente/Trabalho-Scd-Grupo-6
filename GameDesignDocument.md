# CosmoDock

_Game Design Document — v1.0_

---

## Sumário

1. [Visão Geral](#visão-geral)
2. [Elementos de Jogo](#elementos-de-jogo)
3. [Especificações Técnicas](#especificações-técnicas)
4. [Gameplay (Conciso)](#gameplay-conciso)
5. [Escopo do Projeto](#escopo-do-projeto)
6. [Gameplay Detalhado](#gameplay-detalhado)
7. [Minigames](#minigames)
8. [Inimigos](#inimigos)
9. [Interface do Usuário (UI)](#interface-do-usuário-ui)
10. [Modelagem Geral do Jogo](#modelagem-geral-do-jogo)
11. [Design Geral](#design-geral)
12. [Assets Necessários](#assets-necessários)
13. [Arquitetura Técnica](#arquitetura-técnica)

---

## Visão Geral

**Tema:** Combate espacial cooperativo e competitivo em partidas rápidas.

**Mecânicas Base de Jogabilidade:** Navegação lateral simples com disparo de projéteis. Todos os minigames compartilham o mesmo controle fundamental:

- A nave do jogador é representada por um **triângulo**.
- Movimentação horizontal: teclas **← / →** ou **A / D**.
- Disparo de projétil: tecla **Espaço**.
- Cada jogador possui **1 ponto de HP** — um único acerto é fatal.

**Público-alvo:** Estudantes e jogadores casuais, 12+.

**Objetivo do Projeto:** Demonstrar na prática os conceitos de software concorrente e distribuído em um contexto de jogo multiplayer em tempo real, utilizando arquitetura de microsserviços orientada a eventos.

---

## Elementos de Jogo

- Três minigames independentes com dinâmicas distintas (PvP, Survival e Cooperativo).
- Partidas rápidas com início e fim claramente definidos.
- Sistema de ranking global por minigame.
- Servidor autoritativo: toda a física, colisão e pontuação são processadas no servidor.
- Matchmaking via sala de espera (lobby).

---

## Especificações Técnicas

**Visualização:** 2D, visão de cima (top-down), orientação vertical.

**Plataforma:** Web (navegador), via HTML5 Canvas API.

**Linguagens e Tecnologias do Cliente:** JavaScript (ES6+), HTML5 Canvas API, WebSockets.

**Backend:** Arquitetura de microsserviços distribuída (detalhada na seção [Arquitetura Técnica](#arquitetura-técnica)).

**Resolução Recomendada:** 1280 × 720 px ou superior.

---

## Gameplay (Conciso)

- Jogo multiplayer online em tempo real.
- Três modos de jogo selecionáveis no menu principal.
- Partidas curtas, de aprendizado imediato.
- Sem sistema de respawn — ao morrer o jogador aguarda o fim da partida.
- Resultados persistidos em leaderboard global após cada partida.

---

## Escopo do Projeto

### Equipe

Game Desing: Moisés Ferreira Protázio Bastos 
Programadores: Thiago Nascente Borges e Vinicius Silva Benevides
Testes: Ana Liz Bomfim Gomes

### Objetivo

Desenvolver um jogo multiplayer web simples e funcional que sirva como demonstração prática de uma arquitetura distribuída concorrente, contemplando comunicação síncrona (gRPC), assíncrona (Kafka), e em tempo real (WebSockets).

### Requisitos Técnicos (Cliente)

- Navegador moderno com suporte a HTML5 e WebSockets (Chrome 90+, Firefox 88+, Edge 90+).
- Conexão com a internet.
- Teclado físico (controles via teclado).

### Requisitos Técnicos (Servidor)

- Instâncias EC2 na AWS com Application Load Balancer.
- PostgreSQL para persistência de usuários e resultados.
- Redis para cache do leaderboard.
- Apache Kafka como message broker de eventos de partida.
- Serviços em C# (Auth), Node.js (Gateway e Game Engines) e Python (Score Service).

### Cronograma e Riscos

| Etapa | Descrição | Risco |
|---|---|---|
| 1 | Setup da infraestrutura AWS e Auth Service | Configuração de rede e certificados SSL |
| 2 | Game Gateway, Lobby e matchmaking | Gerenciamento de conexões simultâneas |
| 3 | Game Engine — Minigame 1 (PvP x1) | Sincronização de estado entre dois clientes |
| 4 | Game Engine — Minigame 2 (Survival) | Geração procedural de asteroides balanceada |
| 5 | Game Engine — Minigame 3 (Cooperativo + Boss) | Lógica do boss e progressão de dificuldade |
| 6 | Score Service, Kafka e Leaderboard | Consistência eventual e tolerância a falhas |
| 7 | Testes, ajuste de latência e deploy | Bugs de sincronização em alta concorrência |

---

## Gameplay Detalhado

### Fluxo Principal

1. O jogador acessa o jogo pelo navegador e realiza login ou registro.
2. Após autenticação, é exibido o **menu de seleção de minigame** com os 3 modos disponíveis.
3. O jogador seleciona um minigame e entra na **sala de espera (lobby)** correspondente.
4. Ao atingir o número mínimo de jogadores, a partida inicia automaticamente.
5. O cliente envia apenas inputs de teclado via WebSocket; o servidor processa toda a lógica.
6. Ao término da partida, o resultado é publicado no Kafka e processado pelo Score Service.
7. O jogador retorna ao menu principal e pode consultar o leaderboard.

### Controles

| Ação | Tecla |
|---|---|
| Mover para a esquerda | ← ou A |
| Mover para a direita | → ou D |
| Atirar projétil | Espaço |

### Regras Universais

- Cada jogador possui **1 HP**. Qualquer colisão com projétil inimigo ou obstáculo resulta em morte imediata.
- Não há sistema de respawn. Após morrer, o jogador observa a partida até o fim.
- Projéteis saem da ponta do triângulo (frente da nave) em linha reta.

---

## Minigames

### Minigame 1 — Duelo (PvP 1v1)

**Jogadores:** exatamente 2.

**Objetivo:** Eliminar o adversário antes de ser eliminado. O primeiro a vencer **3 rounds consecutivos** é declarado campeão da sessão.

**Dinâmica:**
- As duas naves aparecem em posições opostas na tela.
- Ambos os jogadores atiram e se esquivam simultaneamente.
- Ao ser atingido, o round termina. O sobrevivente recebe um ponto de vitória.
- O contador de vitórias consecutivas é reiniciado se o mesmo jogador perder um round.
- A partida termina quando um jogador acumula 3 vitórias consecutivas.

**Condição de Vitória:** 3 vitórias consecutivas.

---

### Minigame 2 — Chuva de Asteroides (Survival Multiplayer)

**Jogadores:** 1 a 4.

**Objetivo:** Sobreviver o maior tempo possível destruindo ou desviando dos asteroides que caem.

**Dinâmica:**
- Asteroides descem verticalmente em direção às naves dos jogadores.
- Um asteroide que toca uma nave mata o jogador instantaneamente.
- Asteroides podem ser destruídos com projéteis.
- Não há respawn — ao morrer o jogador é removido da partida.
- A partida continua enquanto **ao menos um jogador estiver vivo**.
- A dificuldade aumenta progressivamente com o tempo (velocidade e frequência dos asteroides).

**Condição de Fim:** Todos os jogadores morrem. O vencedor é o último sobrevivente (ou o que sobreviveu mais tempo).

---

### Minigame 3 — Invasão Alienígena (Cooperativo)

**Jogadores:** 1 a 4 (cooperativo).

**Objetivo:** Cooperar para sobreviver às ondas de naves inimigas e derrotar o boss final.

**Dinâmica:**
- Naves inimigas descem em ondas a partir do topo da tela.
- Os jogadores compartilham o objetivo e podem se posicionar livremente.
- A partida continua enquanto **ao menos um jogador estiver vivo**.
- Após um determinado tempo / número de ondas, o **boss** aparece.
- Derrotado o boss, a partida encerra com **vitória de todos os sobreviventes**.

**Condição de Vitória:** Derrotar o boss final.
**Condição de Derrota:** Todos os jogadores morrem antes de derrotar o boss.

---

## Inimigos

> Presentes apenas no Minigame 3.

### Inimigo Padrão — Caçador (Triângulo)

| Atributo | Valor |
|---|---|
| Forma | Triângulo (invertido) |
| HP | 1 |
| Padrão de Tiro | 1 projétil em linha reta (direção descendente) |
| Movimentação | Desce verticalmente em direção ao jogador |

### Inimigo Élite — Destruidor (Quadrado)

| Atributo | Valor |
|---|---|
| Forma | Quadrado |
| HP | 5 |
| Padrão de Tiro | 3 projéteis simultâneos: 1 reto (sul), 1 diagonal sudeste, 1 diagonal sudoeste |
| Movimentação | Desce verticalmente, velocidade levemente menor que o Caçador |

### Boss Final — Leviatã (Hexágono)

| Atributo | Valor |
|---|---|
| Forma | Hexágono |
| HP | Alto (valor a ser balanceado por testes) |
| Padrão de Tiro | A definir — projéteis em múltiplas direções |
| Aparição | Após tempo/ondas predefinidos |
| Efeito de Vitória | Derrota o Leviatã encerra o jogo com vitória dos sobreviventes |

---

## Interface do Usuário (UI)

### Tela de Login / Registro

- Campo de usuário e senha.
- Botão de entrar e de criar conta.
- Feedback de erro em caso de credenciais inválidas.

### Menu Principal

- Seleção entre os 3 minigames.
- Acesso ao Leaderboard global.
- Logout.

### HUD em Partida

- Indicador de HP do jogador (1 barra / ícone de nave).
- Identificação visual dos jogadores na tela (cores ou labels).
- No Minigame 1: placar de rounds (ex.: `Você: 2 | Adversário: 1`).
- No Minigame 2 e 3: contador de jogadores vivos.
- No Minigame 3: indicador da chegada iminente do boss (barra de progresso de onda ou timer).

### Tela de Resultado

- Exibição do vencedor / sobreviventes.
- Pontuação obtida na partida.
- Botão para retornar ao menu principal.

### Leaderboard

- Ranking global por minigame.
- Exibe nome do jogador, pontuação e data da partida.
- Atualização assíncrona via Score Service.

---

## Modelagem Geral do Jogo

- Ambiente 2D espacial, fundo estático escuro com estrelas.
- Naves dos jogadores posicionadas na parte inferior da tela.
- Inimigos e projéteis descem do topo.
- Colisões tratadas por hitbox simples (bounding box ou círculo).
- Estado do jogo transmitido do servidor ao cliente a ~60 atualizações por segundo.

---

## Design Geral

**Estética:** Minimalista, sci-fi, fundo preto com elementos geométricos simples.

### Paleta de Cores (sugestão)

| Elemento | Cor |
|---|---|
| Fundo | Preto (#0A0A0F) |
| Nave do Jogador 1 | Branco / Ciano (#00FFFF) |
| Nave do Jogador 2 | Verde (#00FF88) |
| Nave do Jogador 3 | Amarelo (#FFE600) |
| Nave do Jogador 4 | Laranja (#FF6600) |
| Inimigo Caçador | Vermelho (#FF3333) |
| Inimigo Destruidor | Roxo (#CC44FF) |
| Boss Leviatã | Vermelho escuro pulsante (#990000) |
| Projéteis do Jogador | Branco (#FFFFFF) |
| Projéteis Inimigos | Laranja (#FF8800) |
| Asteroides | Cinza (#888888) |

### Cenários por Minigame

| Minigame | Descrição Visual |
|---|---|
| Duelo | Arena simétrica, fundo estrelado estático, sem obstáculos |
| Chuva de Asteroides | Campo aberto, asteroides irregulares caindo com leve variação de tamanho |
| Invasão Alienígena | Campo aberto, ondas de inimigos em formação, boss ocupa porção central do topo ao aparecer |

---

## Assets Necessários

### Sprites (Formas Geométricas — Canvas API)

- Nave do jogador: triângulo apontado para cima (4 variações de cor).
- Projétil do jogador: círculo pequeno branco.
- Inimigo Caçador: triângulo apontado para baixo, vermelho.
- Inimigo Destruidor: quadrado, roxo.
- Boss Leviatã: hexágono, vermelho escuro com efeito visual de pulsação.
- Asteroide: polígono irregular (octógono aproximado), cinza.
- Projétil inimigo: círculo pequeno laranja.

> Todos os sprites são desenhados via Canvas API — não requerem arquivos de imagem externos.

### Efeitos Visuais

- Explosão ao destruir nave/asteroide: partículas simples expandindo-se.
- Flash na tela ao ser atingido.
- Efeito de pulsação no boss ao receber dano.

### Interface

- Fonte monoespaçada para HUD (ex.: `Courier New` ou `monospace`).
- Telas de menu em HTML/CSS simples.

### Áudio (Opcional / Fora do Escopo Principal)

- Efeito de tiro.
- Efeito de explosão.
- Música ambiente por minigame.

---

## Arquitetura Técnica

O CosmoDock adota uma arquitetura de microsserviços orientada a eventos (EDA) com servidor autoritativo. O cliente envia apenas inputs; toda a lógica de jogo reside no servidor.

### Componentes

| Serviço | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend | HTML5, Canvas API, JS | Renderização e captura de inputs |
| Auth Service | ASP.NET Core (C#) + PostgreSQL | Autenticação, JWT, contas de usuário |
| Game Gateway & Lobby | Node.js + Socket.io | Ponto de entrada WebSocket, matchmaking, roteamento |
| Game Engines (×3) | Node.js (processos isolados) | Loop de física a 60Hz, colisões, pontuação por partida |
| Score Service | Python (Flask/FastAPI) + Redis + PostgreSQL | Consumo de eventos Kafka, ranking, leaderboard |
| Message Broker | Apache Kafka | Transporte assíncrono de eventos de fim de partida |
| Infraestrutura | AWS EC2 + Application Load Balancer | Escalabilidade, balanceamento de tráfego HTTP e WS |

### Paradigmas de Comunicação

- **REST (HTTP/S):** Login, registro e consulta ao leaderboard.
- **WebSockets (Socket.io):** Canal full-duplex para transmissão de inputs e estado do jogo em tempo real.
- **gRPC Síncrono:** Validação de token JWT pelo Gateway junto ao Auth Service no momento da conexão.
- **Kafka (Pub/Sub Assíncrono):** Publicação do evento `match-completed` pelo Game Engine; consumo pelo Score Service para atualização de rankings.

### Garantias de Consistência

- O Kafka retém eventos em disco: mesmo que o Score Service esteja temporariamente indisponível, nenhum resultado é perdido — o processamento é retomado ao restabelecer o serviço (**Consistência Eventual**).
- PostgreSQL pode ser configurado em topologia Primary-Replica para separar escritas de leituras do leaderboard.
- Os três Game Engines rodam como processos independentes: uma sobrecarga em uma partida não afeta as demais (**Particionamento Funcional**).