## Descrição do Spaceship

A solução adota uma Arquitetura Baseada em Microsserviços e Orientada a Eventos (EDA), sendo fragmentado em componentes especialistas que utilizam diferentes modelos de concorrência e se comunicam por múltiplos protocolos. O fluxo de jogo adota o padrão de Servidor Autoritativo, onde o cliente web apenas envia comandos de entrada (teclado/mouse) e renderiza o estado visual, enquanto o servidor valida e processa toda a lógica de jogo, colisões e pontuação.
   
### Frontend (Cliente Web)

**Tecnologias**: HTML5 (Canvas API) e JavaScript nativo (ES6+).

**Responsabilidade**: Apresentar a interface de login/registro, o menu de seleção dos 3 tipos de jogos e renderizar a partida em tempo real.

**Mecanismo de Concorrência**: Event-driven no navegador (manipulação assíncrona de eventos de teclado e de rede). O fluxo de jogo em tempo real usa **WebSocket (Socket.io)**: o cliente envia os inputs e recebe o estado do servidor pelo mesmo canal full-duplex, sempre através do **gateway-relay** (o cliente não fala direto com os engines). REST/HTTP é usado para login e leaderboard.

### Serviço de Autenticação e Usuários (Auth Service)

**Tecnologias**: ASP.NET Core (C#), Entity Framework Core, PostgreSQL.

**Responsabilidade**: Gerenciamento de contas, persistência de credenciais, hashing seguro de senhas (criptografia em nível de aplicação) e emissão de tokens JWT (JSON Web Tokens) assinados para controle de acesso.

**Mecanismo de Concorrência:** Multi-threading nativo do Kestrel/ASP.NET, gerenciando requisições HTTP paralelas por meio de um pool de threads gerenciado pelo CLR.

### Gateway de Conexão e Sala de Espera (Game Gateway & Lobby)

**Tecnologias**: Node.js, Socket.io (lobby + relay do jogo em tempo real).

**Responsabilidade**: Atuar como o ponto de entrada para o lobby e o matchmaking (salas de espera) e realizar a validação do token JWT. Ele não processa a física do jogo: para cada cliente, abre uma **conexão-relay** a cada **Game Engine** e **repassa** os inputs do cliente ao engine dono da sala e o estado do engine de volta ao cliente. O cliente fala **só com o gateway**; os engines ficam na rede interna.

**Mecanismo de Concorrência**: Modelo de I/O Não-Bloqueante baseado em Single-Threaded Event Loop, ideal para lidar com milhares de conexões WebSockets simultâneas sem sobrecarga de memória por thread.

### Motores de Jogo (Game Engines)

**Tecnologias**: Node.js (módulos isolados ou processos independentes executando a lógica matemática do jogo).

**Responsabilidade**: Executar o loop principal do jogo (ex.: 60 atualizações por segundo). Recebe as ações de movimentação e tiro vindas do Gateway, calcula a física, detecta colisões entre as naves e projéteis, atualiza os pontos de vida (HP) e devolve o estado atualizado do mapa para o Gateway retransmitir aos jogadores.

**Mecanismo de Concorrência**: Loops de temporização assíncronos (setInterval/setImmediate) operando de forma independente para cada partida ativa, evitando que o processamento de uma sala interfira na latência de outra.

### Serviço de Classificação e Background (Score & Maintenance Service)

**Tecnologias**: Python (Flask ou FastAPI), Redis, PostgreSQL (compartilhado ou via réplica).

**Responsabilidade**: Consumir dados de fim de partida em background, atualizar tabelas de classificação (Leaderboards) globais e por jogo, e executar rotinas automáticas de manutenção (como expurgar dados corrompidos ou sanitizar logs).

**Mecanismo de Concorrência**: Processamento assíncrono de filas e workers baseados em processos/threads para isolar o cálculo de rankings da API REST que serve o dashboard de pontuação.

### Message Broker (Mensageria Assíncrona)

**Tecnologias**: Apache Kafka.

**Responsabilidade**: Agir como o barramento de eventos central do sistema, transportando mensagens de encerramento de partidas e conquistas de forma totalmente desacoplada e persistente.

### Paradigmas de Interação e Comunicação

O sistema demonstra a convivência de três paradigmas distintos de comunicação distribuída:

**Cliente-Servidor** Clássico (REST) e **Tempo Real (WebSocket)**: Utilizado na comunicação do navegador com o ecossistema. REST (HTTP) é empregado para ações síncronas de ciclo curto (Login, Registro, Consulta ao Leaderboard) e **WebSocket (Socket.io)** é usado para o lobby e o **fluxo contínuo do jogo em execução** (inputs do cliente e estado por tick), que trafega pelo **gateway-relay** até o Game Engine da sala.

**Chamada de Procedimento Remoto** (gRPC síncrono): Quando um cliente tenta se conectar ao Game Gateway via WebSocket, o Gateway precisa validar se aquele token JWT ainda é válido e ativo. Para isso, o Node.js realiza uma chamada RPC síncrona (bloqueante para aquela conexão específica) diretamente para o Auth Service em ASP.NET Core, garantindo uma validação centralizada e de alto desempenho.

**Mensageria / Publish-Subscribe** (Apache Kafka assíncrono): Quando uma partida de naves termina no Game Engine (Node.js), ele publica um evento no tópico `match-completed` do Kafka contendo os jogadores e o resultado da partida. O Game Engine se desvincula imediatamente dessa informação e continua livre para processar o próximo jogo. O Score Service (Python), que está inscrito (subscrito) nesse tópico, consome a mensagem no seu próprio ritmo, processa os novos rankings e persiste as alterações.

## Justificativa Arquitetural Frente aos Requisitos

**Serviço acessível a múltiplos clientes na Internet**: A infraestrutura na AWS adota serviços **nativos em EC2** (o ideal de 1 serviço por EC2 foi condensado em **6 máquinas** pelo limite da conta, mantendo isolados o PostgreSQL **primário × réplica** e os **3 engines**), **sem orquestrador de contêineres** (não se utiliza Kubernetes) e **sem Application Load Balancer**. A EC2 `spaceship-app` é a **porta de entrada pública** (Auth REST, Gateway WebSocket e Score REST); os **Game Engines ficam na rede interna**, acessados pelo gateway. O **balanceamento das partidas** é feito pelo **matchmaking do gateway**, que roteia cada jogo para o seu engine — distribuindo naturalmente a carga das partidas entre as instâncias de motor.

**Uso de mais de uma linguagem de programação**: O ecossistema integra C# (segurança e confiabilidade no Auth), JavaScript/TypeScript (alta performance de I/O orientado a eventos no Gateway e reuso de código nos Motores de Jogo) e Python (flexibilidade e manipulação de dados no serviço de pontuação).

**Processamento de dados concorrente no lado servidor**: O loop de física dos 3 jogos roda inteiramente dentro do ambiente Node.js do lado do servidor de forma concorrente, isolando os estados de cada partida em execução.

**Mecanismos de interação remota síncrona e assíncrona**: Implementado com gRPC síncrono para validação de sessões críticas e Apache Kafka assíncrono para o fluxo de persistência de resultados de partidas.

### Replicação e particionamento de dados e funcionalidades

**Particionamento Funcional**: Os 3 jogos de naves rodam em instâncias ou processos separados do Game Engine. Se o servidor do "Jogo 1" sofrer uma sobrecarga, os servidores do "Jogo 2" e "Jogo 3" continuam operando normalmente sem degradação de performance.

**Replicação de Dados**: O banco de dados PostgreSQL pode ser configurado em uma topologia Primary-Replica na AWS, onde a instância primária recebe as escritas de novos usuários e resultados, e as réplicas atendem às leituras concorrentes para montar a tela de Leaderboard sem onerar o nó principal.

**Consistência de dados e disponibilidade**: Se o Score Service (Python) ou o banco de dados falharem temporariamente, o Apache Kafka retém todas as mensagens de fim de partida de forma persistente em disco. Assim que o serviço for restabelecido, o processamento é retomado do ponto onde parou, garantindo Consistência Eventual e impedindo a perda de pontuação dos usuários, elevando a tolerância a falhas do sistema.