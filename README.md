# Spaceship Multiplayer Platform 🚀

Uma plataforma unificada para jogos multiplayer online via navegador, rodando sob uma arquitetura de microsserviços.

## 📦 Dependências

Para rodar este projeto em qualquer máquina, você precisará apenas do:

1. **Docker e Docker Compose** (ou Docker Desktop)
   - Todos os serviços (Backend, Gateway e Frontend) e o banco de dados rodam inteiramente via contêineres, dispensando a necessidade de instalar ferramentas como Python, Node.js ou o SDK do .NET localmente.

---

## 🚀 Como Executar

Você só precisará abrir **1 terminal** na raiz do projeto (`spaceship-game`):

### 1. Criar o arquivo de configuração `.env`
Os segredos (senha do banco e segredo do JWT) **não ficam no código**: vêm do `.env`.
Copie o modelo e ajuste os valores se desejar:
```bash
cp .env.example .env
```
> Sem `POSTGRES_PASSWORD` e `JWT_SECRET` definidos no `.env`, o `docker compose up` falha de propósito, com mensagem indicando a variável faltante.

### 2. Subir a Infraestrutura (Banco de Dados, APIs, Gateway e Frontend)
Este comando constrói e liga automaticamente toda a frota do jogo:
```bash
sudo docker compose up -d --build
```

### Encerrar o Servidor
Para matar todas as execuções e liberar as portas:
```bash
sudo docker compose down
```

### 🎮 Como Jogar
- **No seu computador:** Abra o navegador e acesse `http://localhost:8080`
- **Com amigos (LAN):** Descubra seu IP (digite `ip a` no terminal) e peça para eles acessarem `http://SEU_IP:8080` pelo celular ou notebook deles.

---

## 🏗️ Estrutura do Projeto

- `/auth-service`: API REST em ASP.NET Core para Login e Registro (JWT). **Serviço de auth canônico** (BCrypt + PostgreSQL).
- `/auth-service-lite`: espelho do Auth em Node.js (users.json) para rodar **sem Docker** em DEV — alinhado ao canônico (bcrypt, mesmo contrato/claims).
- `/game-gateway`: Gateway/Lobby em Node.js — autentica, faz matchmaking e **roteia** (relay): para cada cliente abre uma conexão a cada Game Engine. **Não roda física.**
- `/game-engine`: Game Engine em Node.js — roda a física de **um** jogo. A mesma imagem serve os 3, escolhendo o jogo pela variável `GAME` (`jogo1`/`jogo2`/`jogo3`). São 3 processos independentes (Particionamento Funcional: derrubar um não afeta os outros). Hospeda também o **canal de jogo via WebRTC** (geckos.io): inputs e estado de partida trafegam por DataChannel (UDP) direto cliente↔engine, com fallback automático para Socket.io.
- `/score-service`: Serviço de pontuação em **Python/Flask** (3ª linguagem) — consome `match-completed` do **Kafka**, materializa o ranking por minigame no **Redis** e grava o histórico no **PostgreSQL** (tabela `scores` **particionada por minigame**). Expõe `GET /api/scores`.
- `/frontend`: Aplicação client-side (HTML/CSS/JS) para interação.
- `/load-test`: **Clientes simulados** (bots) que exercitam concorrência jogando os 3 minigames em paralelo (req. 4.2). Ver [load-test/README.md](load-test/README.md).
- `/test-data`: **Dados de teste** versionados — usuários seed e fixture de ranking (req. 4.8). Ver [test-data/README.md](test-data/README.md).
- `docker-compose.yml`: Infraestrutura de desenvolvimento (todos os serviços).
