import 'dotenv/config';
import { t } from './i18n.js';
import path from 'node:path';
import { createApp } from './app.js';
import { appVersion } from './version.js';
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '127.0.0.1';
const publicOrigin = (process.env.PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) throw new Error(t('cli.proxyInvalid'));
const instance = createApp({ dataDir: path.resolve(process.env.DATA_DIR || './data'), password: process.env.ADMIN_PASSWORD, username: (process.env.ADMIN_USERNAME || 'admin').trim(), production: process.env.NODE_ENV === 'production', maxStorageMB: Number(process.env.MAX_STORAGE_MB || 1024), publicOrigin, trustProxyHops });
const server = instance.app.listen(port, host, () => console.log(t('cli.listening', { url: publicOrigin || `http://${host}:${port}`, version: appVersion })));
server.requestTimeout = 120000;
server.headersTimeout = 30000;
server.maxHeadersCount = 100;
function stop() { server.close(() => { instance.close(); process.exit(0); }); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
