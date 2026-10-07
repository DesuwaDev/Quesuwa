import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
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
import { captchaRoutes } from './routes/captcha.js';
import { createCaptcha } from './services/captcha.js';
import { overviewRoutes, systemRoutes } from './routes/system.js';
import { createSettings } from './services/settings.js';
import { createTickets } from './services/tickets.js';
import { ticketRoutes } from './routes/tickets.js';
import { createNotifier } from './services/notify.js';
import { notificationRoutes, messagingRoutes } from './routes/notifications.js';
import { createBackups, createRetention, createAutoClose, startJobs } from './services/backup.js';

const root = fileURLToPath(new URL('../', import.meta.url));

// Options left undefined are configured in the web UI (System → Settings);
// defined options come from the environment and lock the matching setting.
export function createApp({ dataDir, password, username = 'admin', production = false, publicOrigin = '', trustProxyHops, maxStorageMB, defaultLocale, captchaEndpoints }) {
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
  const captcha = createCaptcha(db, { endpoints: captchaEndpoints });
  // Verification widgets need their provider's origins; only the enabled ones are allowed.
  const captchaSources = kind => () => captcha.sources(kind) || "'self'";
  const scriptSources = (_req, res) => [captcha.sources('script'), res.locals.cspNonce ? `'nonce-${res.locals.cspNonce}' 'unsafe-eval'` : ''].filter(Boolean).join(' ') || "'self'";

  const app = express();
  app.disable('x-powered-by');
  settings.onChange(values => {
    app.set('trust proxy', values.trustProxyHops);
    setServerLocale(values.defaultLocale);
  });
  // A self-hosted Cap server may run a browser check: an inline script in a sandboxed frame that
  // inherits this page's CSP and uses eval. Only the pages that show the widget (questionnaires and
  // the workspace) get a fresh nonce plus eval, and only while such a server is in use; inline
  // scripts without the nonce stay blocked.
  app.use((req, res, next) => {
    if (req.method === 'GET' && (req.path.startsWith('/f/') || req.path === '/admin' || req.path.startsWith('/admin/')) && captcha.needsNonce()) res.locals.cspNonce = randomBytes(16).toString('base64');
    next();
  });
  app.use(helmet({ contentSecurityPolicy: { directives: {
    'img-src': ["'self'", 'blob:', 'data:', 'https:'], 'media-src': ["'self'", 'blob:'],
    'script-src': ["'self'", scriptSources], 'connect-src': ["'self'", captchaSources('connect')], 'frame-src': ["'self'", captchaSources('frame')], 'worker-src': ["'self'", captchaSources('worker')],
    'form-action': ["'self'"], 'object-src': ["'none'"]
  } } }));
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
  const notifier = createNotifier(db, { settings, tickets, forms, publicOrigin });
  const backups = createBackups(db, { dataDir, settings });
  const retention = createRetention(db, { storage, tickets, audit });
  const autoClose = createAutoClose(db, { tickets, audit });
  const stopJobs = startJobs([() => notifier.work(), () => notifier.conversationTick(), () => notifier.digestTick(), () => backups.tick(), () => retention.tick(), () => autoClose.tick()]);
  const cookieOptions = req => ({ httpOnly: true, sameSite: 'strict', secure: secureCookie(req), path: '/api/admin' });
  const context = { db, auth, audit, storage, forms, webhooks, tickets, notifier, backups, retention, captcha, limiter, cookieOptions, originAllowed, secureCookie, settings, publicOrigin };
  if (auth.setupNeeded()) console.log(t('cli.setupCode', { code: auth.setupCode() }));

  app.use('/api/forms', publicRoutes(context));
  app.use('/api/captcha', captchaRoutes(context));
  app.use('/api/tickets', ticketRoutes(context));
  app.use('/api/admin', publicAccountRoutes(context));
  app.use('/api/admin', auth.requireUser, (req, _res, next) => {
    // Every cookie-authenticated state change must come from this site; API tokens carry no ambient credentials.
    if (!req.apiToken && !['GET', 'HEAD'].includes(req.method) && !originAllowed(req)) return next(fail(403, 'errors.origin'));
    next();
  });
  app.use('/api/admin', accountRoutes(context));
  app.use('/api/admin', overviewRoutes(context));
  app.use('/api/admin/users', auth.sessionOnly, auth.allow('users.manage'), userRoutes(context));
  app.use('/api/admin/system', auth.sessionOnly, auth.allow('system.read'), systemRoutes(context));
  app.use('/api/admin/notifications', auth.sessionOnly, auth.allow('system.read'), notificationRoutes(context));
  app.use('/api/admin/messaging', messagingRoutes(context));
  app.use('/api/admin/forms', formRoutes(context));
  app.use('/api/admin', responseRoutes(context));
  app.get('/api/health', (_req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });
  app.use('/api', (_req, _res, next) => next(fail(404, 'errors.routeNotFound')));

  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false }));
  // Private follow-up pages must never be indexed.
  app.use('/t/', (_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  // The page shell is tiny and may carry a per-response nonce, so it is never cached.
  let shell = null;
  function pageShell() {
    const file = path.join(dist, 'index.html');
    const modified = fs.statSync(file).mtimeMs;
    if (!shell || shell.modified !== modified) shell = { modified, html: fs.readFileSync(file, 'utf8') };
    return shell.html;
  }
  app.get(['/', '/admin', '/admin/*rest', '/f/:slug', '/t/:id'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!fs.existsSync(path.join(dist, 'index.html'))) return res.status(503).type('text').send(t('errors.frontendMissing'));
    const nonce = res.locals.cspNonce;
    const html = pageShell();
    res.type('html').send(nonce ? html.replace(/<head[^>]*>/i, match => `${match}<meta name="cap-nonce" content="${nonce}">`) : html);
  });
  app.use(errorHandler);
  return { app, release: () => tickets.release(), close: () => { stopJobs(); notifier.close(); db.close(); }, notifier, backups, retention, autoClose, setupCode: () => auth.setupNeeded() ? auth.setupCode() : null };
}
