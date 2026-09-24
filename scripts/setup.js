import { t } from '../server/i18n.js';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));
const example = fileURLToPath(new URL('../.env.example', import.meta.url));
if (fs.existsSync(target)) {
  console.log(t('cli.preserved'));
} else {
  const config = fs.readFileSync(example, 'utf8').replace(/^\uFEFF/, '').replace(/^#? ?ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}`);
  fs.writeFileSync(target, config, { flag: 'wx', mode: 0o600 });
  console.log(t('cli.created'));
}
