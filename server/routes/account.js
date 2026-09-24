import { Router } from 'express';
import { COOKIE, hashToken, hashPassword, publicUser, validPassword, validUsername } from '../auth.js';
import { fail } from '../errors.js';

export function publicAccountRoutes({ db, auth, cookieOptions, limiter, originAllowed, audit }) {
  const router = Router();
  router.post('/login', limiter(15 * 60_000, 10), async (req, res) => {
    if (!originAllowed(req)) throw fail(403, 'errors.origin');
    const username = typeof req.body?.username === 'string' && req.body.username.trim() ? req.body.username : 'admin';
    const row = auth.findUser(username);
    if (!await auth.verify(row, req.body?.password)) throw fail(401, 'errors.password');
    auth.sessions.remove(auth.sessionToken(req));
    const remember = req.body?.remember === true;
    const { token, lifetime } = auth.sessions.create(row.id, remember, req.get('user-agent'));
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(), row.id);
    req.user = publicUser(row);
    audit(req, 'login', row.id, row.username);
    res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: lifetime }).json({ ok: true, user: publicUser(row) });
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
  router.get('/session', (req, res) => res.json({ ok: true, user: req.user }));
  router.post('/logout', (req, res) => {
    auth.sessions.remove(req.sessionToken);
    res.clearCookie(COOKIE, cookieOptions(req)).json({ ok: true });
  });
  router.patch('/me', (req, res) => {
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : null;
    if (displayName === null || displayName.length > 40) throw fail(400, 'errors.displayName');
    db.prepare('UPDATE users SET display_name=? WHERE id=?').run(displayName, req.user.id);
    res.json({ ok: true, user: publicUser(auth.getUser(req.user.id)) });
  });
  router.post('/password', limiter(15 * 60_000, 5), async (req, res) => {
    const next = req.body?.newPassword;
    if (!validPassword(next)) throw fail(400, 'errors.passwordLength');
    if (!await auth.verify(auth.getUser(req.user.id), req.body?.currentPassword)) throw fail(403, 'errors.currentPassword');
    const { salt, hash } = hashPassword(next);
    db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hash, req.user.id);
    auth.sessions.removeForUser(req.user.id);
    audit(req, 'passwordChanged', req.user.id, req.user.username);
    res.clearCookie(COOKIE, cookieOptions(req)).json({ ok: true });
  });
  router.get('/sessions', (req, res) => {
    const current = hashToken(req.sessionToken);
    res.json(db.prepare('SELECT token, created_at AS createdAt, expires_at AS expiresAt, user_agent AS userAgent FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC').all(req.user.id, Date.now())
      .map(({ token, ...session }) => ({ ...session, id: token.slice(0, 16), current: token === current })));
  });
  router.post('/sessions/revoke', (req, res) => {
    auth.sessions.removeForUser(req.user.id, req.sessionToken);
    res.json({ ok: true });
  });
  router.delete('/sessions/:id', (req, res) => {
    if (!/^[a-f0-9]{16}$/.test(req.params.id)) throw fail(400, 'errors.badRequest');
    const current = hashToken(req.sessionToken);
    if (current.startsWith(req.params.id)) throw fail(400, 'errors.currentSession');
    db.prepare("DELETE FROM sessions WHERE user_id=? AND substr(token,1,16)=?").run(req.user.id, req.params.id);
    res.json({ ok: true });
  });
  return router;
}
