# Spaceship Multiplayer Platform 🚀

Uma plataforma unificada para jogos multiplayer online via navegador, rodando sob uma arquitetura de microsserviços.

## 📦 Dependências

Para rodar este projeto em qualquer máquina, você precisará apenas do:

1. **Docker e Docker Compose** (ou Docker Desktop)
   - Todos os serviços (Backend, Gateway e Frontend) e o banco de dados rodam inteiramente via contêineres, dispensando a necessidade de instalar ferramentas como Python, Node.js ou o SDK do .NET localmente.

---

## 🚀 Como Executar

Você só precisará abrir **1 terminal** na raiz do projeto (`spaceship-game`):

### Subir a Infraestrutura (Banco de Dados, APIs, Gateway e Frontend)
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

- `/auth-service`: API REST em ASP.NET Core para Login e Registro.
- `/game-gateway`: Servidor Socket.io em Node.js com toda a física dos 3 jogos.
- `/frontend`: Aplicação client-side (HTML/CSS/JS) para interação.
- `docker-compose.yml`: Infraestrutura de apoio.
