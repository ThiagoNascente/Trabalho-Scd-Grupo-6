// ==========================================================================
// AUTH SERVICE — LITE (espelho de DESENVOLVIMENTO, item 9.2)
//
// CANÔNICO = auth-service (C#): BCrypt + PostgreSQL + EF Core, usado no
// docker-compose. ESTE serviço (Node + users.json) é só para rodar a stack
// SEM Docker, e está ALINHADO ao canônico no que o cliente enxerga:
//   - hashing de senha por BCRYPT (antes era SHA-256 sem salt);
//   - validação de tamanho 4–30 (igual ao DataAnnotations do UserDto C#);
//   - mesmo contrato de /login → { token } e mesmas claims (sub, id);
//   - mesmo issuer/audience e TTL do token (2h).
// Não é a fonte de verdade em produção — é uma réplica de dev.
// ==========================================================================
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Segredo do JWT vem SEMPRE de variável de ambiente (sem default chumbado).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("[FATAL] JWT_SECRET não definido. Configure a variável de ambiente (veja .env.example).");
  process.exit(1);
}
const PORT = process.env.AUTH_PORT || 5000;
const DB_FILE = path.join(__dirname, 'users.json');

// ---------- "Banco de dados" em arquivo JSON ----------
let users = [];
try { users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { users = []; }
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2)); }

// Custo do BCrypt: 11 = default do BCrypt.Net usado no auth-service C# (canônico).
const BCRYPT_ROUNDS = 11;
// TTL do token alinhado ao canônico C# (2h em AuthController.GenerateJwtToken).
const TOKEN_TTL = '2h';

function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}
function verifyPassword(password, hash) {
  // Aceita hashes BCrypt ($2a/$2b/$2y...). Hashes SHA-256 legados (64 hex) não
  // batem e exigem novo registro — ver migração no README (item 9.2).
  try { return bcrypt.compareSync(password, hash); } catch { return false; }
}

// ---------- ROTAS (mesma API do auth-service .NET) ----------

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Username e password são obrigatórios.' });
  if (username.length < 4 || username.length > 30) return res.status(400).json({ message: 'Username deve ter entre 4 e 30 caracteres.' });
  if (password.length < 4 || password.length > 30) return res.status(400).json({ message: 'Senha deve ter entre 4 e 30 caracteres.' });

  const existing = users.find(u => u.username === username);
  if (existing) return res.status(409).json({ message: 'Usuário já existe.' });

  users.push({ id: users.length + 1, username, passwordHash: hashPassword(password), wins: 0 });
  saveDB();
  res.status(201).json({ message: 'Usuário registrado com sucesso!' });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Username e password são obrigatórios.' });

  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ message: 'Usuário não encontrado.' });

  if (!verifyPassword(password, user.passwordHash)) return res.status(401).json({ message: 'Senha incorreta.' });

  const token = jwt.sign(
    { sub: user.username, id: user.id },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL, issuer: 'spaceship_auth', audience: 'spaceship_gateway' }
  );
  // Contrato alinhado ao canônico C# (AuthController.Login → { token }).
  res.json({ token });
});

// GET /api/auth/wins/:username
app.get('/api/auth/wins/:username', (req, res) => {
  const user = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
  res.json({ wins: user.wins });
});

// POST /api/auth/wins/:username/increment
app.post('/api/auth/wins/:username/increment', (req, res) => {
  const user = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
  user.wins++;
  saveDB();
  res.json({ wins: user.wins });
});

app.listen(PORT, () => {
  console.log(`Auth Service (lite/JSON) running on http://localhost:${PORT}`);
  console.log(`Banco de dados: ${DB_FILE}`);
});
