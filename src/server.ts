import bcrypt from 'bcryptjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';
import { connectDb } from './db/index.js';
import { storage } from './lib/storage.js';
import { createApp } from './app.js';

/** Tenta de novo enquanto o serviço (Postgres/MinIO) ainda está subindo. */
async function retry<T>(label: string, fn: () => Promise<T>, attempts = 20): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`${label} indisponível (tentativa ${i}/${attempts}). Tentando de novo em 2s…`);
      await sleep(2000);
    }
  }
}

const db = await retry('Postgres', () => connectDb(config.databaseUrl));
await retry('MinIO', () => storage.init());

// Primeiro uso: cria o administrador a partir do .env.
const hasUsers = await db.one('SELECT 1 FROM users LIMIT 1');
if (!hasUsers) {
  const { name, email, password } = config.admin;
  if (!email || !password || password.length < 8) {
    console.error('Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_PASSWORD (mín. 8 caracteres) no .env');
    process.exit(1);
  }
  await db.run('INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)', [
    name,
    email,
    bcrypt.hashSync(password, 12),
    'admin',
  ]);
  console.log(`Administrador criado: ${email}. Troque a senha depois do primeiro login.`);
}

const server = createApp().listen(config.port, () => {
  console.log(`API do Controle de Validade rodando na porta ${config.port}`);
});

// Docker manda SIGTERM ao parar: fecha conexões com calma.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`${signal} recebido, encerrando…`);
    server.close(() => db.close().finally(() => process.exit(0)));
  });
}
