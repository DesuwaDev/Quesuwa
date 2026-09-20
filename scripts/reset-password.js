import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes } from 'node:crypto';
import { t } from '../server/i18n.js';
const databasePath = path.resolve(process.env.DATA_DIR || './data', 'report.sqlite');
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 16) throw new Error(t('cli.passwordRequired'));
if (!fs.existsSync(databasePath)) throw new Error(t('cli.databaseMissing'));
const db = new DatabaseSync(databasePath);
try {
  const salt = randomBytes(32).toString('hex');
  const hash = scryptSync(process.env.ADMIN_PASSWORD, salt, 64).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  db.prepare('UPDATE admin_credential SET salt=?,hash=? WHERE id=1').run(salt, hash);
  db.exec('DELETE FROM admin_sessions; COMMIT;');
  console.log(t('cli.passwordReset'));
} finally { db.close(); }
