import { z } from 'zod';
import { HttpError } from './errors.js';

/** Campos de formulário multipart chegam como string; '' vira "não informado". */
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const money = z.preprocess(blankToUndefined, z.coerce.number().min(0).max(1_000_000).optional());

export const quantity = z.coerce.number().positive().max(1_000_000);

export const isoDate = z.iso.date('Data inválida (use AAAA-MM-DD)');

/** Aceita true/false/1/0 vindos de form ou query string. */
export const boolish = z.preprocess(
  (v) => (v === 'true' || v === '1' || v === 1 || v === true ? true : v === 'false' || v === '0' || v === 0 || v === false ? false : v),
  z.boolean(),
);

export const optionalId = z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional());

export function idParam(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) throw new HttpError(400, 'ID inválido');
  return id;
}

/** Escapa % e _ para uso seguro em ILIKE ... ESCAPE '\'. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
