import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { addDays, today } from '../lib/dates.js';
import {
  boolish, idParam, isoDate, likePattern, money, optionalId, optionalText, quantity,
} from '../lib/validation.js';
import { pageQuery, paginate, Where } from '../lib/pagination.js';
import { authorize } from '../middleware/auth.js';
import { fileField, removeImage, saveImage, upload } from '../middleware/upload.js';

export const router = Router();

const photoUpload = upload.fields([{ name: 'expiryPhoto', maxCount: 1 }]);

const LOT_FIELDS = (todayParam: string) => `
  l.*, p.name AS product_name, p.unit, p.photo AS product_photo, p.category_id,
  c.name AS category_name, c.perishable,
  (l.expiry_date - ${todayParam}::date) AS days_left`;

const LOT_FROM = `
  FROM lots l
  JOIN products p ON p.id = l.product_id
  JOIN categories c ON c.id = p.category_id`;

interface LotRow {
  id: number;
  product_id: number;
  quantity: number;
  cost_price: number | null;
  sale_price: number | null;
  promo_price: number | null;
  in_promo: boolean;
  expiry_photo: string | null;
}

async function getLot(id: number) {
  const lot = await db.one<LotRow>('SELECT * FROM lots WHERE id = $1', [id]);
  if (!lot) throw notFound('Lote');
  return lot;
}

async function lotView(id: number) {
  return db.one(`SELECT ${LOT_FIELDS('$2')} ${LOT_FROM} WHERE l.id = $1`, [id, today()]);
}

// ---- Busca de vencimentos ---------------------------------------------------------------
//
//   GET /api/lots?days=5               vencem de hoje até daqui a 5 dias
//   GET /api/lots?days=10              ... até 10 dias
//   GET /api/lots?expired=true         já vencidos
//   GET /api/lots?expired=true&days=7  vencidos + os que vencem em até 7 dias
//   + filtros: q, categoryId, productId, perishable, promo, state, sort, page, pageSize

const SORTS = {
  expiry: 'l.expiry_date ASC, p.name',
  '-expiry': 'l.expiry_date DESC, p.name',
  name: 'p.name, l.expiry_date',
  quantity: 'l.quantity DESC, l.expiry_date',
} as const;

export const lotSearchQuery = pageQuery.extend({
  days: z.coerce.number().int().min(0).max(365).optional(),
  expired: boolish.optional(),
  q: optionalText(100),
  categoryId: optionalId,
  productId: optionalId,
  perishable: boolish.optional(),
  promo: boolish.optional(),
  // open = com estoque (padrão) | closed = zerados | all
  state: z.enum(['open', 'closed', 'all']).default('open'),
  sort: z.enum(['expiry', '-expiry', 'name', 'quantity']).default('expiry'),
});

router.get('/', authorize('lots:read'), async (req, res) => {
  const f = lotSearchQuery.parse(req.query);
  const t = today();
  const where = new Where();
  const todayParam = where.param(t);

  where.add('p.active');
  if (f.state === 'open') where.add('l.quantity > 0');
  if (f.state === 'closed') where.add('l.quantity = 0');

  if (f.expired && f.days !== undefined) {
    where.add('(l.expiry_date < ? OR l.expiry_date BETWEEN ? AND ?)', t, t, addDays(t, f.days));
  } else if (f.expired === true) {
    where.add('l.expiry_date < ?', t);
  } else if (f.expired === false) {
    where.add('l.expiry_date >= ?', t);
  }
  if (!f.expired && f.days !== undefined) where.add('l.expiry_date BETWEEN ? AND ?', t, addDays(t, f.days));

  if (f.q) where.add(`(p.name ILIKE ? ESCAPE '\\' OR p.barcode = ?)`, likePattern(f.q), f.q);
  where.addIf(f.categoryId, 'p.category_id = ?', f.categoryId);
  where.addIf(f.productId, 'l.product_id = ?', f.productId);
  where.addIf(f.perishable, 'c.perishable = ?', f.perishable);
  where.addIf(f.promo, 'l.in_promo = ?', f.promo);

  res.json(
    await paginate(
      { select: LOT_FIELDS(todayParam), from: `${LOT_FROM} ${where}`, orderBy: SORTS[f.sort], params: where.params },
      f,
    ),
  );
});

router.get('/:id', authorize('lots:read'), async (req, res) => {
  const id = idParam(req.params.id);
  const lot = await lotView(id);
  if (!lot) throw notFound('Lote');
  res.json(lot);
});

// ---- Cadastro e edição ---------------------------------------------------------------

const createSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity,
  expiryDate: isoDate,
  costPrice: money,
  salePrice: money,
  notes: optionalText(300),
});

