// ==========================================================================
// Configuração centralizada de endpoints do CLIENTE (frontend)
// --------------------------------------------------------------------------
// Centralize aqui o host e as portas dos serviços. Isso isola a configuração
// de IP do ambiente e facilita a portabilidade entre máquinas locais, LAN e
// instâncias na nuvem (ex.: AWS EC2) sem precisar editar o index.html.
//
//  - HOST vazio ("")  => usa automaticamente o host atual do navegador
//                        (window.location.hostname). Recomendado quando TODOS os
//                        serviços estão na mesma máquina (localhost, LAN, 1 EC2).
//  - HOST definido    => host/IP padrão para os serviços que NÃO tiverem um host
//                        próprio definido abaixo.
//
// DEPLOY DISTRIBUÍDO (1 serviço por EC2 — item 3): quando os serviços ficam em
// MÁQUINAS DIFERENTES, defina o host de cada um (AUTH_HOST, GATEWAY_HOST,
// SCORE_HOST e ENGINE_HOSTS por jogo). Cada campo vazio cai para HOST (e HOST
// vazio cai para o host atual do navegador) — o mesmo arquivo serve do localhost
// à AWS, sem nada chumbado no index.html.
//
//  - *_PORT           => porta de cada serviço (REST do Auth, Socket.io do
//                        Gateway, REST do Score).
// ==========================================================================
window.APP_CONFIG = {
    // Host padrão (vazio = host atual do navegador). Usado quando um serviço
    // abaixo não define o seu próprio host.
    HOST: "",

    // --- Hosts por serviço (deploy distribuído / 1 serviço por EC2) ---
    // Vazio ("") => usa HOST acima. Preencha com o DNS/IP público de cada EC2.
    AUTH_HOST: "",      // EC2 do Auth Service (REST/login/registro)
    GATEWAY_HOST: "",   // EC2 do Gateway (lobby/controle/relay do tempo real)
    SCORE_HOST: "",     // EC2 do Score Service (leaderboard)

    AUTH_PORT: 5000,
    GATEWAY_PORT: 3000,

    // Score Service (Python) — leaderboard global por minigame (GET /api/scores).
    // Sem ALB nesta versão: o frontend fala direto com o DNS público do Score.
    SCORE_PORT: 8000,

    // Cadência de tiro do jogador, em ms (deve ESPELHAR o SHOOT_COOLDOWN do
    // servidor em game-engine/shared/constants.js). Limita o disparo do cliente ao
    // ritmo do servidor e evita o "som bugado" ao segurar Espaço (auto-repeat do teclado).
    SHOOT_COOLDOWN_MS: 280
};
