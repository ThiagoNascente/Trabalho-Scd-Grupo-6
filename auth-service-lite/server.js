const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "super_secret_key_that_should_be_long_enough_for_hmac_sha256_in_production";
const PORT = process.env.AUTH_PORT || 5000;
const DB_FILE = path.join(__dirname, 'users.json');

// ---------- "Banco de dados" em arquivo JSON ----------
let users = [];
try { users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { users = []; }
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2)); }

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
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

  if (user.passwordHash !== hashPassword(password)) return res.status(401).json({ message: 'Senha incorreta.' });

  const token = jwt.sign(
    { sub: user.username, id: user.id },
    JWT_SECRET,
    { expiresIn: '24h', issuer: 'spaceship_auth', audience: 'spaceship_gateway' }
  );
  res.json({ token, username: user.username });
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
