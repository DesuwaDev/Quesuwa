import { scrypt, scryptSync, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const hashToken = value => createHash('sha256').update(value).digest('hex');
export function configureAuth(db, password) {
  db.exec(`CREATE TABLE IF NOT EXISTS admin_credential (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_sessions (token TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS session_expiry ON admin_sessions(expires_at);`);
  function setPassword(value) {
    const salt = randomBytes(32).toString('hex');
    const hash = scryptSync(value, salt, 64).toString('hex');
    db.prepare('INSERT OR REPLACE INTO admin_credential(id,salt,hash) VALUES (1,?,?)').run(salt, hash);
  }
  if (!db.prepare('SELECT id FROM admin_credential WHERE id=1').get()) setPassword(password);
  const sessions = {
    get(token) { return db.prepare('SELECT expires_at FROM admin_sessions WHERE token=?').get(hashToken(token))?.expires_at; },
    delete(token) { db.prepare('DELETE FROM admin_sessions WHERE token=?').run(hashToken(token)); },
    clear() { db.exec('DELETE FROM admin_sessions'); },
    set(token, expiry) { db.prepare('INSERT INTO admin_sessions(token,created_at,expires_at) VALUES (?,?,?)').run(hashToken(token), new Date().toISOString(), expiry); },
    prune() {
      db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now());
      db.exec('DELETE FROM admin_sessions WHERE token NOT IN (SELECT token FROM admin_sessions ORDER BY created_at DESC LIMIT 99)');
    }
  };
  let activeChecks = 0;
  async function verify(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 512) return false;
    if (activeChecks >= 4) return false;
    activeChecks++;
    try {
      const credential = db.prepare('SELECT salt,hash FROM admin_credential WHERE id=1').get();
      const actual = await derive(value, credential.salt, 64);
      return timingSafeEqual(Buffer.from(credential.hash, 'hex'), actual) && db.prepare('SELECT hash FROM admin_credential WHERE id=1').get().hash === credential.hash;
    } finally { activeChecks--; }
  }
  return { sessions, verify, setPassword, hashToken };
}
