import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';

// Códigos de erro do Postgres que viram resposta amigável
const PG_ERRORS: Record<string, [number, string]> = {
  '23505': [409, 'Já existe um registro com esses dados'],
  '23503': [409, 'Registro está em uso e não pode ser removido'],
  '23514': [400, 'Valor fora do permitido'],
  '22P02': [400, 'Valor em formato inválido'],
  '22003': [400, 'Número grande demais'],
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Dados inválidos',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Imagem muito grande (máx. 5 MB)' : 'Upload inválido' });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }
  const pgCode = (err as { code?: unknown })?.code;
  if (typeof pgCode === 'string' && PG_ERRORS[pgCode]) {
    const [status, message] = PG_ERRORS[pgCode];
    res.status(status).json({ error: message });
    return;
  }

  console.error(err);
  // Nunca devolve stack trace ou detalhe interno ao cliente.
  res.status(500).json({ error: 'Erro interno. Tente novamente' });
}
