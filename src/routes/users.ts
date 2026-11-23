import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { idParam, likePattern, optionalText } from '../lib/validation.js';
import { pageQuery, paginate, Where } from '../lib/pagination.js';
import { ROLES } from '../lib/permissions.js';
import { createUserToken, passwordLink } from '../lib/tokens.js';
import { inviteMail, resetMail, sendMail } from '../lib/mailer.js';
import { authorize } from '../middleware/auth.js';

export const router = Router();
router.use(authorize('users:manage'));

// Nunca inclui password_hash. `pending` = convidado que ainda não criou a senha.
const PUBLIC_FIELDS = 'id, name, email, role, active, (password_hash IS NULL) AS pending, created_at';

const listQuery = pageQuery.extend({
  q: optionalText(100),
  role: z.enum(ROLES).optional(),
});

router.get('/', async (req, res) => {
  const { q, role, ...page } = listQuery.parse(req.query);
  const where = new Where();
  if (q) where.add(`(name ILIKE ? ESCAPE '\\' OR email ILIKE ? ESCAPE '\\')`, likePattern(q), likePattern(q));
  where.addIf(role, 'role = ?', role);
  res.json(await paginate({ select: PUBLIC_FIELDS, from: `FROM users ${where}`, orderBy: 'active DESC, name', params: where.params }, page));
});

/** Manda o convite. Se o envio falhar, o usuário fica criado e o admin pode reenviar. */
async function sendInvite(user: { id: number; name: string; email: string; pending?: boolean }, invitedBy: string) {
  const purpose = user.pending === false ? 'reset' : 'invite';
  const token = await createUserToken(db, user.id, purpose);
  const link = passwordLink(token);
  try {
    await sendMail(purpose === 'invite' ? inviteMail(user.email, user.name, invitedBy, link) : resetMail(user.email, user.name, link));
    return true;
  } catch (err) {
    console.error('Falha ao enviar e-mail para', user.email, err);
    return false;
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email('E-mail inválido').max(200),
  role: z.enum(ROLES),
});

/** Cria o usuário SEM senha e envia o convite por e-mail. Ninguém além da pessoa conhece a senha. */
router.post('/', async (req, res) => {
  const data = createSchema.parse(req.body);
  const user = (await db.one<{ id: number; name: string; email: string }>(
    `INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING ${PUBLIC_FIELDS}`,
    [data.name, data.email, data.role],
  ))!;
  await audit(req, 'usuario_criado', { id: user.id, email: data.email, role: data.role });
  const inviteSent = await sendInvite(user, req.user!.name);
  res.status(201).json({ ...user, inviteSent });
});

/** Reenvia o convite (ou um link de redefinição, se a pessoa já tinha senha). */
router.post('/:id/invite', async (req, res) => {
  const id = idParam(req.params.id);
  const user = await db.one<{ id: number; name: string; email: string; active: boolean; pending: boolean }>(
    `SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`,
    [id],
  );
  if (!user) throw notFound('Usuário');
  if (!user.active) throw new HttpError(400, 'Ative o usuário antes de enviar o link');
  const sent = await sendInvite(user, req.user!.name);
  if (!sent) throw new HttpError(502, 'Não foi possível enviar o e-mail. Confira a configuração de SMTP');
  await audit(req, 'convite_reenviado', { id });
  res.json({ inviteSent: true });
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});

router.patch('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const data = updateSchema.parse(req.body);
  if (!(await db.one('SELECT id FROM users WHERE id = $1', [id]))) throw notFound('Usuário');

  if (id === req.user!.id && (data.role !== undefined || data.active !== undefined)) {
    throw new HttpError(400, 'Você não pode alterar o próprio papel ou desativar a si mesmo');
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (data.name !== undefined) set('name', data.name);
  if (data.role !== undefined) set('role', data.role);
  if (data.active !== undefined) set('active', data.active);
  if (sets.length === 0) throw new HttpError(400, 'Nada para alterar');
  // Mudou o acesso: derruba as sessões abertas desse usuário.
  if (data.role !== undefined || data.active !== undefined) sets.push('token_version = token_version + 1');

  params.push(id);
  const user = await db.one(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${PUBLIC_FIELDS}`, params);
  await audit(req, 'usuario_alterado', { id, ...data });
  res.json(user);
});
