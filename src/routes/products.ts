import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { today } from '../lib/dates.js';
import { boolish, idParam, likePattern, optionalId, optionalText } from '../lib/validation.js';
import { pageQuery, paginate, Where } from '../lib/pagination.js';
import { authorize } from '../middleware/auth.js';
import { fileField, removeImage, saveImage, upload } from '../middleware/upload.js';

export const router = Router();

export const UNITS = ['un', 'kg', 'g', 'l', 'ml', 'cx', 'pct', 'dz', 'bandeja', 'maço'] as const;

const photoUpload = upload.fields([{ name: 'photo', maxCount: 1 }]);

const SORTS = {
  name: 'p.name',
  expiry: 's.next_expiry ASC NULLS LAST, p.name',
  recent: 'p.created_at DESC',
} as const;

const listQuery = pageQuery.extend({
  q: optionalText(100),
  categoryId: optionalId,
  perishable: boolish.optional(),
  inStock: boolish.optional(),
  sort: z.enum(['name', 'expiry', 'recent']).default('name'),
});

// Resumo do estoque aberto de cada produto
const STOCK_JOIN = `
  LEFT JOIN LATERAL (
    SELECT min(l.expiry_date) AS next_expiry, coalesce(sum(l.quantity), 0) AS stock, count(*)::int AS open_lots
    FROM lots l WHERE l.product_id = p.id AND l.quantity > 0
  ) s ON TRUE`;

router.get('/', authorize('products:read'), async (req, res) => {
  const { q, categoryId, perishable, inStock, sort, ...page } = listQuery.parse(req.query);
  const where = new Where();
  const t = where.param(today());
  where.add('p.active');
  if (q) where.add(`(p.name ILIKE ? ESCAPE '\\' OR p.barcode = ?)`, likePattern(q), q);
  where.addIf(categoryId, 'p.category_id = ?', categoryId);
  where.addIf(perishable, 'c.perishable = ?', perishable);
  if (inStock !== undefined) where.add(inStock ? 's.open_lots > 0' : 's.open_lots = 0');

  res.json(
    await paginate(
      {
        select: `p.id, p.name, p.barcode, p.unit, p.photo, p.category_id, c.name AS category_name, c.perishable,
                 s.next_expiry, s.stock, s.open_lots, (s.next_expiry - ${t}::date) AS days_left`,
        from: `FROM products p JOIN categories c ON c.id = p.category_id ${STOCK_JOIN} ${where}`,
        orderBy: SORTS[sort],
        params: where.params,
      },
      page,
    ),
  );
});

router.get('/:id', authorize('products:read'), async (req, res) => {
  const id = idParam(req.params.id);
  const product = await db.one(
    `SELECT p.*, c.name AS category_name, c.perishable, s.next_expiry, s.stock, s.open_lots,
            (s.next_expiry - $2::date) AS days_left
     FROM products p JOIN categories c ON c.id = p.category_id ${STOCK_JOIN}
     WHERE p.id = $1 AND p.active`,
    [id, today()],
  );
  if (!product) throw notFound('Produto');
  res.json(product);
});

const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  categoryId: z.coerce.number().int().positive(),
  barcode: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().trim().regex(/^[0-9]{6,14}$/, 'Código de barras deve ter de 6 a 14 dígitos').optional(),
  ),
  unit: z.enum(UNITS).default('un'),
  notes: optionalText(500),
});

async function assertCategory(categoryId: number) {
  if (!(await db.one('SELECT id FROM categories WHERE id = $1', [categoryId]))) throw new HttpError(400, 'Categoria inválida');
}

router.post('/', authorize('products:write'), photoUpload, async (req, res) => {
  const data = productSchema.parse(req.body);
  await assertCategory(data.categoryId);

  const photo = await saveImage(fileField(req.files, 'photo'));
  try {
    const product = await db.one(
      `INSERT INTO products (name, category_id, barcode, unit, photo, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.name, data.categoryId, data.barcode ?? null, data.unit, photo ?? null, data.notes ?? null, req.user!.id],
    );
    res.status(201).json(product);
  } catch (err) {
    await removeImage(photo);
    throw err;
  }
});

const updateSchema = productSchema.extend({ removePhoto: boolish.optional() });

router.patch('/:id', authorize('products:write'), photoUpload, async (req, res) => {
  const id = idParam(req.params.id);
  const data = updateSchema.parse(req.body);
  const current = await db.one<{ photo: string | null }>('SELECT photo FROM products WHERE id = $1 AND active', [id]);
  if (!current) throw notFound('Produto');
  await assertCategory(data.categoryId);

  const newPhoto = await saveImage(fileField(req.files, 'photo'));
  const photo = newPhoto ?? (data.removePhoto ? null : current.photo);
  let product;
  try {
    product = await db.one(
      `UPDATE products SET name = $1, category_id = $2, barcode = $3, unit = $4, photo = $5, notes = $6
       WHERE id = $7 RETURNING *`,
      [data.name, data.categoryId, data.barcode ?? null, data.unit, photo, data.notes ?? null, id],
    );
  } catch (err) {
    await removeImage(newPhoto);
    throw err;
  }
  if (current.photo && current.photo !== photo) await removeImage(current.photo);
  res.json(product);
});

// Exclusão lógica: o histórico de perdas continua valendo para o relatório.
router.delete('/:id', authorize('products:delete'), async (req, res) => {
  const id = idParam(req.params.id);
  if (!(await db.run('UPDATE products SET active = FALSE WHERE id = $1 AND active', [id]))) throw notFound('Produto');
  await audit(req, 'produto_excluido', { id });
  res.status(204).end();
});
