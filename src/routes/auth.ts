import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { consumeUserToken, createUserToken, passwordLink } from '../lib/tokens.js';
import { resetMail, sendMail } from '../lib/mailer.js';
import type { Role } from '../lib/permissions.js';
import {
  authenticate, authorize, clearSession, publicRoute, publicUser, setSessionCookie, signToken,
} from '../middleware/auth.js';

export const router = Router();

// Hash fixo para gastar o mesmo tempo quando o e-mail não existe (não revela quais e-mails existem).
const DUMMY_HASH = bcrypt.hashSync('senha-que-ninguem-usa', 10);

export const passwordSchema = z
  .string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres')
  .max(72, 'A senha pode ter no máximo 72 caracteres');

const limiter = (limit: number, message: string) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message },
  });

const loginLimiter = limiter(10, 'Muitas tentativas de login. Aguarde 15 minutos');
const changePasswordLimiter = limiter(10, 'Muitas tentativas. Aguarde 15 minutos');
// Contam todos os pedidos (não só os errados): evita disparar e-mails em massa.
const strictLimiter = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitos pedidos. Aguarde 15 minutos' },
  });
const forgotLimiter = strictLimiter(5);
const setPasswordLimiter = strictLimiter(10);

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  token_version: number;
  password_hash: string | null;
}

const loginSchema = z.object({
  email: z.email('E-mail inválido').max(200),
  password: z.string().min(1).max(200),
});

/**
 * Login. Devolve o token no corpo (para usar como `Authorization: Bearer <token>`)
 * e também grava o cookie httpOnly que o navegador usa.
 */
router.post('/login', publicRoute, loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await db.one<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);

  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !user.password_hash || !ok || !user.active) {
    await audit(req, 'login_falhou', { email }, user?.id);
    throw new HttpError(401, 'E-mail ou senha incorretos');
  }

  const token = signToken(user);
  setSessionCookie(res, token);
  await audit(req, 'login', undefined, user.id);
  res.json({ user: publicUser(user), token, expiresInHours: config.sessionHours });
});

router.post('/logout', publicRoute, (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

router.get('/me', authenticate, authorize(), (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

router.post('/change-password', authenticate, authorize(), changePasswordLimiter, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = (await db.one<UserRow>('SELECT * FROM users WHERE id = $1', [req.user!.id]))!;

  if (!user.password_hash || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'Senha atual incorreta');
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await db.run('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2', [hash, user.id]);
  // Sessões em outros aparelhos caem; esta recebe um token novo.
  const token = signToken({ id: user.id, token_version: user.token_version + 1 });
  setSessionCookie(res, token);
  await audit(req, 'senha_alterada');
  res.json({ token });
});

// ---- Esqueci minha senha / convite ------------------------------------------------

const forgotSchema = z.object({ email: z.email('E-mail inválido').max(200) });

router.post('/forgot-password', publicRoute, forgotLimiter, async (req, res) => {
  const { email } = forgotSchema.parse(req.body);
  const user = await db.one<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1) AND active', [email]);

  if (user) {
    const token = await createUserToken(db, user.id, 'reset');
    await audit(req, 'senha_esquecida', undefined, user.id);
    // Sem await: a resposta leva o mesmo tempo exista o e-mail ou não.
    sendMail(resetMail(user.email, user.name, passwordLink(token))).catch((err) =>
      console.error('Falha ao enviar e-mail de redefinição', err),
    );
  }
  // Mesma resposta sempre: não revela se o e-mail está cadastrado.
  res.status(202).json({ message: 'Se o e-mail estiver cadastrado, você vai receber um link em instantes.' });
});

const setPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

/** Usado tanto pelo link do convite quanto pelo de "esqueci minha senha". */
router.post('/set-password', publicRoute, setPasswordLimiter, async (req, res) => {
  const { token, password } = setPasswordSchema.parse(req.body);
  const hash = await bcrypt.hash(password, 12);

  const user = await db.tx(async (q) => {
    const owner = await consumeUserToken(q, token);
    if (!owner) throw new HttpError(400, 'Link inválido ou expirado. Peça um novo');
    return q.one<UserRow>(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1
       WHERE id = $2 AND active RETURNING *`,
      [hash, owner.user_id],
    );
  });
  if (!user) throw new HttpError(400, 'Usuário desativado');

  await audit(req, 'senha_definida', undefined, user.id);
  const sessionToken = signToken(user);
  setSessionCookie(res, sessionToken);
  res.json({ user: publicUser(user), token: sessionToken });
});
