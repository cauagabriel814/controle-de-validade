import { Router } from 'express';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../lib/errors.js';
import { storage } from '../lib/storage.js';
import { authorize } from '../middleware/auth.js';
import { FILE_NAME_RE } from '../middleware/upload.js';

export const router = Router();

// Fotos só para usuários logados. O bucket do MinIO é privado: a foto passa pela API.
router.get('/:name', authorize('products:read'), async (req, res) => {
  const name = req.params.name;
  if (typeof name !== 'string' || !FILE_NAME_RE.test(name)) throw new HttpError(404, 'Arquivo não encontrado');

  const file = await storage.get(name);
  if (!file) throw new HttpError(404, 'Arquivo não encontrado');

  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  await pipeline(file.stream, res);
});
