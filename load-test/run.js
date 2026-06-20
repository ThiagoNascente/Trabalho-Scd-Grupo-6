// ==========================================================================
// Runner dos clientes simulados (requisito 4.2).
// Sobe N bots concorrentes, distribui entre os 3 jogos, executa o ciclo de
// partida e imprime um relatório de carga/concorrência.
//
// Uso:
//   node run.js [--bots=8] [--game=mix|jogo1|jogo2|jogo3] [--rounds=1]
//               [--gateway=http://host:3000] [--auth=http://host:5000/api/auth]
//               [--match-timeout=20000]
// Variáveis de ambiente equivalentes: GATEWAY_URL, AUTH_API_URL.
// ==========================================================================
const fs = require('fs');
const path = require('path');
const { Bot } = require('./lib/bot');
const { Metrics } = require('./lib/metrics');
const { playJogo1, playJogo2, playJogo3 } = require('./lib/scenarios');

function parseArgs(argv) {
  const a = {};
  for (const tok of argv.slice(2)) {
    const m = tok.match(/^--([^=]+)=(.*)$/);
    if (m) a[m[1]] = m[2];
  }
  return a;
}

function loadConfig() {
  const a = parseArgs(process.argv);
  return {
    gatewayUrl: a.gateway || process.env.GATEWAY_URL || 'http://localhost:3000',
    authUrl: a.auth || process.env.AUTH_API_URL || 'http://localhost:5000/api/auth',
    bots: parseInt(a.bots || process.env.BOTS || '8', 10),
    game: a.game || 'mix',
    rounds: parseInt(a.rounds || '1', 10),
    connectTimeoutMs: parseInt(a['connect-timeout'] || '8000', 10),
    startTimeoutMs: parseInt(a['start-timeout'] || '8000', 10),
    matchTimeoutMs: parseInt(a['match-timeout'] || '20000', 10),
  };
}

function loadUsers(count) {
  const file = path.join(__dirname, '..', 'test-data', 'seed-users.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pwd = data.defaultPassword || 'orbita-2026';
  const users = data.users.slice();
  // Se faltarem usuários para o nº de bots pedido, sintetiza extras (registro idempotente).
  for (let i = users.length; i < count; i++) {
    users.push({ username: `carga_${String(i).padStart(3, '0')}`, password: pwd });
  }
  return users.slice(0, count);
}

// Executa `fn` para cada item com no máximo `limit` em paralelo.
async function pool(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildTasks(bots, game, cfg, metrics) {
  const T = [];
  const j1 = (a, b) => T.push(() => playJogo1(a, b, cfg, metrics));
  const j2 = (b) => T.push(() => playJogo2(b, cfg, metrics));
  const j3 = (b) => T.push(() => playJogo3(b, cfg, metrics));

  if (game === 'jogo1') {
    for (let i = 0; i + 1 < bots.length; i += 2) j1(bots[i], bots[i + 1]);
    if (bots.length % 2 === 1) j2(bots[bots.length - 1]);
  } else if (game === 'jogo2') {
    bots.forEach(j2);
  } else if (game === 'jogo3') {
    bots.forEach(j3);
  } else { // mix: cada grupo de 4 = 1 dupla de jogo1 + 1 jogo2 + 1 jogo3
    let i = 0;
    while (i < bots.length) {
      const rem = bots.length - i;
      if (rem >= 4) { j1(bots[i], bots[i + 1]); j2(bots[i + 2]); j3(bots[i + 3]); i += 4; }
      else if (rem === 3) { j2(bots[i]); j3(bots[i + 1]); j2(bots[i + 2]); i += 3; }
      else if (rem === 2) { j1(bots[i], bots[i + 1]); i += 2; }
      else { j2(bots[i]); i += 1; }
    }
  }
  return T;
}

async function main() {
  const cfg = loadConfig();
  const metrics = new Metrics();
  console.log(`[harness] gateway=${cfg.gatewayUrl} auth=${cfg.authUrl} bots=${cfg.bots} jogo=${cfg.game} rodadas=${cfg.rounds}`);

  const users = loadUsers(cfg.bots);
  const bots = users.map((u) => new Bot(u.username, u.password, cfg, metrics));
  metrics.botsSpawned = bots.length;

  // Autentica + conecta (concorrência limitada para não saturar o Auth).
  const connected = [];
  await pool(bots, 6, async (bot) => {
    try {
      await bot.ensureAuth();
      await bot.connect();
      connected.push(bot);
    } catch (e) {
      metrics.error(`setup:${e.message.split(':')[0]}`);
      console.error(`[harness] bot ${bot.username} falhou: ${e.message}`);
    }
  });
  console.log(`[harness] conectados ${connected.length}/${bots.length}`);

  if (!connected.length) {
    metrics.finish();
    console.log(metrics.report(cfg));
    console.error('[harness] nenhum bot conectou — a stack (auth/gateway/engines) está no ar?');
    process.exit(1);
  }

  for (let r = 1; r <= cfg.rounds; r++) {
    if (cfg.rounds > 1) console.log(`[harness] rodada ${r}/${cfg.rounds}`);
    const tasks = buildTasks(connected, cfg.game, cfg, metrics);
    await Promise.allSettled(tasks.map((t) => t().catch((e) => metrics.error(`task:${e.message}`))));
  }

  metrics.finish();
  console.log(metrics.report(cfg));
  connected.forEach((b) => b.disconnect());
  process.exit(metrics.ok() ? 0 : 1);
}

main().catch((e) => { console.error('[harness] erro fatal:', e); process.exit(1); });
