import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Segunda barreira contra CSRF (a primeira é o cookie SameSite=strict):
 * requisições que alteram dados vindas de outro site são recusadas.
 */
export function sameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Origem inválida');
    }
    if (originHost !== req.get('host')) throw new HttpError(403, 'Origem não permitida');
  }
  next();
}
