// Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s) and recovery codes.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30_000;

function encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decode(text) {
  let bits = 0, value = 0;
  const output = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(output);
}

export const newSecret = () => encode(randomBytes(20));

export function hotp(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', decode(secret)).update(message).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// Returns the matched time step (to block replay) or null. Allows ±1 step of clock drift.
export function verifyTotp(secret, code, lastStep = 0, now = Date.now()) {
  const value = String(code ?? '').replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(value)) return null;
  const step = Math.floor(now / STEP);
  for (const candidate of [step - 1, step, step + 1]) {
    if (candidate <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, candidate)), Buffer.from(value))) return candidate;
  }
  return null;
}

export const otpauthUrl = (secret, account, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

const hashCode = code => createHash('sha256').update(code.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

export function newRecoveryCodes(count = 10) {
  const codes = Array.from({ length: count }, () => {
    const raw = encode(randomBytes(5)).toLowerCase().slice(0, 8);
    return raw.slice(0, 4) + '-' + raw.slice(4);
  });
  return { codes, hashes: codes.map(hashCode) };
}

// Returns the remaining hashes when the code matches, otherwise null.
export function useRecoveryCode(hashes, code) {
  if (typeof code !== 'string' || code.length > 20) return null;
  const hash = hashCode(code);
  const index = hashes.indexOf(hash);
  return index < 0 ? null : hashes.filter((_, position) => position !== index);
}
