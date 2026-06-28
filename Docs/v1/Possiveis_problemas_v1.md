> ⚠️ **DOCUMENTO HISTÓRICO (v1) — SUPERADO PELA v2.** Lista de problemas/requisitos do ciclo v1, mantida como **registro**. Algumas premissas mudaram na v2 (ex.: **sem Kubernetes/containers na nuvem** e **sem criptografia de tráfego** — decisões firmadas no [Plano v2](../v2/Plano%20de%20correções%20pendentes%20para%20v2.md)). O estado atual está no [Rastreio de Evolução](../v2/Rastreio%20de%20Evolução.md) e o deploy no [README na raiz](../../README.md).

## Precaver 

Esse sistema deve ser tolerante a falhas. Quero que considere essa lista de problemas e requisitos que esse projeto deve atender.

- A aplicação deve ser pensada para funcionar em uma infraestrutura na nuvem, com containers, orquestração e banco de dados gerenciado.

- Devemos esperar uma grande quantidade de usuários simultâneos, então o sistema deve ser capaz de escalar horizontalmente.

- O sistema deve ser seguro, então todas as comunicações devem ser criptografadas.

- O sistema deve ser escalável, então os jogos devem ser capaz de lidar com um grande número de jogadores.

- A pontuação de cada jogo deve ser salva permanentemente ao perfil que o jogador está jogando.

- Para jogar os jogos o usuário deve estar logado em alguma conta.

- Uniformidade de telas. Cada tela de lobby do jogo deve ter um botão de voltar para o dashboard. Além disso, ainda na tela de lobby, as salas criadas devem conter o nome de usuário dos jogadores que as criaram.

- As senhas dos usuários não podem ultrapassar de 30 caracteres e devem conter pelo menos 4 caracteres.

- Nomes de usuários não podem ultrapassar de 30 caracteres e devem conter pelo menos 4 caracteres.

