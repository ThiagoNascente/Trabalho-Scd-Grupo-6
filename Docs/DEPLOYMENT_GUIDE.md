# Guia de Execução e Deploy do CosmoDock

Este guia foi criado para auxiliar você a rodar o sistema completo localmente usando o Docker Compose e a realizar o deploy na infraestrutura da AWS utilizando uma instância EC2.

---

## 1. Como rodar localmente (Modo Fácil com Docker)

Atualizamos o seu `docker-compose.yml` para englobar toda a infraestrutura (Banco de Dados, Filas e Serviços em C#, Node.js e Frontend). Você **não precisa mais abrir 4 terminais**.

### Passos:
1. Abra um terminal na raiz do projeto (`spaceship-game`).
2. Execute o comando para compilar e iniciar todos os serviços:
   ```bash
   sudo docker compose up -d --build
   ```
3. O Docker fará o download das dependências e subirá os seguintes serviços:
   - **Postgres** (Porta 5432)
   - **Redis / Zookeeper / Kafka** (Em background)
   - **Auth Service / .NET** (Porta 5000)
   - **Game Gateway / Node.js** (Porta 3000)
   - **Frontend / Nginx** (Porta 8080)

4. **Para jogar**: Basta abrir o navegador e acessar `http://localhost:8080`. Todo o ecossistema já estará interconectado!

---

## 2. Passo a Passo para Deploy na AWS (EC2)

Se o objetivo é subir a infraestrutura na AWS para que qualquer pessoa na internet possa jogar, o jeito mais rápido e eficiente é hospedar essa mesma stack Docker Compose em uma máquina virtual (EC2).

### Etapa 1: Criando a Instância EC2
1. Acesse o console da AWS (aws.amazon.com) e vá no serviço **EC2**.
2. Clique em **Launch Instance** (Iniciar Instância).
3. Escolha um nome (ex: `cosmodock-server`).
4. Selecione a imagem (AMI) **Ubuntu Server 22.04 LTS** ou 24.04 LTS.
5. Em "Instance type", selecione algo como `t3.medium` ou `t3.large` (Microservices + Postgres + Kafka pesam um pouco para a `t2.micro` gratuita).
6. Crie e baixe um par de chaves (Key Pair) em `.pem` para acessar via SSH.
7. Em "Network settings" (Configurações de rede), crie um novo **Security Group** com as seguintes regras de *Inbound*:
   - SSH (Porta 22) - Apenas para o seu IP.
   - HTTP (Porta 80) - Anywhere.
   - TCP Custom (Porta 8080) - Anywhere (Para acessar o frontend).
   - TCP Custom (Porta 3000) - Anywhere (Para o Game Gateway WebSockets).
   - TCP Custom (Porta 5000) - Anywhere (Para o Auth Service).
8. Clique em **Launch Instance**.

### Etapa 2: Acessando e Configurando o Servidor
Com a instância iniciada, pegue o IP Público gerado pela AWS e acesse o terminal da sua máquina:

```bash
chmod 400 sua-chave.pem
ssh -i "sua-chave.pem" ubuntu@IP_PUBLICO_DA_EC2
```

Dentro da máquina EC2, instale o Docker e o Docker Compose e o Git:
```bash
sudo apt update
sudo apt install -y docker.io docker-compose git
sudo systemctl enable docker
sudo systemctl start docker
```

### Etapa 3: Enviando e Rodando o Projeto
1. Envie o seu projeto para a instância. O mais fácil é subir o projeto num repositório **GitHub** (privado ou público) e clonar na EC2:
   ```bash
   git clone https://github.com/SEU_USUARIO/spaceship-game.git
   cd spaceship-game
   ```
2. Inicie a frota!
   ```bash
   sudo docker compose up -d --build
   ```

### Etapa 4: Jogando na Nuvem
Após o container compilar e subir (pode demorar alguns minutos na primeira vez):
- Peça para seus amigos acessarem no navegador: `http://IP_PUBLICO_DA_EC2:8080`.
- O Frontend e os WebSockets automaticamente usarão esse host devido à atualização dinâmica que fizemos via `window.location.hostname`.

---

## 3. Avançado (Deploy escalável com Kubernetes)
Como o plano de ação também gerou arquivos `.yaml` na pasta `/k8s`, caso você queira fazer um deploy *enterprise* com Auto-Scaling e Load Balancers verdadeiros, o fluxo é:

1. Subir um cluster **EKS (Elastic Kubernetes Service)** na AWS.
2. Fazer push das imagens locais para o **Amazon ECR** (Elastic Container Registry).
3. Alterar a flag `image:` nos arquivos `deployment-auth.yaml` etc., para a URL do seu ECR.
4. Aplicar os manifestos:
   ```bash
   kubectl apply -f k8s/
   ```
*(Este modelo é recomendado se a base de jogadores for escalar de 100 usuários para milhares).*
