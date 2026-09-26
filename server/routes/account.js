import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { COOKIE, hashToken, hashPassword, publicUser, validPassword, validUsername } from '../auth.js';
import { fail } from '../errors.js';
import { newSecret, verifyTotp, otpauthUrl, newRecoveryCodes, useRecoveryCode } from '../lib/totp.js';
import { parsePrefs } from '../services/notify.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A second factor is either a current TOTP code or an unused recovery code.
function checkSecondFactor(db, row, code) {
  const step = verifyTotp(row.totp_secret, code, row.totp_last_step);
  if (step !== null) {
    db.prepare('UPDATE users SET totp_last_step=? WHERE id=?').run(step, row.id);
    return true;
  }
  const remaining = useRecoveryCode(JSON.parse(row.recovery_codes || '[]'), code);
  if (!remaining) return false;
  db.prepare('UPDATE users SET recovery_codes=? WHERE id=?').run(JSON.stringify(remaining), row.id);
  return true;
}

export function publicAccountRoutes({ db, auth, cookieOptions, limiter, originAllowed, audit }) {
  const router = Router();
  // Password step passed, waiting for the second factor: challenge → { userId, remember, expires }.
  const challenges = new Map();

  function startSession(req, res, row, remember, status = 200) {
    auth.sessions.remove(auth.sessionToken(req));
    const { token, lifetime } = auth.sessions.create(row.id, remember, req.get('user-agent'));
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(), row.id);
    req.user = publicUser(row);
    audit(req, 'login', row.id, row.username);
    res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: lifetime }).status(status).json({ ok: true, user: publicUser(row) });
  }

  router.post('/login', limiter(15 * 60_000, 10), async (req, res) => {
    if (!originAllowed(req)) throw fail(403, 'errors.origin');
    const username = typeof req.body?.username === 'string' && req.body.username.trim() ? req.body.username : 'admin';
    const row = auth.findUser(username);
    if (!await auth.verify(row, req.body?.password)) throw fail(401, 'errors.password');
    const remember = req.body?.remember === true;
    if (row.totp_secret) {
      for (const [key, value] of challenges) if (value.expires < Date.now()) challenges.delete(key);
      const challenge = randomBytes(24).toString('base64url');
      challenges.set(challenge, { userId: row.id, remember, expires: Date.now() + 5 * 60_000, attempts: 0 });
      return res.json({ ok: false, twoFactor: true, challenge });
    }
    startSession(req, res, row, remember);
  });

  router.post('/login/2fa', limiter(15 * 60_000, 20), (req, res) => {
    if (!originAllowed(req)) throw fail(403, 'errors.origin');
    const pending = challenges.get(req.body?.challenge);
    if (!pending || pending.expires < Date.now()) throw fail(401, 'errors.twoFactorExpired');
    const row = auth.getUser(pending.userId);
    if (!row || row.disabled || !row.totp_secret) throw fail(401, 'errors.twoFactorExpired');
    if (!checkSecondFactor(db, row, String(req.body?.code ?? ''))) {
      if (++pending.attempts >= 5) challenges.delete(req.body.challenge);
      throw fail(401, 'errors.twoFactorCode');
    }
    challenges.delete(req.body.challenge);
    startSession(req, res, auth.getUser(row.id), pending.remember);
  });

  router.get('/setup', (_req, res) => res.json({ needed: auth.setupNeeded() }));

  router.post('/setup', limiter(15 * 60_000, 10), (req, res) => {
    if (!originAllowed(req)) throw fail(403, 'errors.origin');
    if (!auth.setupNeeded()) throw fail(409, 'errors.setupDone');
    const { code, username, password, displayName = '' } = req.body || {};
    if (!auth.checkSetupCode(code)) throw fail(403, 'errors.setupCode');
    if (!validUsername(username)) throw fail(400, 'errors.username');
    if (!validPassword(password)) throw fail(400, 'errors.passwordLength');
    if (typeof displayName !== 'string' || displayName.trim().length > 40) throw fail(400, 'errors.displayName');
    const row = auth.createOwner({ username, password, displayName: displayName.trim() });
    const { token, lifetime } = auth.sessions.create(row.id, false, req.get('user-agent'));
    req.user = publicUser(row);
    audit(req, 'setup', row.id, row.username);
    res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: lifetime }).status(201).json({ ok: true, user: publicUser(row) });
  });
  return router;
}

