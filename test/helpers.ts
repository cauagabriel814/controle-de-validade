import './env.js';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { connectDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';

export const db = await connectDb('pglite://memory');
export const app = createApp();
export { request };
export { sentMails } from '../src/lib/mailer.js';
export { storage } from '../src/lib/storage.js';

export const PASSWORD = 'senha-forte-123';

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export async function createUser(email: string, role: 'admin' | 'funcionario', password = PASSWORD) {
  const row = await db.one<{ id: number }>(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [email.split('@')[0], email, bcrypt.hashSync(password, 4), role],
  );
  return row!.id;
}

export async function login(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}

/** Pega o token do último link de e-mail enviado para `to`. */
export function tokenFromLastMail(sent: { to: string; text: string }[], to: string): string {
  const mail = [...sent].reverse().find((m) => m.to === to);
  if (!mail) throw new Error(`Nenhum e-mail para ${to}`);
  const match = mail.text.match(/token=([A-Za-z0-9_%-]+)/);
  if (!match) throw new Error('E-mail sem link');
  return decodeURIComponent(match[1]!);
}
