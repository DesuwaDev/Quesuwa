import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, localeMiddleware, setServerLocale } from './i18n.js';
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
import { createSettings } from './services/settings.js';
import { createTickets } from './services/tickets.js';
import { ticketRoutes } from './routes/tickets.js';

const root = fileURLToPath(new URL('../', import.meta.url));

// Options left undefined are configured in the web UI (System → Settings);
// defined options come from the environment and lock the matching setting.
export function createApp({ dataDir, password, username = 'admin', production = false, publicOrigin = '', trustProxyHops, maxStorageMB, defaultLocale }) {
  if (password && password.length < 16) throw new Error(t('cli.passwordRequired'));
  if (publicOrigin) {
    let origin;
    try { origin = new URL(publicOrigin); } catch { throw new Error(t('errors.productionOrigin')); }
    if ((production && origin.protocol !== 'https:') || origin.origin !== publicOrigin) throw new Error(t('errors.productionOrigin'));
  }
  if (maxStorageMB !== undefined && (!Number.isInteger(maxStorageMB) || maxStorageMB < 1 || maxStorageMB > 1048576)) throw new Error(t('errors.storageConfig'));
  if (trustProxyHops !== undefined && (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5)) throw new Error(t('cli.proxyInvalid'));
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(dataDir);
  const settings = createSettings(db, { maxStorageMB, trustProxyHops, defaultLocale: defaultLocale || undefined });

  const app = express();
  app.disable('x-powered-by');
  settings.onChange(values => {
    app.set('trust proxy', values.trustProxyHops);
    setServerLocale(values.defaultLocale);
  });
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'blob:', 'data:'], 'script-src': ["'self'"], 'connect-src': ["'self'"], 'form-action': ["'self'"], 'object-src': ["'none'"] } } }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(localeMiddleware);
  app.use(express.json({ limit: '1mb' }));

  // With PUBLIC_ORIGIN the browser origin must match exactly; otherwise it must
  // point at the host the request was sent to, so it works behind any proxy.
  const originAllowed = req => {
    const origin = req.get('origin');
    if (!origin) return false;
    if (publicOrigin) return origin === publicOrigin;
    try { return new URL(origin).host === req.get('host'); } catch { return false; }
  };
  const secureCookie = req => req.secure || (production && publicOrigin.startsWith('https:'));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && !originAllowed(req)) return next(fail(403, 'errors.origin'));
    next();
  });
  const limiter = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => res.status(429).json({ code: 'errors.rateLimit', params: {}, error: t('errors.rateLimit') }) });

  const auth = configureAuth(db, { bootstrapPassword: password, bootstrapUsername: username });
  const audit = createAudit(db);
  const storage = createStorage(db, { dataDir, quotaMB: () => settings.values().maxStorageMB });
  const forms = createFormStore(db);
  const webhooks = createWebhooks(db);
  const tickets = createTickets(db);
  const cookieOptions = req => ({ httpOnly: true, sameSite: 'strict', secure: secureCookie(req), path: '/api/admin' });
  const context = { db, auth, audit, storage, forms, webhooks, tickets, limiter, cookieOptions, originAllowed, secureCookie, settings, publicOrigin };
  if (auth.setupNeeded()) console.log(t('cli.setupCode', { code: auth.setupCode() }));

  app.use('/api/forms', publicRoutes(context));
  app.use('/api/tickets', ticketRoutes(context));
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
  // Private follow-up pages must never be indexed.
  app.use('/t/', (_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.get(['/', '/admin', '/admin/*rest', '/f/:slug', '/t/:id'], (_req, res) => {
    if (!fs.existsSync(path.join(dist, 'index.html'))) return res.status(503).type('text').send(t('errors.frontendMissing'));
    res.sendFile(path.join(dist, 'index.html'));
  });
  app.use(errorHandler);
  return { app, close: () => db.close(), setupCode: () => auth.setupNeeded() ? auth.setupCode() : null };
}
