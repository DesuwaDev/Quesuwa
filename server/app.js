import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, localeMiddleware } from './i18n.js';
import { openDatabase } from './db.js';
import { fail, errorHandler } from './errors.js';
import { configureAuth } from './auth.js';
import { createAudit } from './services/audit.js';
import { createStorage } from './services/storage.js';
import { createFormStore } from './services/forms.js';
import { createWebhooks } from './services/webhooks.js';
import { publicAccountRoutes, accountRoutes } from './routes/account.js';
import { userRoutes } from './routes/users.js';
import { formRoutes } from './routes/forms.js';
import { responseRoutes } from './routes/responses.js';
import { publicRoutes } from './routes/public.js';
import { overviewRoutes, systemRoutes } from './routes/system.js';

const root = fileURLToPath(new URL('../', import.meta.url));

export function createApp({ dataDir, password, username = 'admin', production = false, publicOrigin = '', trustProxyHops = 0, maxStorageMB = 1024 }) {
  if (!password || password.length < 16) throw new Error(t('cli.passwordRequired'));
  if (production) {
    let origin;
    try { origin = new URL(publicOrigin); } catch { throw new Error(t('errors.productionOrigin')); }
    if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) throw new Error(t('errors.productionOrigin'));
  }
  if (!Number.isInteger(maxStorageMB) || maxStorageMB < 1 || maxStorageMB > 1048576) throw new Error(t('errors.storageConfig'));
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(dataDir);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'blob:', 'data:'], 'script-src': ["'self'"], 'connect-src': ["'self'"], 'form-action': ["'self'"], 'object-src': ["'none'"] } } }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(localeMiddleware);
  app.use(express.json({ limit: '1mb' }));

  const originAllowed = req => {
    const origin = req.get('origin');
    if (!origin) return false;
    return origin === (publicOrigin || `${req.protocol}://${req.get('host')}`);
  };
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && !originAllowed(req)) return next(fail(403, 'errors.origin'));
    next();
  });
  const limiter = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => res.status(429).json({ code: 'errors.rateLimit', params: {}, error: t('errors.rateLimit') }) });

  const auth = configureAuth(db, { bootstrapPassword: password, bootstrapUsername: username });
  const audit = createAudit(db);
  const storage = createStorage(db, { dataDir, maxStorageMB });
  const forms = createFormStore(db);
  const webhooks = createWebhooks(db);
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: production, path: '/api/admin' };
  const context = { db, auth, audit, storage, forms, webhooks, limiter, cookieOptions, originAllowed, production };

  app.use('/api/forms', publicRoutes(context));
  app.use('/api/admin', publicAccountRoutes(context));
  app.use('/api/admin', auth.requireUser, (req, _res, next) => {
    // Every authenticated state change must come from this site.
    if (!['GET', 'HEAD'].includes(req.method) && !originAllowed(req)) return next(fail(403, 'errors.origin'));
    next();
  });
  app.use('/api/admin', accountRoutes(context));
  app.use('/api/admin', overviewRoutes(context));
  app.use('/api/admin/users', auth.allow('users.manage'), userRoutes(context));
  app.use('/api/admin/system', auth.allow('system.read'), systemRoutes(context));
  app.use('/api/admin/forms', formRoutes(context));
  app.use('/api/admin', responseRoutes(context));
  app.get('/api/health', (_req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });
  app.use('/api', (_req, _res, next) => next(fail(404, 'errors.routeNotFound')));

  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false }));
  app.get(['/', '/admin', '/admin/*rest', '/f/:slug'], (_req, res) => {
    if (!fs.existsSync(path.join(dist, 'index.html'))) return res.status(503).type('text').send(t('errors.frontendMissing'));
    res.sendFile(path.join(dist, 'index.html'));
  });
  app.use(errorHandler);
  return { app, close: () => db.close() };
}
