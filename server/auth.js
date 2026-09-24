import { scrypt, scryptSync, randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { can } from '../shared/constants.js';
import { fail } from './errors.js';

const derive = promisify(scrypt);
export const hashToken = value => createHash('sha256').update(String(value)).digest('hex');
export const SESSION_HOURS = 8;
export const REMEMBER_DAYS = 30;
export const COOKIE = 'quesuwa_session';
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export function hashPassword(value) {
  const salt = randomBytes(32).toString('hex');
  return { salt, hash: scryptSync(value, salt, 64).toString('hex') };
}

export const validPassword = value => typeof value === 'string' && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
export const validUsername = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,31}$/.test(value);

export function publicUser(row) {
  return row && { id: row.id, username: row.username, displayName: row.display_name, role: row.role, disabled: Boolean(row.disabled), createdAt: row.created_at, lastLoginAt: row.last_login_at };
}

export function configureAuth(db, { bootstrapPassword, bootstrapUsername = 'admin' }) {
  if (!db.prepare('SELECT count(*) AS n FROM users').get().n) {
    const { salt, hash } = hashPassword(bootstrapPassword);
    const username = validUsername(bootstrapUsername) ? bootstrapUsername : 'admin';
    db.prepare("INSERT INTO users(id,username,display_name,role,salt,hash,created_at) VALUES (?,?,'','owner',?,?,?)").run(randomUUID(), username, salt, hash, new Date().toISOString());
  }
  const dummy = hashPassword(randomBytes(16).toString('hex'));
  let activeChecks = 0;

  // Always derives a key, even for unknown users, so timing does not reveal accounts.
  async function verify(row, password) {
    if (typeof password !== 'string' || password.length < 1 || password.length > 512) return false;
    if (activeChecks >= 4) throw fail(429, 'errors.rateLimit');
    activeChecks++;
    try {
      const credential = row || dummy;
      const actual = await derive(password, credential.salt, 64);
      return Boolean(row) && !row.disabled && timingSafeEqual(Buffer.from(credential.hash, 'hex'), actual);
    } finally { activeChecks--; }
  }

  const findUser = username => typeof username === 'string' ? db.prepare('SELECT * FROM users WHERE username=?').get(username.trim()) : undefined;
  const getUser = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);

  const sessions = {
    create(userId, remember, userAgent) {
      const token = randomBytes(32).toString('hex');
      const lifetime = remember ? REMEMBER_DAYS * 24 * 3600_000 : SESSION_HOURS * 3600_000;
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      db.prepare('DELETE FROM sessions WHERE user_id=? AND token NOT IN (SELECT token FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 49)').run(userId, userId);
      db.prepare('INSERT INTO sessions(token,user_id,created_at,expires_at,user_agent) VALUES (?,?,?,?,?)').run(hashToken(token), userId, new Date().toISOString(), Date.now() + lifetime, String(userAgent || '').slice(0, 300));
      return { token, lifetime };
    },
    resolve(token) {
      if (!token) return null;
      const row = db.prepare('SELECT u.*, s.token AS session_token FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token=? AND s.expires_at>? AND u.disabled=0').get(hashToken(token), Date.now());
      return row || null;
    },
    remove(token) { if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token)); },
    removeForUser(userId, exceptToken) {
      if (exceptToken) db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(userId, hashToken(exceptToken));
      else db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    }
  };

  const sessionToken = req => /(?:^|;\s*)quesuwa_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];

  function requireUser(req, _res, next) {
    const token = sessionToken(req);
    const row = sessions.resolve(token);
    if (!row) return next(fail(401, 'errors.loginRequired'));
    req.user = publicUser(row);
    req.sessionToken = token;
    next();
  }

  const allow = permission => (req, _res, next) => next(can(req.user?.role, permission) ? undefined : fail(403, 'errors.forbidden'));

  return { verify, findUser, getUser, sessions, sessionToken, requireUser, allow, can: (req, permission) => can(req.user?.role, permission) };
}
