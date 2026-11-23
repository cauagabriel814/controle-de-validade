import { Router } from 'express';
import { db } from '../db/index.js';
import { addDays, lastMonths, today } from '../lib/dates.js';
import { authorize } from '../middleware/auth.js';

export const router = Router();

router.get('/', authorize('lots:read'), async (_req, res) => {
  const t = today();
  const d7 = addDays(t, 7);
  const d15 = addDays(t, 15);
  const [prevMonth, thisMonth] = lastMonths(2) as [string, string];

  const [summary, money, catalog] = await Promise.all([
    // Faixas sem sobreposição: vencidos | 0–7 dias | 8–15 dias.
    db.one<Record<string, number>>(
      `SELECT
         count(*) FILTER (WHERE l.expiry_date < $1)::int                              AS expired,
         count(*) FILTER (WHERE l.expiry_date BETWEEN $1 AND $2)::int                 AS "within7",
         count(*) FILTER (WHERE l.expiry_date > $2 AND l.expiry_date <= $3)::int      AS "within15",
         count(*) FILTER (WHERE l.in_promo)::int                                      AS "inPromo",
         coalesce(sum(l.quantity * coalesce(l.cost_price, l.sale_price, 0))
                  FILTER (WHERE l.expiry_date <= $2), 0)                              AS "valueAtRisk"
       FROM lots l JOIN products p ON p.id = l.product_id
       WHERE p.active AND l.quantity > 0`,
      [t, d7, d15],
    ),
    db.one<Record<string, number>>(
      `SELECT
         coalesce(sum(quantity * unit_value) FILTER (WHERE type = 'perda' AND to_char(occurred_on, 'YYYY-MM') = $1), 0) AS "lossThisMonth",
         coalesce(sum(quantity * unit_value) FILTER (WHERE type = 'perda' AND to_char(occurred_on, 'YYYY-MM') = $2), 0) AS "lossPrevMonth",
         coalesce(sum(quantity * unit_value) FILTER (WHERE type = 'venda' AND in_promo AND to_char(occurred_on, 'YYYY-MM') = $1), 0) AS "recoveredThisMonth"
       FROM movements WHERE occurred_on >= $3`,
      [thisMonth, prevMonth, `${prevMonth}-01`],
    ),
    db.one<Record<string, number>>(
      `SELECT count(*)::int AS products,
              (SELECT count(*)::int FROM lots l JOIN products p2 ON p2.id = l.product_id WHERE p2.active AND l.quantity > 0) AS "openLots"
       FROM products WHERE active`,
    ),
  ]);

  res.json({ today: t, ...summary, ...money, ...catalog });
});
