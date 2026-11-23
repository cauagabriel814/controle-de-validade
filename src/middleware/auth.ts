import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { can, permissionsOf, type Permission, type Role } from '../lib/permissions.js';

export const SESSION_COOKIE = 'sid';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface SessionPayload {
  sub: string;
  tv: number;
}

/** Middleware marcado: o teste de rotas usa isso para garantir que nenhuma rota fica sem controle de acesso. */
export type GuardedHandler = RequestHandler & { access: { public: true } | { permissions: Permission[] } };

export function signToken(user: { id: number; token_version: number }): string {
  return jwt.sign({ tv: user.token_version }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: `${config.sessionHours}h`,
  });
}

/** Navegador: guarda o token em cookie httpOnly (o JavaScript da página não consegue ler). */
export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    // Secure sempre que a requisição chegou por HTTPS (atrás de proxy, requer TRUST_PROXY=1)
    secure: res.req.secure,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: res.req.secure, path: '/' });
}

/** Token do header `Authorization: Bearer ...` (Postman, apps) ou, se não houver, do cookie (navegador). */
function extractToken(req: Request): string | undefined {
  const header = req.get('authorization');
  if (header) {
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new HttpError(401, 'Cabeçalho Authorization inválido');
    return token.trim();
  }
  const cookie: unknown = req.cookies?.[SESSION_COOKIE];
  return typeof cookie === 'string' && cookie ? cookie : undefined;
}

/**
 * 1ª etapa, quem é você? Valida o token E confere no banco se o usuário ainda existe,
 * está ativo e não teve a sessão revogada (troca de senha/papel, desativação).
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) throw new HttpError(401, 'Faça login para continuar');

  let payload: SessionPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as SessionPayload;
  } catch {
    throw new HttpError(401, 'Sessão expirada. Faça login novamente');
  }

  const user = await db.one<AuthUser & { active: boolean; token_version: number }>(
    'SELECT id, name, email, role, active, token_version FROM users WHERE id = $1',
    [Number(payload.sub)],
  );
  if (!user || !user.active || user.token_version !== payload.tv) {
    throw new HttpError(401, 'Sessão inválida. Faça login novamente');
  }

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
}

/**
 * 2ª etapa, você pode fazer isto? Exige TODAS as permissões listadas.
 * `authorize()` sem permissões = basta estar logado.
 */
export function authorize(...required: Permission[]): GuardedHandler {
  const handler = async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) throw new HttpError(401, 'Faça login para continuar');

    const missing = required.filter((p) => !can(user.role, p));
    if (missing.length > 0) {
      await audit(req, 'acesso_negado', { method: req.method, path: req.originalUrl, missing });
      throw new HttpError(403, 'Você não tem permissão para esta ação');
    }
    next();
  };
  return Object.assign(handler, { access: { permissions: required } });
}

/** Marca explicitamente uma rota como pública (sem login). */
export const publicRoute: GuardedHandler = Object.assign((_req: Request, _res: Response, next: NextFunction) => next(), {
  access: { public: true as const },
});

/** Campos escolhidos um a um: nunca espalhe a linha do banco (vazaria o hash da senha). */
export function publicUser({ id, name, email, role }: AuthUser) {
  return { id, name, email, role, permissions: permissionsOf(role) };
}
