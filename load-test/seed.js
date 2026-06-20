// ==========================================================================
// Semeia os usuários de teste (test-data/seed-users.json) no Auth, de forma
// idempotente (ignora "já existe"). Útil para preparar a demo antes de rodar
// o harness ou de jogar manualmente no navegador.
//
//   AUTH_API_URL=http://localhost:5000/api/auth node seed.js
// ==========================================================================
const fs = require('fs');
const path = require('path');

const AUTH = process.env.AUTH_API_URL || 'http://localhost:5000/api/auth';

async function main() {
  const file = path.join(__dirname, '..', 'test-data', 'seed-users.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let ok = 0, exist = 0, fail = 0;

  for (const u of data.users) {
    try {
      const res = await fetch(`${AUTH}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u.username, password: u.password }),
      });
      if (res.status === 201) { ok++; console.log(`  + ${u.username}`); }
      else if (res.status === 409) { exist++; console.log(`  = ${u.username} (já existe)`); }
      else { fail++; console.log(`  ! ${u.username} -> HTTP ${res.status}`); }
    } catch (e) {
      fail++; console.log(`  ! ${u.username} -> ${e.message}`);
    }
  }
  console.log(`\nseed: ${ok} criados, ${exist} já existiam, ${fail} falhas (auth=${AUTH})`);
  process.exit(fail ? 1 : 0);
}

main();
