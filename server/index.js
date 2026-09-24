import 'dotenv/config';
import { t } from './i18n.js';
import path from 'node:path';
import { createApp } from './app.js';
import { appVersion } from './version.js';

// Every variable is optional; unset values fall back to web UI settings or defaults.
const env = name => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
};
const integer = name => env(name) === undefined ? undefined : Number(env(name));
const port = Number(env('PORT') || 3100);
const host = env('HOST') || '127.0.0.1';
const publicOrigin = (env('PUBLIC_ORIGIN') || '').replace(/\/$/, '');
const instance = createApp({
  dataDir: path.resolve(env('DATA_DIR') || './data'),
  password: env('ADMIN_PASSWORD'),
  username: env('ADMIN_USERNAME') || 'admin',
  production: env('NODE_ENV') === 'production',
  publicOrigin,
  trustProxyHops: integer('TRUST_PROXY_HOPS'),
  maxStorageMB: integer('MAX_STORAGE_MB'),
  defaultLocale: env('DEFAULT_LOCALE')
});
const server = instance.app.listen(port, host, () => console.log(t('cli.listening', { url: publicOrigin || `http://${host}:${port}`, version: appVersion })));
server.requestTimeout = 120000;
server.headersTimeout = 30000;
server.maxHeadersCount = 100;
function stop() { server.close(() => { instance.close(); process.exit(0); }); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
