// Discord sign-in for respondents. Only the "identify" scope is requested: the Discord user ID
// and names, never the email address. The session lives in a signed, HTTP-only cookie.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fail } from '../errors.js';

export const sessionCookie = 'quesuwa_discord';
export const stateCookie = 'quesuwa_discord_state';
const SESSION_MS = 7 * 24 * 3600_000;

export function cookieValue(header, name) {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(header || '');
  return match ? match[1] : '';
}

export function createDiscord(db, { clientId = '', clientSecret = '', apiBase = 'https://discord.com/api', authorizeUrl = 'https://discord.com/oauth2/authorize' } = {}) {
  let secret = db.prepare("SELECT value FROM settings WHERE key='discordSessionSecret'").get()?.value;
  if (secret) secret = JSON.parse(secret);
  else {
    secret = randomBytes(32).toString('hex');
    db.prepare("INSERT INTO settings(key, value) VALUES ('discordSessionSecret', ?)").run(JSON.stringify(secret));
  }
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  const configured = () => Boolean(clientId && clientSecret);

  function issue(user, now = Date.now()) {
    const payload = Buffer.from(JSON.stringify({ ...user, exp: now + SESSION_MS })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  /** The signed-in Discord user from the request cookies, or null. */
  function read(cookieHeader, now = Date.now()) {
    const [payload, signature] = cookieValue(cookieHeader, sessionCookie).split('.');
    if (!payload || !signature) return null;
    const expected = Buffer.from(sign(payload)), given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const { id, username, name, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return typeof id === 'string' && exp > now ? { id, username, name } : null;
    } catch { return null; }
  }

  function authorizeLink(state, redirectUri) {
    const url = new URL(authorizeUrl);
    url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: 'identify', state, redirect_uri: redirectUri, prompt: 'none' }).toString();
    return url.href;
  }

  async function exchange(code, redirectUri) {
    const token = await fetch(apiBase + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!token.ok) throw fail(502, 'errors.discordFailed', { status: token.status });
    const { access_token: accessToken } = await token.json();
    const me = await fetch(apiBase + '/users/@me', { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) });
    if (!me.ok) throw fail(502, 'errors.discordFailed', { status: me.status });
    const user = await me.json();
    if (typeof user?.id !== 'string') throw fail(502, 'errors.discordFailed', { status: me.status });
    return { id: user.id, username: String(user.username || ''), name: String(user.global_name || user.username || '') };
  }

  return { configured, issue, read, authorizeLink, exchange, maxAge: SESSION_MS };
}
