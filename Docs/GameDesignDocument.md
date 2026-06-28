# Spaceship

_Game Design Document — v1.1 (atualizado pós-QA)_

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

**Objetivo:** Eliminar o adversário antes de ser eliminado. Vence a sessão quem abrir **2 pontos de vantagem** no placar.

**Dinâmica:**
- As duas naves aparecem em posições opostas na tela.
- Ambos os jogadores atiram e se esquivam simultaneamente.
- Ao ser atingido, o round termina. O sobrevivente ganha **1 ponto**.
- O placar é **acumulativo**: o ponto soma ao vencedor do round e o adversário **mantém** os pontos que já tinha (não há reset).
- A partida termina assim que um jogador fica **2 pontos à frente** do outro (menor partida possível: 2 × 0).

**Condição de Vitória:** abrir 2 pontos de vantagem no placar (vitória por diferença de 2).

> _Revisão pós-playtest (AWS, 2026-06-27): a regra anterior era "3 vitórias consecutivas" (com reset da sequência ao perder um round). A pedido da equipe, passou para **placar acumulativo com vitória por 2 de vantagem**. Implementação: `WIN_MARGIN` em `game-engine/games/jogo1.js`._

---

### Minigame 2 — Chuva de Asteroides (Survival Multiplayer)

**Jogadores:** 1 a 4.

**Objetivo:** Sobreviver o maior tempo possível destruindo ou desviando dos asteroides que caem.

**Dinâmica:**
- Asteroides descem verticalmente em direção às naves dos jogadores.
- Um asteroide que toca uma nave mata o jogador instantaneamente.
- Asteroides podem ser destruídos com projéteis.
- **Pontuação ativa por destruição:** cada asteroide destruído vale **1 ponto**, exibido em tempo real na tela. O objetivo é destruir o máximo possível, não apenas sobreviver.
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
- **Pontuação ativa por destruição:** Caçador = **10 pts**, Destruidor = **50 pts**, Leviatã = **500 pts**. A pontuação é exibida em tempo real e no resultado final.
- A partida continua enquanto **ao menos um jogador estiver vivo**.
- Após um determinado tempo / número de ondas, o **boss** aparece (ver Transição / Entrada do Chefe).
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
| Forma | Hexágono (com barra de HP exibida acima) |
| HP | 100 (balanceável) |
| Padrão de Tiro | Projéteis descendentes com dispersão horizontal aleatória |
| Aparição | Após o tempo de combate (`BOSS_TRIGGER_TIME`) **e** a eliminação da última nave inimiga comum, precedida de alerta com congelamento |
| Efeito de Vitória | Derrotar o Leviatã encerra o jogo com vitória dos sobreviventes (+500 pontos) |

#### Transição / Entrada do Chefe (anti-spawn repentino)

Para evitar que o chefe surja repentinamente, a entrada segue um fluxo de fases controlado pelo servidor:

1. **Combate:** ondas de inimigos comuns (Caçador e Destruidor) descem normalmente.
2. **Alerta (freeze):** quando o tempo de combate é atingido e o último inimigo comum é eliminado, o gameplay é **congelado por ~3 segundos** e a tela exibe o aviso **"⚠️ A NAVE MÃE SE APROXIMA"** com um contador regressivo. Os projéteis inimigos são limpos para que ninguém morra durante o congelamento.
3. **Entrada:** o chefe surge no topo e **desce em animação** até a posição de combate antes de começar a atacar.
4. **Batalha:** o Leviatã passa a se mover lateralmente e a disparar.

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
| Nave do Jogador 1 | Ciano (#00FFFF) |
| Nave do Jogador 2 | Magenta (#FF00FF) |
| Nave do Jogador 3 | Verde (#00FF88) |
| Nave do Jogador 4 | Amarelo (#FFE600) |
| Inimigo Caçador | Vermelho (#FF3333) |
| Inimigo Destruidor | Roxo (#CC44FF) |
| Boss Leviatã | Vermelho escuro pulsante (#990000) |
| Projéteis do Jogador | **Mesma cor da nave que disparou** |
| Projéteis Inimigos | Laranja (#FF5500) |
| Asteroides | Cinza (#888888) |

> **Vínculo de cores (Nave × Tiro):** cada jogador recebe uma cor única da paleta acima (`PLAYER_COLORS`), atribuída na ordem de entrada na sala. O projétil disparado **herda obrigatoriamente a cor da nave** que o disparou, em todos os três minigames — facilitando a leitura de quem atirou cada tiro.

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

### Áudio

- **Efeito de tiro (implementado):** feedback sonoro disparado **apenas quando a nave pessoal do jogador atira**, gerado via Web Audio API (sem arquivos externos). Aplica-se aos três minigames.
- Efeito de explosão. *(planejado)*
- Música ambiente por minigame. *(planejado)*

---

## Arquitetura Técnica

O Spaceship adota uma arquitetura de microsserviços orientada a eventos (EDA) com servidor autoritativo. O cliente envia apenas inputs; toda a lógica de jogo reside no servidor.

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

---

## Ajustes Pós-QA (v1.1)

Mudanças aplicadas a partir do `relatorio_QA_v1.md`:

### Padronização de naves e projéteis (todos os jogos)

Todo o movimento é **autoritativo no servidor a 60 Hz**, eliminando a flutuação de velocidade que dependia do FPS/máquina do cliente (causa principal no Jogo 3, que antes enviava input a cada frame de animação).

| Parâmetro | Valor padronizado |
|---|---|
| Velocidade base da nave | `SHIP_SPEED = 7` px/tick |
| Velocidade do projétil | `PROJECTILE_SPEED = 14` px/tick |
| Cadência de tiro (cooldown) | `SHOOT_COOLDOWN = 280` ms |
| Raio do projétil | `PROJECTILE_RADIUS = 4` px |
| Forma do projétil | Círculo (idêntico nos 3 jogos) |
| Cor do projétil | Herdada da nave que disparou |

### UI / UX

- **Gerenciador central de telas** (`showScreen`) garante uma única tela visível por vez, eliminando a duplicação do lobby ao fim de partida / desconexão.
- **Registro × Login diferenciados** visualmente (badge, subtítulo, tema de cor) e com **campo de confirmação de senha** obrigatório no cadastro.
- Naves redesenhadas (fuselagem com asas recortadas, cabine e brilho na cor do jogador).

### Configuração

- Endpoints de IP/portas centralizados em `frontend/config.js` (cliente) e `.env.example` (backend).