import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail } from '../errors.js';

export const MESSAGE_MAX = 5000;
const digest = value => createHash('sha256').update(String(value)).digest();

export function createTickets(db) {
  // Follow-up keys are derived from a per-installation secret so later emails can
  // include the link again. Only a hash of each key is stored with the response.
  let secret = db.prepare("SELECT value FROM settings WHERE key='ticketSecret'").get()?.value;
  if (secret) secret = JSON.parse(secret);
  else {
    secret = randomBytes(32).toString('hex');
    db.prepare("INSERT INTO settings(key, value) VALUES ('ticketSecret', ?)").run(JSON.stringify(secret));
  }
  const keyFor = id => createHmac('sha256', secret).update(id).digest('base64url').slice(0, 32);

  const issueKey = id => ({ key: keyFor(id), hash: digest(keyFor(id)).toString('hex') });

  // Keys from before derivation existed cannot be recreated; those links still work.
  const linkKey = row => row?.access_hash && timingSafeEqual(digest(keyFor(row.id)), Buffer.from(row.access_hash, 'hex')) ? keyFor(row.id) : null;

  function open(id, key) {
    const row = typeof id === 'string' ? db.prepare('SELECT * FROM responses WHERE id=? AND deleted_at IS NULL AND access_hash IS NOT NULL').get(id) : null;
    const valid = row && typeof key === 'string' && key.length <= 100 && timingSafeEqual(digest(key), Buffer.from(row.access_hash, 'hex'));
    if (!valid) throw fail(404, 'errors.ticketNotFound');
    return row;
  }

  const messages = responseId => db.prepare('SELECT id, author, author_name AS authorName, body, created_at AS createdAt, delivery FROM messages WHERE response_id=? ORDER BY created_at, rowid').all(responseId);

  function add(responseId, { author, userId = null, authorName = '', body, delivery = '' }) {
    const text = typeof body === 'string' ? body.trim() : '';
    if (author !== 'system' && (!text || text.length > MESSAGE_MAX)) throw fail(400, 'errors.messageInvalid', { max: MESSAGE_MAX });
    const message = { id: randomUUID(), author, authorName, body: text, createdAt: new Date().toISOString(), delivery };
    db.prepare('INSERT INTO messages(id,response_id,author,user_id,author_name,body,created_at,delivery) VALUES (?,?,?,?,?,?,?,?)').run(message.id, responseId, author, userId, authorName, text, message.createdAt, delivery);
    return message;
  }

  const setDelivery = (messageId, delivery) => db.prepare('UPDATE messages SET delivery=? WHERE id=?').run(delivery, messageId);
  const find = (responseId, messageId) => db.prepare('SELECT id, author, author_name AS authorName, body, created_at AS createdAt, delivery FROM messages WHERE id=? AND response_id=?').get(messageId, responseId);

  const removeFor = responseIds => {
    const statement = db.prepare('DELETE FROM messages WHERE response_id=?');
    for (const id of responseIds) statement.run(id);
  };

  return { issueKey, linkKey, open, messages, add, setDelivery, find, removeFor };
}
