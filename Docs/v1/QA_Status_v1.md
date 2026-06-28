# Status de Atendimento ao Relatório de QA (v1)

> ⚠️ **DOCUMENTO HISTÓRICO (v1) — SUPERADO PELA v2.** Reflete o estado e as decisões do ciclo v1 e está **defasado**. O que vale agora está na v2: [Rastreio de Evolução](../v2/Rastreio%20de%20Evolução.md), [Plano de correções pendentes para v2](../v2/Plano%20de%20correções%20pendentes%20para%20v2.md) e [README na raiz](../../README.md). Arquivos citados abaixo que **não existem mais** (ex.: `DEPLOYMENT_GUIDE.md`, manifestos `k8s/`) ou decisões revertidas (Kubernetes/containers na nuvem, criptografia de tráfego) ficam só como **registro** — não os tome como estado atual.

**Referência:** [relatorio_QA_v1.md](../relatorio_QA_v1.md)
**Data:** 2026-06-17
**Responsável pelos ajustes:** Vinícius (Programação)

Este documento mapeia **cada item** do relatório de QA para seu estado atual:
✅ **Resolvido** · 🟡 **Parcial** · ⛔ **Pendente (falta fazer)**.

---

## 1. Bugs Críticos e UI/UX

| Item | Status | Evidência / Como foi resolvido |
|---|---|---|
| Duplicação do menu do lobby | ✅ Resolvido | Criado um **gerenciador central de telas** `showScreen(id)` que esconde todas as views e mostra apenas uma. Todas as transições (lobby, partida, fim de jogo, desconexão) passaram a usá-lo. Ver [index.html](../frontend/index.html) (`SCREENS` / `showScreen`). Antes cada handler ligava/desligava `display` manualmente, podendo deixar duas telas visíveis. |
| Registro idêntico ao Login | ✅ Resolvido | Modo registro agora tem **badge, subtítulo e tema de cor (verde)** distintos do login (roxo). Ver `toggleAuthMode()` e CSS `.register-mode` em [index.html](../frontend/index.html). |
| Falta confirmação de senha no cadastro | ✅ Resolvido | Campo **"Confirmar Senha"** exibido apenas no registro; validação `pass !== confirm` antes de enviar. Ver `handleAuth()` e `#confirm-group`. |

## 2. Consistência e Balanceamento

| Item | Status | Evidência / Como foi resolvido |
|---|---|---|
| Velocidade das naves inconsistente entre jogos | ✅ Resolvido | Movimento agora é **autoritativo no servidor a 60 Hz** com `SHIP_SPEED` único nos 3 jogos. Corrigida a causa raiz no Jogo 3, que enviava input **a cada frame de animação** (dependente do FPS da máquina). Ver constantes no topo de [game-gateway/index.js](../game-gateway/index.js) e a troca por `j3_sendDir`/`g1_sendDir` no cliente. |
| Projétil muda a cada jogo | ✅ Resolvido | Física e visual padronizados: `PROJECTILE_SPEED`, `PROJECTILE_RADIUS`, `SHOOT_COOLDOWN` e **forma de círculo** idêntica nos 3 jogos. |
| Tiro deve ter a cor da nave | ✅ Resolvido | Cada projétil carrega `color`/`cor` = cor da nave e é desenhado nessa cor nos 3 jogos. Paleta única `PLAYER_COLORS`. |
| Modelos de nave simples demais | 🟡 Parcial | Naves redesenhadas (fuselagem com asas recortadas, cabine, brilho na cor). Ainda são formas via Canvas — um upgrade de arte mais elaborado pode ser feito depois. |
| Pontuação por destruição (Jogos 2 e 3) | ✅ Resolvido | Jogo 2 já contava asteroides; rótulo ajustado p/ "Asteroides Destruídos". Jogo 3 **ganhou sistema de pontos** (Caçador 10 / Destruidor 50 / Leviatã 500), exibido em tela e no resultado. |
| Spawn repentino do chefe (Jogo 3) | ✅ Resolvido | Máquina de fases no servidor: **combate → alerta (congela ~3s + contagem "⚠️ A NAVE MÃE SE APROXIMA") → entrada (chefe desce em animação) → batalha**. O chefe só surge após o último inimigo comum ser eliminado. Ver `j3_updateGameLogic`/`j3_spawnEnemies`. |
| Áudio do disparo da nave pessoal | ✅ Resolvido | `playShootSound()` (Web Audio API) tocado **somente quando o próprio jogador atira**, nos 3 jogos. |

## 3. Infraestrutura, Rede e Performance

