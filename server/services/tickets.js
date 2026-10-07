import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail } from '../errors.js';
import { createLive } from '../lib/live.js';

export const MESSAGE_MAX = 5000;
export const RESPONDENT_BURST = 30;
const RESPONDENT_WINDOW_MS = 60 * 60_000;
const digest = value => createHash('sha256').update(String(value)).digest();

export function createTickets(db) {
  // Open conversations wait on this hub so new messages arrive without reloading.
  const live = createLive();

  // Follow-up keys are derived from a per-installation secret so later emails can
  // include the link again. Only a hash of each key is stored with the response.
  let secret = db.prepare("SELECT value FROM settings WHERE key='ticketSecret'").get()?.value;
  if (secret) secret = JSON.parse(secret);
  else {
    secret = randomBytes(32).toString('hex');
    db.prepare("INSERT INTO settings(key, value) VALUES ('ticketSecret', ?)").run(JSON.stringify(secret));
  }
  // Generation 0 keeps the original derivation, so links already sent keep working.
  const keyFor = (id, generation = 0) => createHmac('sha256', secret).update(generation ? `${id}#${generation}` : id).digest('base64url').slice(0, 32);

  const issueKey = (id, generation = 0) => ({ key: keyFor(id, generation), hash: digest(keyFor(id, generation)).toString('hex') });

  // Keys from before derivation existed cannot be recreated; those links still work.
  const linkKey = row => {
    const key = row?.access_hash ? keyFor(row.id, row.access_generation || 0) : null;
    return key && timingSafeEqual(digest(key), Buffer.from(row.access_hash, 'hex')) ? key : null;
  };

  // Staff can cut a follow-up link off, or replace it: a new generation invalidates every
  // earlier link. Open respondent pages re-check their key on the change and stop.
  function revokeLink(responseId) {
    db.prepare('UPDATE responses SET access_hash=NULL WHERE id=?').run(responseId);
    live.changed(responseId);
  }
  function reissueLink(responseId) {
    const generation = (db.prepare('SELECT access_generation FROM responses WHERE id=?').get(responseId)?.access_generation || 0) + 1;
    db.prepare('UPDATE responses SET access_generation=?, access_hash=? WHERE id=?').run(generation, issueKey(responseId, generation).hash, responseId);
    live.changed(responseId);
  }

  // Respondents get a burst of messages per hour, and a staff reply starts a fresh allowance.
  function assertRespondentQuota(responseId, now = Date.now()) {
    const lastStaff = db.prepare("SELECT max(created_at) AS at FROM messages WHERE response_id=? AND author='staff'").get(responseId)?.at;
    const since = new Date(Math.max(now - RESPONDENT_WINDOW_MS, lastStaff ? Date.parse(lastStaff) : 0)).toISOString();
    const sent = db.prepare("SELECT count(*) AS n FROM messages WHERE response_id=? AND author='respondent' AND created_at > ?").get(responseId, since).n;
    if (sent >= RESPONDENT_BURST) throw fail(429, 'errors.ticketTooFast');
  }

  function open(id, key) {
    const row = typeof id === 'string' ? db.prepare('SELECT * FROM responses WHERE id=? AND deleted_at IS NULL AND access_hash IS NOT NULL').get(id) : null;
    const valid = row && typeof key === 'string' && key.length <= 100 && timingSafeEqual(digest(key), Buffer.from(row.access_hash, 'hex'));
    if (!valid) throw fail(404, 'errors.ticketNotFound');
    return row;
  }

  const COLUMNS = `id, author, author_name AS authorName, body, created_at AS createdAt, delivery, edited_at AS editedAt, edited_by AS editedBy,
    original_body AS originalBody, deleted_at AS deletedAt, deleted_by AS deletedBy, read_at AS readAt, attachments`;
  const shape = row => row && { ...row, attachments: JSON.parse(row.attachments || '[]') };

  // Staff see everything: retracted messages, edit history and read receipts.
  const messages = responseId => db.prepare(`SELECT ${COLUMNS} FROM messages WHERE response_id=? ORDER BY created_at, rowid`).all(responseId).map(shape);

  // Respondents see only the current text; retractions and edits leave no trace for them.
  const publicMessages = responseId => messages(responseId).filter(message => !message.deletedAt).map(({ id, author, authorName, body, createdAt, attachments }) => ({
    id, author, authorName: author === 'staff' ? authorName : '', body, createdAt, attachments: attachments.map(({ id: fileId, name, mime, size }) => ({ id: fileId, name, mime, size }))
  }));

  function add(responseId, { author, userId = null, authorName = '', body, delivery = '', attachments = [] }) {
    const text = typeof body === 'string' ? body.trim() : '';
    if (author !== 'system' && ((!text && !attachments.length) || text.length > MESSAGE_MAX)) throw fail(400, 'errors.messageInvalid', { max: MESSAGE_MAX });
    const message = { id: randomUUID(), author, authorName, body: text, createdAt: new Date().toISOString(), delivery, attachments };
    db.prepare('INSERT INTO messages(id,response_id,author,user_id,author_name,body,created_at,delivery,attachments) VALUES (?,?,?,?,?,?,?,?,?)').run(message.id, responseId, author, userId, authorName, text, message.createdAt, delivery, JSON.stringify(attachments));
    live.changed(responseId);
    return message;
  }

  const editable = (responseId, messageId) => {
    const row = db.prepare('SELECT * FROM messages WHERE id=? AND response_id=?').get(messageId, responseId);
    if (!row || row.author === 'system') throw fail(404, 'errors.messageNotFound');
    return row;
  };

  // Staff corrections keep the first version so the team can still see what was originally said.
  function edit(responseId, messageId, body, editor) {
    const row = editable(responseId, messageId);
    const text = typeof body === 'string' ? body.trim() : '';
    if (text.length > MESSAGE_MAX || (!text && JSON.parse(row.attachments).length === 0)) throw fail(400, 'errors.messageInvalid', { max: MESSAGE_MAX });
    if (text !== row.body) {
      db.prepare('UPDATE messages SET body=?, edited_at=?, edited_by=?, original_body=COALESCE(original_body, body) WHERE id=?').run(text, new Date().toISOString(), editor, messageId);
      live.changed(responseId);
    }
    return find(responseId, messageId);
  }

  // Retracted messages disappear for the respondent but stay visible, marked, for staff.
  function retract(responseId, messageId, editor, retracted = true) {
    editable(responseId, messageId);
    db.prepare('UPDATE messages SET deleted_at=?, deleted_by=? WHERE id=?').run(retracted ? new Date().toISOString() : null, retracted ? editor : '', messageId);
    live.changed(responseId);
    return find(responseId, messageId);
  }

  // Read receipts: the respondent's page reports messages that were actually on screen.
  function markRead(responseId, ids) {
    if (!Array.isArray(ids)) return 0;
    const now = new Date().toISOString();
    const statement = db.prepare("UPDATE messages SET read_at=? WHERE id=? AND response_id=? AND author<>'respondent' AND read_at IS NULL AND deleted_at IS NULL");
    let changed = 0;
    for (const id of ids.filter(item => typeof item === 'string' && item.length <= 64).slice(0, 200)) changed += statement.run(now, id, responseId).changes;
    if (changed) live.changed(responseId);
    return changed;
  }

  // Finds an attachment; respondents cannot reach files of retracted messages.
  function fileOf(responseId, fileId, { staff = false } = {}) {
    for (const message of messages(responseId)) {
      if (message.deletedAt && !staff) continue;
      const file = message.attachments.find(item => item.id === fileId);
      if (file) return file;
    }
    return null;
  }

  function setDelivery(messageId, delivery) {
    db.prepare('UPDATE messages SET delivery=? WHERE id=?').run(delivery, messageId);
    const owner = db.prepare('SELECT response_id FROM messages WHERE id=?').get(messageId);
    if (owner) live.changed(owner.response_id);
  }

  // A send retried after a network error carries the same key; the first stored message is reused.
  const SEND_KEY = /^[A-Za-z0-9_-]{8,64}$/;
  const sent = new Map();
  function recall(responseId, key) {
    if (typeof key !== 'string' || !SEND_KEY.test(key)) return null;
    const entry = sent.get(responseId + ':' + key);
    return entry && Date.now() - entry.at < 10 * 60_000 ? entry.messageId : null;
  }
  function remember(responseId, key, messageId) {
    if (typeof key !== 'string' || !SEND_KEY.test(key)) return;
    sent.set(responseId + ':' + key, { messageId, at: Date.now() });
    while (sent.size > 5000) sent.delete(sent.keys().next().value);
  }

  // Short fingerprint of everything a conversation view shows; clients wait until it differs.
  function revision(responseId) {
    const row = db.prepare('SELECT status, unread, files_disabled FROM responses WHERE id=?').get(responseId);
    const list = db.prepare('SELECT id, delivery, edited_at, deleted_at, read_at FROM messages WHERE response_id=? ORDER BY created_at, rowid').all(responseId)
      .map(item => [item.id, item.delivery, item.edited_at, item.deleted_at, item.read_at].join(':'));
    return createHash('sha1').update(JSON.stringify([row?.status ?? '', row?.unread ?? 0, row?.files_disabled ?? 0, list])).digest('base64url').slice(0, 16);
  }
  const find = (responseId, messageId) => shape(db.prepare(`SELECT ${COLUMNS} FROM messages WHERE id=? AND response_id=?`).get(messageId, responseId));

  // Deleting conversations also queues their attachments for removal from disk.
  const removeFor = responseIds => {
    const files = db.prepare('SELECT attachments FROM messages WHERE response_id=?');
    const cleanup = db.prepare('INSERT OR IGNORE INTO file_cleanup(id) VALUES (?)');
    const statement = db.prepare('DELETE FROM messages WHERE response_id=?');
    for (const id of responseIds) {
      for (const row of files.all(id)) for (const file of JSON.parse(row.attachments || '[]')) cleanup.run(file.id);
      statement.run(id);
    }
  };

  return { issueKey, linkKey, revokeLink, reissueLink, assertRespondentQuota, open, messages, publicMessages, add, edit, retract, markRead, fileOf, setDelivery, find, removeFor, revision, recall, remember, changed: live.changed, wait: live.wait, release: live.release };
}
