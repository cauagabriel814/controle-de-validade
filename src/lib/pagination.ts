import { z } from 'zod';
import { db } from '../db/index.js';

export const MAX_PAGE_SIZE = 100;

/** Toda listagem aceita ?page=1&pageSize=20 (máximo 100 por requisição). */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Monta a consulta paginada e a contagem total a partir das mesmas partes,
 * para os filtros nunca ficarem diferentes entre as duas.
 */
export async function paginate<T>(
  parts: { select: string; from: string; orderBy: string; params?: unknown[] },
  { page, pageSize }: PageQuery,
): Promise<Page<T>> {
  const params = parts.params ?? [];
  const n = params.length;
  const [items, count] = await Promise.all([
    db.query<T>(`SELECT ${parts.select} ${parts.from} ORDER BY ${parts.orderBy} LIMIT $${n + 1} OFFSET $${n + 2}`, [
      ...params,
      pageSize,
      (page - 1) * pageSize,
    ]),
    // Conta sobre a mesma consulta: todo parâmetro usado no SELECT continua referenciado.
    db.one<{ total: number }>(`SELECT count(*)::int AS total FROM (SELECT ${parts.select} ${parts.from}) AS sub`, params),
  ]);
  const total = count?.total ?? 0;
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/** Ajuda a montar WHERE com parâmetros numerados ($1, $2, ...). */
export class Where {
  private clauses: string[] = [];
  readonly params: unknown[] = [];

  /** Adiciona uma condição; use `?` onde entra o valor. */
  add(clause: string, ...values: unknown[]) {
    let sql = clause;
    for (const v of values) {
      this.params.push(v);
      sql = sql.replace('?', `$${this.params.length}`);
    }
    this.clauses.push(sql);
    return this;
  }

  /** Só adiciona se o valor foi informado. */
  addIf(value: unknown, clause: string, ...values: unknown[]) {
    if (value !== undefined && value !== null && value !== '') this.add(clause, ...values);
    return this;
  }

  /** Registra um parâmetro e devolve o marcador ($n) para usar fora do WHERE. */
  param(value: unknown) {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  toString() {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }
}
