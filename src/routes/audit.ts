import { Router } from 'express';
import { z } from 'zod';
import { pageQuery, paginate, Where } from '../lib/pagination.js';
import { authorize } from '../middleware/auth.js';

export const router = Router();

const listQuery = pageQuery.extend({
  action: z.string().regex(/^[a-z_]{1,40}$/).optional(),
});

router.get('/', authorize('audit:read'), async (req, res) => {
  const { action, ...page } = listQuery.parse(req.query);
  const where = new Where();
  where.addIf(action, 'a.action = ?', action);
  res.json(
    await paginate(
      {
        select: 'a.id, a.action, a.detail, a.ip, a.created_at, u.name AS user_name, u.email AS user_email',
        from: `FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${where}`,
        orderBy: 'a.id DESC',
        params: where.params,
      },
      page,
    ),
  );
});