| Item | Status | Observação |
|---|---|---|
| Centralizar config de IP em arquivo | ✅ Resolvido | `frontend/config.js` (cliente) + `.env.example` (backend). Frontend agora lê `window.APP_CONFIG` em vez de portas chumbadas. |
| Avaliar WebRTC vs WebSockets | ⛔ Pendente | Requer prova de conceito e medição de latência — **não implementado** (ver Pendências). |
| Divisão de servidores p/ salas abertas | ⛔ Pendente | Escalabilidade horizontal dos Game Engines — **não implementado**. |
| Replicação do banco de dados | ⛔ Pendente | Topologia Primary-Replica — **não implementado**. |
| Particionamento de dados | ⛔ Pendente | **Não implementado** (existe apenas particionamento *funcional* lógico dos 3 jogos). |

## 4. Próximos Passos / Cronograma

| Item | Status |
|---|---|
| Atualização do GDD | ✅ Resolvido — [GameDesignDocument.md](../GameDesignDocument.md) v1.1 (cores, pontuação, transição do chefe, áudio, padronização). |
| Refatoração e correções | ✅ Resolvido (itens de código acima). |
| Nova bateria de testes (foco Cloud/AWS) | ⛔ Pendente — depende de deploy na EC2. |

---

## ⛔ O que ainda falta fazer (pendências evidenciadas)

Estas são frentes **não resolvidas neste ciclo**, pois exigem infraestrutura/arquitetura além de ajuste de código no app:

### A. Lacunas entre a arquitetura documentada e a implementação atual
> A documentação ([descrição da arquitetura.md](Arquitetura/descrição%20da%20arquitetura.md)) descreve uma arquitetura EDA completa que **ainda não existe no código**:

1. **Score Service (Python/Flask) — não implementado.** Existe apenas o stub [score-service/README.md](../score-service/README.md). Hoje o `game-gateway` grava vitórias chamando o Auth Service via REST (`/wins/.../increment`).
2. **Game Engines isolados — não implementados.** [game-engine/README.md](../game-engine/README.md) é um stub; toda a física dos 3 jogos roda **monoliticamente dentro do `game-gateway`**.
3. **Apache Kafka — não utilizado.** Sobe no `docker-compose.yml`, mas nenhum serviço publica/consome eventos (`match-completed`). A "consistência eventual" descrita não existe na prática.
4. **Redis — não utilizado.** Sobe no compose, mas não há leaderboard/cache em código.
5. **gRPC síncrono — não implementado.** A validação de JWT no Gateway é feita localmente com a chave compartilhada, não via gRPC ao Auth.
6. **Leaderboard global** (tela de ranking por minigame descrita no GDD) — **não implementado** no frontend nem no backend.

### B. Segurança / Criptografia
- Requisito de [Possiveis_problemas.md](Possiveis_problemas.md): "todas as comunicações devem ser criptografadas". Hoje tudo é **HTTP/WS em texto puro**, `CORS: "*"` e `JWT_SECRET` com valor padrão no código. **Falta:** TLS/HTTPS+WSS (ex.: via ALB/Nginx), segredo de JWT vindo de variável de ambiente segura.

### C. Escalabilidade / Rede (itens do QA seção 3)
- **WebRTC:** prova de conceito e medição de latência vs WebSockets.
- **Divisão de servidores** para salas abertas (rotear partidas para múltiplas instâncias de engine).
- **Replicação** (Primary-Replica) e **particionamento** real do PostgreSQL.

### D. Deploy e testes em nuvem
- Executar a bateria de testes diretamente na **AWS EC2** (seção 4 do QA), validando rede e replicação. Guia já existe em [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

### E. Defeitos adicionais encontrados durante a revisão (fora do QA original)
1. **k8s/deployment-auth.yaml:** o Service aponta `targetPort: 8080`, mas o Auth Service escuta na **porta 5000** (`app.Run("http://0.0.0.0:5000")` em [Program.cs](../auth-service/Program.cs)). Em Kubernetes o roteamento falharia — ajustar `targetPort` para 5000 (ou fazer a app escutar em 8080).
2. **Regra de vitória do Jogo 1 diverge do GDD:** o código encerra com `p1Score >= 2` (melhor de 3), enquanto o GDD fala em "3 vitórias consecutivas". Alinhar código e GDD.
3. **Tipo de inimigo `formacao`** é desenhado/tratado mas **nunca é gerado** (código morto) — remover ou passar a usar.

---

## Resumo executivo

- **Resolvidos neste ciclo:** todos os bugs de UI/UX (seção 1), toda a consistência de gameplay (seção 2, com upgrade visual parcial), centralização de configuração (seção 3) e atualização do GDD (seção 4).
- **Pendente (falta fazer):** a arquitetura distribuída real (Kafka/Redis/Score Service/Game Engines/gRPC/Leaderboard), criptografia das comunicações, WebRTC, divisão de servidores, replicação/particionamento de banco e a bateria de testes em nuvem (AWS).
