# Relatório de QA & Planejamento de Ciclo de Testes

> ⚠️ **DOCUMENTO HISTÓRICO (v1) — SUPERADO PELA v2.** Relatório do ciclo v1 (base para o [Plano v2](../v2/Plano%20de%20correções%20pendentes%20para%20v2.md)), mantido como **registro**. O estado atual do projeto está no [Rastreio de Evolução](../v2/Rastreio%20de%20Evolução.md) e o deploy no [README na raiz](../../README.md).

**QA:** Ana liz

**Projeto:** Jogo Online de Naves (Jogos 1, 2 e 3), Spaceship 

**Responsáveis pela Atualização do Projeto:** Thiago, Vinícius e Moisés 

**Status:** Aguardando Ajustes / Atualização do GDD  

---

## 1. Bugs Críticos e Erros de UI/UX (Mapeamento de Falhas)

### Bug: Duplicação do Menu do Lobby
* **Descrição:** Ao terminar uma partida, fechar a sala do jogo ou desconectar-se da partida, o menu do lobby de salas duplica visualmente na tela.
* **Impacto:** Alto (Grave problema de usabilidade e poluição visual).
* **Ação Necessária:** Total foco na resolução da destruição e renderização dos componentes de tela no ciclo de vida do jogo/desconexão.

### Problema de Fluxo: Tela de Registro vs. Login
* **Descrição:** A tela de registro está idêntica à tela de login. Além disso, falta a validação padrão de segurança no cadastro.
* **Ação Necessária:** * Diferenciar visualmente a interface de Registro da de Login.
  * Implementar obrigatoriamente o campo de confirmação de senha (**digitar a senha pelo menos duas vezes**) antes de persistir o registro no banco de dados.

---

## 2. Consistência e Balanceamento (Gameplay & Design)

### Padronização das Naves e Projéteis
* **Velocidade das Naves:** Foi detectada uma inconsistência de velocidade entre as naves jogadoras a cada nova partida (aparentando flutuação de velocidade por jogo). **Necessário padronizar a velocidade base das naves.**
* **Inconsistência de Projéteis:** O projétil disparado muda a cada jogo. **Necessário padronizar o comportamento e física do projétil** em todos os três modos/jogos.

### Upgrade Visual e Identidade de Cores
* **Modelos das Naves:** Os modelos atuais são extremamente simples. Sugere-se um aperfeiçoamento visual completo do design das naves.
* **Vínculo de Cores (Nave x Tiro):** Elaborar um esquema de cores complexo e diferente para cada nave jogadora. O projétil disparado deve, obrigatoriamente, possuir a **mesma cor da nave que o disparou**.

### Mecânicas de Jogo e Regras de Vitória (Jogos 2 e 3)
* **Contabilização de Pontos:** Nos jogos 2 e 3, o objetivo se perdeu, transformando-se apenas em "sobreviver até o final" em vez de destruir os inimigos. **Implementar sistema de pontuação ativo por destruição.**
* **Spawn do Chefe Final (Jogo 3):** O chefe está surgindo repentinamente na tela. 
  * *Solução proposta:* Criar uma animação de introdução/entrada assim que a última nave inimiga comum for eliminada (ou ultrapassar a formação dos jogadores).
  * *Efeito:* Adicionar um contador ou mensagem de alerta na tela, **congelando o gameplay temporariamente** até o início real da batalha contra o chefe.
* **Áudio:** Adicionar feedback sonoro (efeito de áudio) específico para o disparo da nave jogadora pessoal.

---

## 3. Infraestrutura, Arquitetura de Rede e Performance

Com o objetivo de mitigar o atraso de input (*input lag*) constatado durante as partidas e preparar o jogo para escala, as seguintes frentes de engenharia de infraestrutura devem ser atacadas:

### Rede e Protocolos
* **Avaliação do Protocolo:** O modelo atual com WebSockets pode não ser o ideal para a taxa de atualização do jogo. **Testar uma versão alternativa utilizando WebRTC** para avaliar a redução de latência.
* **Divisão de Servidores:** O projeto ainda carece de uma arquitetura de divisão de servidores para salas abertas.

### Banco de Dados
* Implementar mecanismos de **replicação** do banco de dados para tolerância a falhas.
* Configurar o **particionamento** dos dados para otimização de consultas e escalabilidade.

### DevOps & Configuração local
* Centralizar e isolar as configurações de IP do ambiente em um **arquivo de configuração** (.env ou json estruturado). Isso facilitará a portabilidade e os testes futuros nas instâncias da nuvem.

---

## 4. Próximos Passos e Cronograma de QA

Para que o ciclo de desenvolvimento flua sem gargalos, a equipe deve seguir a ordem de precedência abaixo:

1. **Atualização do GDD:** Modificar o *Game Design Document* para documentar as novas regras de pontuação, esquema de cores/design das naves e a mecânica de transição do chefe.
2. **Refatoração e Correções:** Thiago e Vinícius aplicam as correções de código, arte e infraestrutura baseados neste documento e no novo GDD.
3. **Nova Bateria de Testes (Foco em Cloud):**
   * Realizar testes locais de estresse com o novo arquivo de configuração de IP.
   * Realizar o deploy e **conduzir a nova bateria de testes diretamente na infraestrutura da AWS (EC2)**, validando o comportamento da rede e replicação de dados em ambiente de produção simulado.