// ==========================================================================
// Cliente de validação de sessão do gateway (item 8 — RPC SÍNCRONO).
//
// validateToken(token) decide a validação conforme o ambiente:
//   - Se AUTH_GRPC_URL estiver definido  -> chama o Auth via gRPC (síncrono,
//     bloqueante): o Auth confere assinatura/expiração E a existência do usuário.
//   - Se o gRPC estiver INACESSÍVEL       -> cai para a validação LOCAL (jwt.verify),
//     para não derrubar o jogo nem quebrar a v1 (DEV sem Docker, ou Auth fora do ar).
//   - Se AUTH_GRPC_URL NÃO estiver definido -> validação puramente LOCAL (modo DEV).
//
// Importante: uma resposta gRPC "inválido" (ex.: usuário removido) é honrada —
// NÃO cai para o local. O fallback local só acontece em erro de TRANSPORTE.
//
// Nada chumbado: endereço e timeout vêm de variável de ambiente.
// ==========================================================================
const path = require('path');
const jwt = require('jsonwebtoken');

const GRPC_URL = process.env.AUTH_GRPC_URL; // ex.: 'auth-service:5005' (vazio => só local)
const GRPC_TIMEOUT_MS = parseInt(process.env.AUTH_GRPC_TIMEOUT_MS || '2000', 10);
const JWT_SECRET = process.env.JWT_SECRET;

let client = null; // cliente gRPC memoizado

function getClient() {
  if (!GRPC_URL) return null;
  if (client) return client;
  const grpc = require('@grpc/grpc-js');
  const protoLoader = require('@grpc/proto-loader');
  const def = protoLoader.loadSync(path.join(__dirname, 'auth.proto'), {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(def).auth;
  // h2c (texto puro): TLS está fora de escopo; a rota Auth↔gateway é rede privada.
  client = new proto.AuthValidation(GRPC_URL, grpc.credentials.createInsecure());
  console.log(`[gateway] validação de sessão via gRPC em ${GRPC_URL} (timeout ${GRPC_TIMEOUT_MS}ms).`);
  return client;
}

// Validação local (assinatura/emissor/audiência/expiração). Sem checagem de
// existência do usuário — é o que o gateway consegue sozinho.
function localVerify(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, username: decoded.sub, decoded };
  } catch (_) {
    return { valid: false, reason: 'invalid token' };
  }
}

// Retorna Promise<{ valid, username?, reason?, decoded? }>.
function validateToken(token) {
  const c = getClient();
  if (!c) return Promise.resolve(localVerify(token));

  return new Promise((resolve) => {
    const deadline = new Date(Date.now() + GRPC_TIMEOUT_MS);
    c.ValidateToken({ token }, { deadline }, (err, reply) => {
      if (err) {
        // Erro de TRANSPORTE (Auth fora/indisponível) -> fallback local, sem regressão.
        console.error(`[gateway] gRPC Auth indisponível (${err.code || err.message}); validando JWT localmente.`);
        return resolve(localVerify(token));
      }
      // Resposta definitiva do Auth (inclui revogação por usuário removido).
      resolve({ valid: !!reply.valid, username: reply.username, reason: reply.reason });
    });
  });
}

module.exports = { validateToken };
