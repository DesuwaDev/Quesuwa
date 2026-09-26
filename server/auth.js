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
  return row && { id: row.id, username: row.username, displayName: row.display_name, email: row.email || '', role: row.role, disabled: Boolean(row.disabled), twoFactor: Boolean(row.totp_secret), createdAt: row.created_at, lastLoginAt: row.last_login_at };
}

export function configureAuth(db, { bootstrapPassword, bootstrapUsername = 'admin' }) {
  if (bootstrapPassword && !db.prepare('SELECT count(*) AS n FROM users').get().n) {
    const { salt, hash } = hashPassword(bootstrapPassword);
    const username = validUsername(bootstrapUsername) ? bootstrapUsername : 'admin';
    db.prepare("INSERT INTO users(id,username,display_name,role,salt,hash,created_at) VALUES (?,?,'','owner',?,?,?)").run(randomUUID(), username, salt, hash, new Date().toISOString());
  }
  const dummy = hashPassword(randomBytes(16).toString('hex'));

  // Without a bootstrap password the first owner is created in the web UI,
  // guarded by a one-time code printed to the server log.
  let pendingCode = null;
  const setupNeeded = () => !db.prepare('SELECT count(*) AS n FROM users').get().n;
  function setupCode() {
    if (!pendingCode) {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      pendingCode = [...randomBytes(10)].map(value => alphabet[value % alphabet.length]).join('');
    }
    return pendingCode;
  }
  function checkSetupCode(value) {
    if (!pendingCode || typeof value !== 'string') return false;
    const normalized = value.trim().toUpperCase().replace(/[\s-]/g, '');
    return timingSafeEqual(createHash('sha256').update(normalized).digest(), createHash('sha256').update(pendingCode).digest());
  }
  function createOwner({ username, password, displayName }) {
    const id = randomUUID(), { salt, hash } = hashPassword(password);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!setupNeeded()) throw fail(409, 'errors.setupDone');
      db.prepare("INSERT INTO users(id,username,display_name,role,salt,hash,created_at) VALUES (?,?,?,'owner',?,?,?)").run(id, username, displayName, salt, hash, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    pendingCode = null;
    return getUser(id);
  }
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

  // ---- Personal API tokens: "Authorization: Bearer qsw_…" ----
  const tokens = {
    create(userId, { name, scope, days }) {
      const secret = 'qsw_' + randomBytes(30).toString('base64url');
      const id = randomUUID(), now = new Date();
      const expiresAt = days ? new Date(now.getTime() + days * 86400_000).toISOString() : null;
      db.prepare('INSERT INTO api_tokens(id,user_id,name,token_hash,prefix,scope,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(id, userId, name, hashToken(secret), secret.slice(0, 10), scope, now.toISOString(), expiresAt);
      return { secret, token: tokens.list(userId).find(item => item.id === id) };
    },
    list: userId => db.prepare('SELECT id, name, prefix, scope, created_at AS createdAt, last_used_at AS lastUsedAt, expires_at AS expiresAt FROM api_tokens WHERE user_id=? ORDER BY created_at DESC').all(userId),
    revoke: (userId, id) => db.prepare('DELETE FROM api_tokens WHERE id=? AND user_id=?').run(id, userId).changes,
    resolve(secret) {
      if (typeof secret !== 'string' || !/^qsw_[A-Za-z0-9_-]{40}$/.test(secret)) return null;
      const row = db.prepare('SELECT t.id AS token_id, t.scope, t.expires_at, t.last_used_at, u.* FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND u.disabled=0').get(hashToken(secret));
      if (!row || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null;
      if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 5 * 60_000) db.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(new Date().toISOString(), row.token_id);
      return row;
    }
  };

  function requireUser(req, _res, next) {
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '')?.[1];
    if (bearer) {
      const row = tokens.resolve(bearer);
      if (!row) return next(fail(401, 'errors.tokenInvalid'));
      req.user = publicUser(row);
      req.apiToken = { id: row.token_id, scope: row.scope };
      // Read-only tokens may only read.
      if (row.scope !== 'write' && !['GET', 'HEAD'].includes(req.method)) return next(fail(403, 'errors.tokenReadOnly'));
      return next();
    }
    const token = sessionToken(req);
    const row = sessions.resolve(token);
    if (!row) return next(fail(401, 'errors.loginRequired'));
    req.user = publicUser(row);
    req.sessionToken = token;
    next();
  }

  // Account security, members, secrets and backups are never reachable with an API token.
  const sessionOnly = (req, _res, next) => next(req.apiToken ? fail(403, 'errors.tokenNotAllowed') : undefined);

  const allow = permission => (req, _res, next) => next(can(req.user?.role, permission) ? undefined : fail(403, 'errors.forbidden'));

  return { verify, findUser, getUser, sessions, sessionToken, requireUser, sessionOnly, tokens, allow, setupNeeded, setupCode, checkSetupCode, createOwner, can: (req, permission) => can(req.user?.role, permission) };
}
