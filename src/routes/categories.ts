import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { HttpError, notFound } from '../lib/errors.js';
import { boolish, idParam, likePattern, optionalText } from '../lib/validation.js';
import { pageQuery, paginate, Where } from '../lib/pagination.js';
import { authorize } from '../middleware/auth.js';

export const router = Router();

const listQuery = pageQuery.extend({
  q: optionalText(60),
  perishable: boolish.optional(),
});

router.get('/', authorize('categories:read'), async (req, res) => {
  const { q, perishable, ...page } = listQuery.parse(req.query);
  const where = new Where();
  if (q) where.add(`c.name ILIKE ? ESCAPE '\\'`, likePattern(q));
  where.addIf(perishable, 'c.perishable = ?', perishable);
  res.json(
    await paginate(
      {
        select: `c.id, c.name, c.perishable,
                 (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.active) AS product_count`,
        from: `FROM categories c ${where}`,
        orderBy: 'c.name',
        params: where.params,
      },
      page,
    ),
  );
});

const schema = z.object({
  name: z.string().trim().min(2).max(60),
  perishable: z.boolean(),
});

router.post('/', authorize('categories:write'), async (req, res) => {
  const data = schema.parse(req.body);
  res.status(201).json(await db.one('INSERT INTO categories (name, perishable) VALUES ($1, $2) RETURNING *', [data.name, data.perishable]));
});

router.patch('/:id', authorize('categories:write'), async (req, res) => {
  const id = idParam(req.params.id);
  const data = schema.parse(req.body);
  const row = await db.one('UPDATE categories SET name = $1, perishable = $2 WHERE id = $3 RETURNING *', [data.name, data.perishable, id]);
  if (!row) throw notFound('Categoria');
  res.json(row);
});

router.delete('/:id', authorize('categories:write'), async (req, res) => {
  const id = idParam(req.params.id);
  if (await db.one('SELECT 1 FROM products WHERE category_id = $1 LIMIT 1', [id])) {
    throw new HttpError(409, 'Há produtos nesta categoria. Mova-os antes de excluir');
  }
  if (!(await db.run('DELETE FROM categories WHERE id = $1', [id]))) throw notFound('Categoria');
  res.status(204).end();
});
