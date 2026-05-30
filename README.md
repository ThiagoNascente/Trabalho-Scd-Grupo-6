# Spaceship Multiplayer Platform 🚀

Uma plataforma unificada para jogos multiplayer online via navegador, rodando sob uma arquitetura de microsserviços.

## 📦 Dependências (Ubuntu)

Para rodar este projeto em uma máquina Ubuntu (Linux), você precisará instalar as seguintes ferramentas:

1. **Docker e Docker Compose** (Para rodar o Banco de Dados PostgreSQL):
   ```bash
   sudo apt update
   sudo apt install docker.io docker-compose
   ```

2. **Node.js e NPM** (Para o Game Gateway):
   ```bash
   sudo apt install nodejs npm
   ```

3. **.NET 8.0 SDK** (Para o Serviço de Autenticação):
   ```bash
   sudo apt install dotnet-sdk-8.0
   ```

4. **Python 3** (Para servir o Frontend estático de forma simples):
   ```bash
   sudo apt install python3
   ```

---

## 🚀 Como Executar

Você precisará abrir **4 terminais** (ou abas de terminal) e executar os comandos abaixo na raiz do projeto (`spaceship-game`):

### Terminal 1: Infraestrutura (Banco de Dados)
Sobe o banco PostgreSQL que guarda os usuários:
```bash
docker-compose up -d
```

### Terminal 2: Serviço de Autenticação (.NET)
Este serviço rodará na porta `5000`.
```bash
cd auth-service
dotnet run
```

### Terminal 3: Game Gateway (Node.js)
Este é o coração dos jogos (WebSocket), rodará na porta `3000`.
```bash
cd game-gateway
npm install
npm start
```

### Terminal 4: Frontend (Python Server)
Servidor simples para entregar a interface web na porta `8080`.
```bash
cd frontend
python3 -m http.server 8080
```

### 🎮 Como Jogar
- **No seu computador:** Abra o navegador e acesse `http://localhost:8080`
- **Com amigos (LAN):** Descubra seu IP (digite `ip a` no terminal) e peça para eles acessarem `http://SEU_IP:8080` pelo celular ou notebook deles.

---

## 🏗️ Estrutura do Projeto

- `/auth-service`: API REST em ASP.NET Core para Login e Registro.
- `/game-gateway`: Servidor Socket.io em Node.js com toda a física dos 3 jogos.
- `/frontend`: Aplicação client-side (HTML/CSS/JS) para interação.
- `docker-compose.yml`: Infraestrutura de apoio.
