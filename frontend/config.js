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
// ==========================================================================
window.APP_CONFIG = {
    HOST: "",
    AUTH_PORT: 5000,
    GATEWAY_PORT: 3000
};
