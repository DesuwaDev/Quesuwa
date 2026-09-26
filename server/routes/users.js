import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { roles } from '../../shared/constants.js';
import { hashPassword, publicUser, validPassword, validUsername } from '../auth.js';
import { fail } from '../errors.js';
import { transaction } from '../db.js';

export function userRoutes({ db, auth, audit }) {
  const router = Router();
  const activeOwners = () => db.prepare("SELECT count(*) AS n FROM users WHERE role='owner' AND disabled=0").get().n;
  const find = id => {
    const row = auth.getUser(id);
    if (!row) throw fail(404, 'errors.userNotFound');
    return row;
  };
  const displayName = value => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim().length > 40) throw fail(400, 'errors.displayName');
    return value.trim();
  };

  router.get('/', (_req, res) => {
    const sessions = db.prepare('SELECT user_id, count(*) AS n FROM sessions WHERE expires_at>? GROUP BY user_id').all(Date.now());
    const counts = new Map(sessions.map(row => [row.user_id, row.n]));
    res.json(db.prepare('SELECT * FROM users ORDER BY created_at').all().map(row => ({ ...publicUser(row), sessions: counts.get(row.id) || 0 })));
  });

  router.post('/', (req, res) => {
    const { username, role, password } = req.body || {};
    if (!validUsername(username)) throw fail(400, 'errors.username');
    if (!roles.includes(role)) throw fail(400, 'errors.roleInvalid');
    if (!validPassword(password)) throw fail(400, 'errors.passwordLength');
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) throw fail(409, 'errors.usernameTaken');
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw fail(400, 'errors.notifyEmail');
    const id = randomUUID(), { salt, hash } = hashPassword(password);
    db.prepare('INSERT INTO users(id,username,display_name,email,role,salt,hash,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, username, displayName(req.body.displayName) || '', email, role, salt, hash, new Date().toISOString());
    audit(req, 'userCreated', id, username);
    res.status(201).json(publicUser(auth.getUser(id)));
  });

  router.patch('/:id', (req, res) => {
    const user = find(req.params.id);
    const role = req.body?.role ?? user.role;
    const disabled = req.body?.disabled ?? Boolean(user.disabled);
    if (!roles.includes(role) || typeof disabled !== 'boolean') throw fail(400, 'errors.roleInvalid');
    if (user.id === req.user.id && (role !== user.role || disabled)) throw fail(400, 'errors.selfChange');
    const name = displayName(req.body?.displayName) ?? user.display_name;
    transaction(db, () => {
      db.prepare('UPDATE users SET role=?, disabled=?, display_name=? WHERE id=?').run(role, disabled ? 1 : 0, name, user.id);
      if (!activeOwners()) throw fail(400, 'errors.lastOwner');
      if (disabled || role !== user.role) auth.sessions.removeForUser(user.id);
    });
    audit(req, 'userUpdated', user.id, user.username);
    res.json(publicUser(auth.getUser(user.id)));
  });

  // Owners can remove a member's second factor, e.g. after a lost phone.
  router.post('/:id/reset-2fa', (req, res) => {
    const user = find(req.params.id);
    db.prepare("UPDATE users SET totp_secret='', totp_pending='', totp_last_step=0, recovery_codes='[]' WHERE id=?").run(user.id);
    auth.sessions.removeForUser(user.id, user.id === req.user.id ? req.sessionToken : undefined);
    audit(req, 'twoFactorReset', user.id, user.username);
    res.json(publicUser(auth.getUser(user.id)));
  });

  router.post('/:id/password', (req, res) => {
    const user = find(req.params.id);
    if (!validPassword(req.body?.password)) throw fail(400, 'errors.passwordLength');
    const { salt, hash } = hashPassword(req.body.password);
    db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hash, user.id);
    auth.sessions.removeForUser(user.id, user.id === req.user.id ? req.sessionToken : undefined);
    audit(req, 'userPasswordReset', user.id, user.username);
    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    const user = find(req.params.id);
    if (user.id === req.user.id) throw fail(400, 'errors.selfChange');
    transaction(db, () => {
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM users WHERE id=?').run(user.id);
      if (!activeOwners()) throw fail(400, 'errors.lastOwner');
    });
    audit(req, 'userDeleted', user.id, user.username);
    res.json({ ok: true });
  });
  return router;
}