export function accountRoutes({ db, auth, cookieOptions, limiter, audit }) {
  const router = Router();
  const session = auth.sessionOnly;
  router.get('/session', (req, res) => res.json({ ok: true, user: req.user, via: req.apiToken ? 'token' : 'session' }));
  router.post('/logout', session, (req, res) => {
    auth.sessions.remove(req.sessionToken);
    res.clearCookie(COOKIE, cookieOptions(req)).json({ ok: true });
  });

  router.get('/me', session, (req, res) => {
    const row = auth.getUser(req.user.id);
    res.json({ user: publicUser(row), prefs: parsePrefs(row.notify_prefs), recoveryLeft: JSON.parse(row.recovery_codes || '[]').length });
  });

  router.patch('/me', session, (req, res) => {
    const body = req.body || {};
    const row = auth.getUser(req.user.id);
    const displayName = body.displayName === undefined ? row.display_name : typeof body.displayName === 'string' ? body.displayName.trim() : null;
    if (displayName === null || displayName.length > 40) throw fail(400, 'errors.displayName');
    const email = body.email === undefined ? row.email : typeof body.email === 'string' ? body.email.trim() : null;
    if (email === null || email.length > 254 || (email && !EMAIL.test(email))) throw fail(400, 'errors.notifyEmail');
    const prefs = body.notifyPrefs === undefined ? parsePrefs(row.notify_prefs) : parsePrefs(body.notifyPrefs);
    db.prepare('UPDATE users SET display_name=?, email=?, notify_prefs=? WHERE id=?').run(displayName, email, JSON.stringify(prefs), req.user.id);
    res.json({ ok: true, user: publicUser(auth.getUser(req.user.id)), prefs });
  });

  router.post('/password', session, limiter(15 * 60_000, 5), async (req, res) => {
    const next = req.body?.newPassword;
    if (!validPassword(next)) throw fail(400, 'errors.passwordLength');
    if (!await auth.verify(auth.getUser(req.user.id), req.body?.currentPassword)) throw fail(403, 'errors.currentPassword');
    const { salt, hash } = hashPassword(next);
    db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hash, req.user.id);
    auth.sessions.removeForUser(req.user.id);
    audit(req, 'passwordChanged', req.user.id, req.user.username);
    res.clearCookie(COOKIE, cookieOptions(req)).json({ ok: true });
  });

  // ---- Two-factor authentication ----
  router.post('/2fa/setup', session, (req, res) => {
    const row = auth.getUser(req.user.id);
    if (row.totp_secret) throw fail(409, 'errors.twoFactorEnabled');
    const secret = newSecret();
    db.prepare('UPDATE users SET totp_pending=? WHERE id=?').run(secret, row.id);
    res.json({ secret, url: otpauthUrl(secret, row.username, 'Quesuwa') });
  });

  router.post('/2fa/enable', session, limiter(15 * 60_000, 10), (req, res) => {
    const row = auth.getUser(req.user.id);
    if (!row.totp_pending) throw fail(400, 'errors.twoFactorSetup');
    const step = verifyTotp(row.totp_pending, req.body?.code);
    if (step === null) throw fail(400, 'errors.twoFactorCode');
    const { codes, hashes } = newRecoveryCodes();
    db.prepare("UPDATE users SET totp_secret=totp_pending, totp_pending='', totp_last_step=?, recovery_codes=? WHERE id=?").run(step, JSON.stringify(hashes), row.id);
    // Other devices must sign in again with the second factor.
    auth.sessions.removeForUser(row.id, req.sessionToken);
    audit(req, 'twoFactorEnabled', row.id, row.username);
    res.json({ ok: true, recoveryCodes: codes, user: publicUser(auth.getUser(row.id)) });
  });

  router.post('/2fa/recovery', session, limiter(15 * 60_000, 5), async (req, res) => {
    const row = auth.getUser(req.user.id);
    if (!row.totp_secret) throw fail(400, 'errors.twoFactorSetup');
    if (!await auth.verify(row, req.body?.password)) throw fail(403, 'errors.currentPassword');
    const { codes, hashes } = newRecoveryCodes();
    db.prepare('UPDATE users SET recovery_codes=? WHERE id=?').run(JSON.stringify(hashes), row.id);
    res.json({ recoveryCodes: codes });
  });

  router.post('/2fa/disable', session, limiter(15 * 60_000, 5), async (req, res) => {
    const row = auth.getUser(req.user.id);
    if (!await auth.verify(row, req.body?.password)) throw fail(403, 'errors.currentPassword');
    db.prepare("UPDATE users SET totp_secret='', totp_pending='', totp_last_step=0, recovery_codes='[]' WHERE id=?").run(row.id);
    audit(req, 'twoFactorDisabled', row.id, row.username);
    res.json({ ok: true, user: publicUser(auth.getUser(row.id)) });
  });

  // ---- API tokens ----
  router.get('/tokens', session, (req, res) => res.json(auth.tokens.list(req.user.id)));
  router.post('/tokens', session, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const scope = req.body?.scope;
    const days = req.body?.days === undefined || req.body.days === 0 ? 0 : Number(req.body.days);
    if (!name || name.length > 60 || !['read', 'write'].includes(scope) || !Number.isInteger(days) || days < 0 || days > 3650) throw fail(400, 'errors.tokenRequest');
    if (auth.tokens.list(req.user.id).length >= 20) throw fail(400, 'errors.tokenLimit');
    const created = auth.tokens.create(req.user.id, { name, scope, days });
    audit(req, 'tokenCreated', created.token.id, name);
    res.status(201).json(created);
  });
  router.delete('/tokens/:id', session, (req, res) => {
    if (!auth.tokens.revoke(req.user.id, req.params.id)) throw fail(404, 'errors.tokenNotFound');
    audit(req, 'tokenRevoked', req.params.id, '');
    res.json({ ok: true });
  });

  router.get('/sessions', session, (req, res) => {
    const current = hashToken(req.sessionToken);
    res.json(db.prepare('SELECT token, created_at AS createdAt, expires_at AS expiresAt, user_agent AS userAgent FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC').all(req.user.id, Date.now())
      .map(({ token, ...item }) => ({ ...item, id: token.slice(0, 16), current: token === current })));
  });
  router.post('/sessions/revoke', session, (req, res) => {
    auth.sessions.removeForUser(req.user.id, req.sessionToken);
    res.json({ ok: true });
  });
  router.delete('/sessions/:id', session, (req, res) => {
    if (!/^[a-f0-9]{16}$/.test(req.params.id)) throw fail(400, 'errors.badRequest');
    const current = hashToken(req.sessionToken);
    if (current.startsWith(req.params.id)) throw fail(400, 'errors.currentSession');
    db.prepare("DELETE FROM sessions WHERE user_id=? AND substr(token,1,16)=?").run(req.user.id, req.params.id);
    res.json({ ok: true });
  });
  return router;
}
