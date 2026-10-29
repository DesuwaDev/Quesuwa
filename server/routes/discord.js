import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { fail } from '../errors.js';
import { cookieValue, sessionCookie, stateCookie } from '../services/discord.js';

// Only questionnaire pages are valid places to come back to after signing in.
const safeReturn = value => typeof value === 'string' && value.length <= 4000 && /^\/f\/[a-z0-9][a-z0-9-]{1,63}(\?[^#\s\\]*)?$/.test(value) ? value : '/';

export function discordRoutes({ discord, limiter, secureCookie, publicOrigin }) {
  const router = Router();
  const redirectUri = req => `${publicOrigin || `${req.protocol}://${req.get('host')}`}/api/discord/callback`;
  const cookieOptions = (req, path, maxAge) => ({ httpOnly: true, sameSite: 'lax', secure: secureCookie(req), path, maxAge });

  router.get('/', (_req, res) => res.json({ configured: discord.configured() }));

  router.get('/login', limiter(15 * 60_000, 60), (req, res) => {
    if (!discord.configured()) throw fail(404, 'errors.discordUnavailable');
    const state = randomBytes(16).toString('base64url');
    res.cookie(stateCookie, `${state}.${Buffer.from(safeReturn(req.query.return)).toString('base64url')}`, cookieOptions(req, '/api/discord', 10 * 60_000));
    res.redirect(discord.authorizeLink(state, redirectUri(req)));
  });

  router.get('/callback', limiter(15 * 60_000, 60), async (req, res) => {
    const [state, encoded] = cookieValue(req.headers.cookie, stateCookie).split('.');
    const back = safeReturn(encoded ? Buffer.from(encoded, 'base64url').toString('utf8') : '');
    res.clearCookie(stateCookie, { path: '/api/discord' });
    if (!discord.configured() || !state || req.query.state !== state || typeof req.query.code !== 'string') return res.redirect(back + '#discord-failed');
    try {
      res.cookie(sessionCookie, discord.issue(await discord.exchange(req.query.code, redirectUri(req))), cookieOptions(req, '/api', discord.maxAge));
      res.redirect(back);
    } catch (error) {
      console.warn(error.code || error.message, error.params?.status ?? '');
      res.redirect(back + '#discord-failed');
    }
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(sessionCookie, { path: '/api' });
    res.json({ ok: true });
  });
  return router;
}
