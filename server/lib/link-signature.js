// Signed questionnaire links. A site that shares a questionnaire's link secret adds `exp` (Unix
// seconds) and `sig` to the links it hands out, so staff can tell values that site put in the link
// (such as the signed-in user name) from ones typed or edited by hand.
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_QUERY = 4000;

/** What gets signed: every link parameter except `sig`, sorted by name and form-encoded. */
export function canonicalLinkQuery(params) {
  const entries = [...new URLSearchParams(params)].filter(([key]) => key !== 'sig');
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new URLSearchParams(entries).toString();
}

export function signLink(secret, params) {
  return createHmac('sha256', secret).update(canonicalLinkQuery(params)).digest('base64url');
}

/**
 * Checks the query string a questionnaire was opened with.
 * @returns {{ state: 'missing' | 'invalid' | 'expired' | 'verified', values?: Record<string, string>, expiresAt?: string }}
 */
export function checkLink(secret, query, now = Date.now()) {
  const params = new URLSearchParams(typeof query === 'string' && query.length <= MAX_QUERY ? query : '');
  const signatures = params.getAll('sig');
  if (!signatures.length) return { state: 'missing' };
  const expected = Buffer.from(signLink(secret, params));
  const given = Buffer.from(signatures[0]);
  if (signatures.length > 1 || given.length !== expected.length || !timingSafeEqual(given, expected)) return { state: 'invalid' };
  const exp = Number(params.get('exp'));
  if (!Number.isSafeInteger(exp) || exp <= 0) return { state: 'invalid' };
  const values = Object.fromEntries([...params].filter(([key]) => key !== 'sig' && key !== 'exp'));
  return { state: exp * 1000 < now ? 'expired' : 'verified', values, expiresAt: new Date(exp * 1000).toISOString() };
}
