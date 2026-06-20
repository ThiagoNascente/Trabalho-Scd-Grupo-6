// ==========================================================================
// Métricas agregadas do harness de carga (requisito 4.2).
// Conta conexões, ciclo de partidas, inputs/estado (throughput), concorrência
// (pico de partidas simultâneas) e latências (conexão, 1º estado, duração).
// ==========================================================================
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}
function ms(n) { return `${Math.round(n)}ms`; }

class Metrics {
  constructor() {
    this.botsSpawned = 0;
    this.connectOk = 0;
    this.connectFail = 0;
    this.matchesStarted = 0;
    this.matchesCompleted = 0;
    this.matchesTimedOut = 0;
    this.inputsSent = 0;
    this.stateMsgs = 0;
    this.errors = {};
    this.connectMs = [];
    this.firstStateMs = [];
    this.matchMs = [];
    this.activeMatches = 0;
    this.peakMatches = 0;
    this.byGame = {};
    this.startedAt = Date.now();
    this.endedAt = null;
  }

  _game(g) {
    return (this.byGame[g] = this.byGame[g] || { started: 0, completed: 0, timedOut: 0 });
  }

  connect(latencyMs) { this.connectOk++; this.connectMs.push(latencyMs); }
  connectError() { this.connectFail++; }

  matchStart(game) {
    this.matchesStarted++; this._game(game).started++;
    this.activeMatches++;
    this.peakMatches = Math.max(this.peakMatches, this.activeMatches);
  }
  matchEnd(game, completed, durationMs) {
    this.activeMatches = Math.max(0, this.activeMatches - 1);
    if (completed) {
      this.matchesCompleted++; this._game(game).completed++;
      if (durationMs) this.matchMs.push(durationMs);
    } else {
      this.matchesTimedOut++; this._game(game).timedOut++;
    }
  }

  firstState(latencyMs) { this.firstStateMs.push(latencyMs); }
  input(n = 1) { this.inputsSent += n; }
  state(n = 1) { this.stateMsgs += n; }
  error(key) { this.errors[key] = (this.errors[key] || 0) + 1; }

  finish() { this.endedAt = Date.now(); }

  report(cfg) {
    const durSec = ((this.endedAt || Date.now()) - this.startedAt) / 1000;
    const line = '─'.repeat(64);
    const out = [];
    out.push('');
    out.push(line);
    out.push('  RELATÓRIO DO HARNESS DE CLIENTES SIMULADOS (req. 4.2)');
    out.push(line);
    out.push(`  Gateway: ${cfg.gatewayUrl}   Auth: ${cfg.authUrl}`);
    out.push(`  Bots: ${this.botsSpawned}   Jogo: ${cfg.game}   Rodadas: ${cfg.rounds}`);
    out.push('');
    out.push('  CONEXÕES');
    out.push(`    ok=${this.connectOk}  falhas=${this.connectFail}`);
    out.push(`    latência de conexão: média ${ms(avg(this.connectMs))}  p95 ${ms(percentile(this.connectMs, 95))}`);
    out.push('');
    out.push('  PARTIDAS');
    out.push(`    iniciadas=${this.matchesStarted}  concluídas=${this.matchesCompleted}  por-timeout=${this.matchesTimedOut}`);
    for (const g of Object.keys(this.byGame).sort()) {
      const s = this.byGame[g];
      out.push(`      ${g}: iniciadas=${s.started} concluídas=${s.completed} timeout=${s.timedOut}`);
    }
    out.push(`    pico de partidas simultâneas: ${this.peakMatches}`);
    out.push('');
    out.push('  THROUGHPUT (concorrência exercitada)');
    out.push(`    inputs enviados=${this.inputsSent}  (${(this.inputsSent / durSec).toFixed(1)}/s)`);
    out.push(`    msgs de estado recebidas=${this.stateMsgs}  (${(this.stateMsgs / durSec).toFixed(1)}/s)`);
    out.push(`    duração total: ${durSec.toFixed(1)}s`);
    out.push('');
    out.push('  LATÊNCIAS');
    out.push(`    tempo até 1º estado: média ${ms(avg(this.firstStateMs))}  p95 ${ms(percentile(this.firstStateMs, 95))}`);
    out.push(`    duração de partida:  média ${ms(avg(this.matchMs))}  p95 ${ms(percentile(this.matchMs, 95))}`);
    out.push('');
    const errKeys = Object.keys(this.errors);
    out.push(`  ERROS: ${errKeys.length ? '' : 'nenhum'}`);
    for (const k of errKeys) out.push(`    ${k}: ${this.errors[k]}`);
    out.push(line);
    return out.join('\n');
  }

  // Critério simples de sucesso do harness (para o exit code).
  ok() {
    return this.connectFail === 0 && this.connectOk > 0 && this.matchesStarted > 0;
  }
}

module.exports = { Metrics };
