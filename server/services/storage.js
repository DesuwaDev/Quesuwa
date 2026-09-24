import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { fail } from '../errors.js';

const allowedMime = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

export function cleanName(raw) {
  // Browsers send UTF-8 filenames, while multipart headers default to Latin-1.
  let name = String(raw || '');
  if ([...name].every(c => c.charCodeAt(0) <= 255)) {
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1')); } catch { /* Preserve genuine Latin-1 names. */ }
  }
  return path.basename(name.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || 'attachment';
}

export function createStorage(db, { dataDir, maxStorageMB }) {
  const uploads = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const filePath = id => path.join(uploads, id);

  function cleanup() {
    for (const { id } of db.prepare('SELECT id FROM file_cleanup').all()) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try {
        fs.rmSync(filePath(id), { force: true });
        db.prepare('DELETE FROM file_cleanup WHERE id=?').run(id);
      } catch (error) { console.error(error); }
    }
  }

  function queue(rows) {
    const insert = db.prepare('INSERT OR IGNORE INTO file_cleanup(id) VALUES (?)');
    for (const row of rows) for (const file of JSON.parse(row.attachments)) insert.run(file.id);
  }

  const usedBytes = () => db.prepare("SELECT COALESCE(SUM(json_extract(a.value,'$.size')),0) AS bytes FROM responses r, json_each(r.attachments) a").get().bytes;

  function usage() {
    let bytes = 0, files = 0;
    for (const row of db.prepare('SELECT attachments FROM responses').iterate()) {
      for (const file of JSON.parse(row.attachments)) { bytes += file.size; files++; }
    }
    let databaseBytes = 0;
    for (const suffix of ['', '-wal']) {
      try { databaseBytes += fs.statSync(path.join(dataDir, 'report.sqlite' + suffix)).size; } catch { /* WAL may not exist yet. */ }
    }
    return { bytes, files, maxStorageMB, databaseBytes, pendingCleanup: db.prepare('SELECT count(*) AS n FROM file_cleanup').get().n };
  }

  // Detects the real content type; the extension alone is only trusted for UTF-8 text.
  async function inspect(file, field) {
    if (!file.size) throw fail(400, 'errors.emptyFile');
    if (file.size > (field.maxFileMB || 10) * 1024 * 1024) throw fail(400, 'errors.customFileLimit', { label: field.label });
    let kind;
    try { kind = await fileTypeFromBuffer(file.buffer); } catch { throw fail(400, 'errors.invalidFile'); }
    let mime;
    if (kind && allowedMime.includes(kind.mime)) mime = kind.mime;
    else if (!kind && /\.(txt|log)$/i.test(file.originalname)) {
      let decoded = '\0';
      try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer); } catch { /* Invalid UTF-8 is rejected below. */ }
      if (decoded.includes('\0')) throw fail(400, 'errors.textFile');
      mime = 'text/plain';
    } else throw fail(400, 'errors.fileType');
    const group = mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : 'text';
    if (field.fileKinds && !field.fileKinds.includes(group)) throw fail(400, 'errors.fileType');
    return { id: randomUUID(), fieldId: field.id, name: cleanName(file.originalname), mime, size: file.size };
  }

  function ensureCapacity(incomingBytes) {
    if (incomingBytes && usedBytes() + incomingBytes > maxStorageMB * 1024 * 1024) throw fail(507, 'errors.storageFull');
  }

  function write(attachments, buffers) {
    const written = [];
    try {
      attachments.forEach((attachment, index) => {
        fs.writeFileSync(filePath(attachment.id), buffers[index], { flag: 'wx' });
        written.push(filePath(attachment.id));
      });
    } catch (error) {
      for (const file of written) fs.rmSync(file, { force: true });
      throw error;
    }
    return () => { for (const file of written) fs.rmSync(file, { force: true }); };
  }

  cleanup();
  return { filePath, cleanup, queue, usage, inspect, ensureCapacity, write };
}
