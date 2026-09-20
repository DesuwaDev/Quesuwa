import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));
const example = fileURLToPath(new URL('../.env.example', import.meta.url));
if (fs.existsSync(target)) {
  console.log('Quesuwa: .env already exists. Existing settings were preserved.');
} else {
  const config = fs.readFileSync(example, 'utf8').replace(/^\uFEFF/, '').replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}`);
  fs.writeFileSync(target, config, { flag: 'wx', mode: 0o600 });
  console.log('Quesuwa: created .env with a random admin password. Read ADMIN_PASSWORD in .env, then run npm run build and npm start.');
}
