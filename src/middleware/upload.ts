import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/errors.js';
import { storage } from '../lib/storage.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } as const;
type Ext = keyof typeof TYPES;

/** Nome gerado pelo servidor; qualquer outro formato é recusado (impede ../ e afins). */
export const FILE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 2, fields: 30, fieldSize: 10_000 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'Envie uma imagem JPG, PNG ou WEBP'));
  },
});

/** Confere a assinatura real do arquivo; o tipo informado pelo navegador pode ser falsificado. */
export function detectImage(buf: Buffer): Ext | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

/** Valida e envia a imagem para o MinIO. Devolve o nome gerado. */
export async function saveImage(file: Express.Multer.File | undefined): Promise<string | undefined> {
  if (!file) return undefined;
  const ext = detectImage(file.buffer);
  if (!ext) throw new HttpError(400, 'O arquivo enviado não é uma imagem válida');
  const name = randomUUID() + ext;
  await storage.put(name, file.buffer, TYPES[ext]);
  return name;
}

export async function removeImage(name: string | null | undefined) {
  if (!name || !FILE_NAME_RE.test(name)) return;
  await storage.remove(name).catch((err) => console.error('Falha ao remover foto', name, err));
}

type Files = Record<string, Express.Multer.File[]> | undefined;

export function fileField(files: unknown, field: string): Express.Multer.File | undefined {
  return (files as Files)?.[field]?.[0];
}
