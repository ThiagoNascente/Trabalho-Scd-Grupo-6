// ==========================================================================
// Bot = cliente simulado. Autentica no Auth (REST, igual ao navegador),
// conecta no Gateway por Socket.io (mesmo caminho do cliente real, exercitando
// o relay e os engines) e expõe emit/on para os cenários de jogo.
//
// `onceWithin` é o primitivo de espera: resolve com os args do 1º evento OU com
// '__timeout__' (nunca rejeita), o que torna os cenários robustos e sem
// rejeições penduradas.
// ==========================================================================
const { io } = require('socket.io-client');

const TIMEOUT = '__timeout__';

async function authToken(authUrl, username, password) {
  // Registro idempotente: se o usuário já existe (409) ou a validação reclama,
  // seguimos direto para o login (o usuário pode já ter sido semeado).
  try {
    await fetch(`${authUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (_) { /* Auth pode estar subindo; o login abaixo é a fonte da verdade */ }

  const res = await fetch(`${authUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${username} -> HTTP ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error(`login ${username} sem token`);
  return data.token;
}

class Bot {
  constructor(username, password, cfg, metrics) {
    this.username = username;
    this.password = password;
    this.cfg = cfg;
    this.metrics = metrics;
    this.socket = null;
    this.token = null;
    this._lastDir = null;
    this._lastShot = 0;
  }

  async ensureAuth() {
    this.token = await authToken(this.cfg.authUrl, this.username, this.password);
  }

  connect() {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      this.socket = io(this.cfg.gatewayUrl, {
        auth: { token: this.token },
        transports: ['websocket'],
        reconnection: false,
        timeout: this.cfg.connectTimeoutMs,
      });
      this.socket.once('connect', () => {
        this.metrics.connect(Date.now() - t0);
        resolve();
      });
      this.socket.once('connect_error', (e) => {
        this.metrics.connectError();
        reject(new Error(`connect_error: ${e.message}`));
      });
    });
  }

  get id() { return this.socket && this.socket.id; }
  emit(ev, ...args) { this.socket.emit(ev, ...args); }
  on(ev, cb) { this.socket.on(ev, cb); return this; }
  disconnect() { if (this.socket) this.socket.disconnect(); }
}

// Espera o 1º `event` em QUALQUER um dos bots, dentro de `ms`. Sempre limpa os
// listeners e o timer. Resolve com o array de args do evento, ou com TIMEOUT.
function onceWithin(bots, event, ms) {
  return new Promise((resolve) => {
    let done = false;
    const handlers = [];
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(to);
      bots.forEach((b, i) => b.socket.off(event, handlers[i]));
      resolve(val);
    };
    const to = setTimeout(() => finish(TIMEOUT), ms);
    bots.forEach((b) => {
      const h = (...args) => finish(args);
      handlers.push(h);
      b.socket.on(event, h);
    });
  });
}

module.exports = { Bot, authToken, onceWithin, TIMEOUT };
