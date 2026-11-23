import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db/index.js';
import { authenticate, publicRoute } from './middleware/auth.js';
import { sameOrigin } from './middleware/security.js';
import { errorHandler } from './middleware/errors.js';
import { HttpError } from './lib/errors.js';
import { router as authRoutes } from './routes/auth.js';
import { router as userRoutes } from './routes/users.js';
import { router as categoryRoutes } from './routes/categories.js';
import { router as productRoutes } from './routes/products.js';
import { router as lotRoutes } from './routes/lots.js';
import { router as dashboardRoutes } from './routes/dashboard.js';
import { router as reportRoutes } from './routes/reports.js';
import { router as fileRoutes } from './routes/files.js';
import { router as auditRoutes } from './routes/audit.js';

/** Rotas públicas: cada rota dentro delas precisa ser marcada com publicRoute ou ter authorize(). */
export const PUBLIC_ROUTERS = [['/auth', authRoutes]] as const;

/** Rotas que exigem login. O teste de segurança percorre esta lista e falha se alguma rota não tiver authorize(). */
export const PROTECTED_ROUTERS = [
  ['/users', userRoutes],
  ['/categories', categoryRoutes],
  ['/products', productRoutes],
  ['/lots', lotRoutes],
  ['/dashboard', dashboardRoutes],
  ['/reports', reportRoutes],
  ['/files', fileRoutes],
  ['/audit', auditRoutes],
] as const;

export function createApiRouter() {
  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
  api.use(sameOrigin);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.get('/health', publicRoute, async (_req, res) => {
    await db.one('SELECT 1');
    res.json({ status: 'ok' });
  });

  // Rotas públicas (login, esqueci a senha, convite). Cada uma é marcada com publicRoute.
  for (const [path, router] of PUBLIC_ROUTERS) api.use(path, router);

  // ===== Daqui pra baixo TUDO passa pelo middleware de acesso =====
  // 1) authenticate: lê o token (Bearer ou cookie) e confere o usuário no banco
  // 2) authorize('permissão'): declarado em cada rota, confere se o papel pode fazer aquilo
  api.use(authenticate);
  for (const [path, router] of PROTECTED_ROUTERS) api.use(path, router);
  api.use(() => {
    throw new HttpError(404, 'Rota não encontrada');
  });
  return api;
}

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'script-src': ["'self'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', createApiRouter());

  // No Docker o nginx (serviço "front") serve as telas; no `npm run dev` a própria API serve.
  if (config.serveStatic) {
    app.use(express.static(path.resolve('public'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));
  }
  app.use(errorHandler);
  return app;
}
