// Solves built-in Cap challenges the same way the browser widget does, for tests.
import { createHash } from 'node:crypto';

function prng(seed, length) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  let state = hash >>> 0, result = '';
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  while (result.length < length) result += next().toString(16).padStart(8, '0');
  return result.substring(0, length);
}

export function solveCap({ token, challenge }) {
  const solutions = [];
  for (let i = 1; i <= challenge.c; i++) {
    const salt = prng(`${token}${i}`, challenge.s), target = prng(`${token}${i}d`, challenge.d);
    let nonce = 0;
    while (!createHash('sha256').update(salt + nonce).digest('hex').startsWith(target)) nonce++;
    solutions.push(nonce);
  }
  return { token, solutions };
}
