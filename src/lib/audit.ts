import type { Request } from 'express';
import { db } from '../db/index.js';

export async function audit(req: Request, action: string, detail?: Record<string, unknown>, userId = req.user?.id) {
  await db.run('INSERT INTO audit_log (user_id, action, detail, ip) VALUES ($1, $2, $3, $4)', [
    userId ?? null,
    action,
    detail ? JSON.stringify(detail) : null,
    req.ip ?? null,
  ]);
}
