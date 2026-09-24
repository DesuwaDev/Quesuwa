import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { t } from '../server/i18n.js';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const username = (process.env.ADMIN_USERNAME || 'admin').trim();
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 16) throw new Error(t('cli.passwordRequired'));
if (!fs.existsSync(path.join(dataDir, 'report.sqlite'))) throw new Error(t('cli.databaseMissing'));
const db = openDatabase(dataDir);
try {
  const { salt, hash } = hashPassword(process.env.ADMIN_PASSWORD);
  db.exec('BEGIN IMMEDIATE');
  const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  // Recovery always yields an enabled owner account so the workspace can be managed again.
  if (user) db.prepare("UPDATE users SET salt=?, hash=?, disabled=0, role='owner' WHERE id=?").run(salt, hash, user.id);
  else db.prepare("INSERT INTO users(id,username,display_name,role,salt,hash,created_at) VALUES (?,?,'','owner',?,?,?)").run(randomUUID(), username, salt, hash, new Date().toISOString());
  db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username=?)').run(username);
  db.exec('COMMIT');
  console.log(t('cli.passwordReset', { username }));
} finally { db.close(); }