router.post('/', authorize('lots:write'), photoUpload, async (req, res) => {
  const data = createSchema.parse(req.body);
  if (!(await db.one('SELECT id FROM products WHERE id = $1 AND active', [data.productId]))) {
    throw new HttpError(400, 'Produto inválido');
  }

  const photo = await saveImage(fileField(req.files, 'expiryPhoto'));
  try {
    const row = await db.one<{ id: number }>(
      `INSERT INTO lots (product_id, initial_quantity, quantity, expiry_date, cost_price, sale_price, expiry_photo, notes, created_by)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [data.productId, data.quantity, data.expiryDate, data.costPrice ?? null, data.salePrice ?? null, photo ?? null, data.notes ?? null, req.user!.id],
    );
    res.status(201).json(await lotView(row!.id));
  } catch (err) {
    await removeImage(photo);
    throw err;
  }
});

const updateSchema = z.object({
  expiryDate: isoDate,
  costPrice: money,
  salePrice: money,
  notes: optionalText(300),
  removePhoto: boolish.optional(),
});

router.patch('/:id', authorize('lots:write'), photoUpload, async (req, res) => {
  const id = idParam(req.params.id);
  const data = updateSchema.parse(req.body);
  const lot = await getLot(id);

  const newPhoto = await saveImage(fileField(req.files, 'expiryPhoto'));
  const photo = newPhoto ?? (data.removePhoto ? null : lot.expiry_photo);
  await db.run(
    'UPDATE lots SET expiry_date = $1, cost_price = $2, sale_price = $3, notes = $4, expiry_photo = $5 WHERE id = $6',
    [data.expiryDate, data.costPrice ?? null, data.salePrice ?? null, data.notes ?? null, photo, id],
  );
  if (lot.expiry_photo && lot.expiry_photo !== photo) await removeImage(lot.expiry_photo);
  res.json(await lotView(id));
});

router.delete('/:id', authorize('lots:delete'), async (req, res) => {
  const id = idParam(req.params.id);
  const lot = await getLot(id);
  if (await db.one('SELECT 1 FROM movements WHERE lot_id = $1 LIMIT 1', [id])) {
    throw new HttpError(409, 'Este lote já tem vendas/perdas registradas e não pode ser excluído');
  }
  await db.run('DELETE FROM lots WHERE id = $1', [id]);
  await removeImage(lot.expiry_photo);
  await audit(req, 'lote_excluido', { id });
  res.status(204).end();
});

// ---- Promoção ----------------------------------------------------------------

const promoSchema = z.object({ promoPrice: z.coerce.number().min(0).max(1_000_000) });

router.post('/:id/promo', authorize('lots:write'), async (req, res) => {
  const id = idParam(req.params.id);
  const { promoPrice } = promoSchema.parse(req.body);
  const lot = await getLot(id);
  if (lot.quantity <= 0) throw new HttpError(400, 'Lote sem estoque');
  await db.run('UPDATE lots SET in_promo = TRUE, promo_price = $1 WHERE id = $2', [promoPrice, id]);
  res.json(await lotView(id));
});

router.delete('/:id/promo', authorize('lots:write'), async (req, res) => {
  const id = idParam(req.params.id);
  await getLot(id);
  await db.run('UPDATE lots SET in_promo = FALSE WHERE id = $1', [id]);
  res.json(await lotView(id));
});

// ---- Saídas: venda, perda, ajuste -----------------------------------------------

const movementSchema = z.object({
  type: z.enum(['venda', 'perda', 'ajuste']),
  quantity,
  reason: optionalText(200),
});

router.post('/:id/movements', authorize('movements:write'), async (req, res) => {
  const id = idParam(req.params.id);
  const data = movementSchema.parse(req.body);

  await db.tx(async (q) => {
    // FOR UPDATE: duas saídas ao mesmo tempo não conseguem tirar mais do que existe
    const lot = await q.one<LotRow>('SELECT * FROM lots WHERE id = $1 FOR UPDATE', [id]);
    if (!lot) throw notFound('Lote');
    if (data.quantity > lot.quantity + 1e-9) {
      throw new HttpError(400, `Quantidade maior que o estoque do lote (${lot.quantity})`);
    }
    // Perda vale o custo (dinheiro que saiu do caixa). Venda vale o preço praticado.
    const unitValue =
      data.type === 'perda'
        ? (lot.cost_price ?? lot.sale_price ?? 0)
        : data.type === 'venda'
          ? ((lot.in_promo ? lot.promo_price : null) ?? lot.sale_price ?? 0)
          : 0;

    await q.run(
      `INSERT INTO movements (lot_id, type, quantity, unit_value, in_promo, reason, occurred_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, data.type, data.quantity, unitValue, lot.in_promo, data.reason ?? null, today(), req.user!.id],
    );
    await q.run('UPDATE lots SET quantity = greatest(0, quantity - $1) WHERE id = $2', [data.quantity, id]);
  });

  res.status(201).json(await lotView(id));
});

router.get('/:id/movements', authorize('lots:read'), async (req, res) => {
  const id = idParam(req.params.id);
  const page = pageQuery.parse(req.query);
  await getLot(id);
  res.json(
    await paginate(
      {
        select: 'm.*, u.name AS user_name',
        from: 'FROM movements m LEFT JOIN users u ON u.id = m.created_by WHERE m.lot_id = $1',
        orderBy: 'm.id DESC',
        params: [id],
      },
      page,
    ),
  );
});
