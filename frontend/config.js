// ==========================================================================
// Configuração centralizada de endpoints do CLIENTE (frontend)
// --------------------------------------------------------------------------
// Centralize aqui o host e as portas dos serviços. Isso isola a configuração
// de IP do ambiente e facilita a portabilidade entre máquinas locais, LAN e
// instâncias na nuvem (ex.: AWS EC2) sem precisar editar o index.html.
//
//  - HOST vazio ("")  => usa automaticamente o host atual do navegador
//                        (window.location.hostname). Recomendado para a maioria
//                        dos cenários (localhost, LAN e EC2 funcionam sem editar).
//  - HOST definido    => força um IP/domínio fixo (ex.: "203.0.113.10" ou
//                        "jogo.minhaempresa.com") para todas as conexões.
//
//  - AUTH_PORT        => porta do Auth Service (REST / login / registro).
//  - GATEWAY_PORT     => porta do Game Gateway (WebSockets / Socket.io).
//  - SCORE_PORT       => porta do Score Service (REST do leaderboard, itens 6/7).
// ==========================================================================
window.APP_CONFIG = {
    HOST: "",
    AUTH_PORT: 5000,
    GATEWAY_PORT: 3000,

    // Score Service (Python) — leaderboard global por minigame (GET /api/scores).
    // Em AWS, atrás do Load Balancer na rota /api/scores (item 3).
    SCORE_PORT: 8000,

    // --- Canal de jogo em tempo real (WebRTC / item 2) ---
    // USE_WEBRTC: liga o DataChannel (UDP, baixa latência) para inputs e estado
    // de partida. Se o canal não abrir, o cliente cai automaticamente para o
    // Socket.io (fallback) — desligar aqui força o transporte antigo.
    USE_WEBRTC: true,
    // Porta de SINALIZAÇÃO (geckos) de cada Game Engine. O cliente abre o
    // DataChannel direto no engine do jogo escolhido (HOST acima + porta).
    // Em AWS, apontar para o endereço público de cada EC2 de engine (item 3).
    ENGINE_GECKOS_PORTS: { jogo1: 5001, jogo2: 5002, jogo3: 5003 }
};
