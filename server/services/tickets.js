import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail } from '../errors.js';

export const MESSAGE_MAX = 5000;
const digest = value => createHash('sha256').update(String(value)).digest();

export function createTickets(db) {
  const issueKey = () => {
    const key = randomBytes(24).toString('base64url');
    return { key, hash: digest(key).toString('hex') };
  };

  // Keys are only stored as hashes and compared in constant time.
  function open(id, key) {
    const row = typeof id === 'string' ? db.prepare('SELECT * FROM responses WHERE id=? AND deleted_at IS NULL AND access_hash IS NOT NULL').get(id) : null;
    const valid = row && typeof key === 'string' && key.length <= 100 && timingSafeEqual(digest(key), Buffer.from(row.access_hash, 'hex'));
    if (!valid) throw fail(404, 'errors.ticketNotFound');
    return row;
  }

  const messages = responseId => db.prepare('SELECT id, author, author_name AS authorName, body, created_at AS createdAt FROM messages WHERE response_id=? ORDER BY created_at, rowid').all(responseId);

  function add(responseId, { author, userId = null, authorName = '', body }) {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text || text.length > MESSAGE_MAX) throw fail(400, 'errors.messageInvalid', { max: MESSAGE_MAX });
    const message = { id: randomUUID(), author, authorName, body: text, createdAt: new Date().toISOString() };
    db.prepare('INSERT INTO messages(id,response_id,author,user_id,author_name,body,created_at) VALUES (?,?,?,?,?,?,?)').run(message.id, responseId, author, userId, authorName, text, message.createdAt);
    return message;
  }

  const removeFor = responseIds => {
    const statement = db.prepare('DELETE FROM messages WHERE response_id=?');
    for (const id of responseIds) statement.run(id);
  };

  return { issueKey, open, messages, add, removeFor };
}
