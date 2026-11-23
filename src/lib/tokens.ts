import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../db/index.js';
import { config } from '../config.js';

export type TokenPurpose = 'invite' | 'reset';

const LIFETIME_HOURS: Record<TokenPurpose, number> = { invite: 72, reset: 1 };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Cria um link de uso único. No banco fica só o hash: quem tiver acesso ao banco
 * não consegue usar os links. Links anteriores do mesmo usuário deixam de valer.
 */
export async function createUserToken(q: Queryable, userId: number, purpose: TokenPurpose): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await q.run('UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await q.run(
    `INSERT INTO user_tokens (user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [userId, hash(token), purpose, LIFETIME_HOURS[purpose]],
  );
  return token;
}

/** Marca o token como usado (atomicamente) e devolve o dono, ou undefined se inválido/expirado/já usado. */
export async function consumeUserToken(q: Queryable, token: string) {
  return q.one<{ user_id: number; purpose: TokenPurpose }>(
    `UPDATE user_tokens SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id, purpose`,
    [hash(token)],
  );
}

export function passwordLink(token: string) {
  return `${config.appUrl}/#/definir-senha?token=${encodeURIComponent(token)}`;
}
