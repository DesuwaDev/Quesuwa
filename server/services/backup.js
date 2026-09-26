import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backup as sqliteBackup } from 'node:sqlite';
import { fail } from '../errors.js';
import { writeZip } from '../lib/zip.js';

const NAME = /^quesuwa-\d{8}-\d{6}\.sqlite$/;
const defaults = { enabled: false, hour: 3, keep: 7 };

// Database snapshots plus an incremental mirror of attachments (files are immutable).
export function createBackups(db, { dataDir, settings }) {
  const dir = path.join(dataDir, 'backups');
  const mirror = path.join(dir, 'uploads');
  const uploads = path.join(dataDir, 'uploads');
  const readSetting = (key, fallback) => { const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; };
  const writeSetting = (key, value) => db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  let running = false;

  const config = () => ({ ...defaults, ...readSetting('backup', {}) });
  function update(input) {
    const current = config();
    const next = {
      enabled: input?.enabled === undefined ? current.enabled : input.enabled === true,
      hour: input?.hour === undefined ? current.hour : Number(input.hour),
      keep: input?.keep === undefined ? current.keep : Number(input.keep)
    };
    if (!Number.isInteger(next.hour) || next.hour < 0 || next.hour > 23 || !Number.isInteger(next.keep) || next.keep < 1 || next.keep > 60) throw fail(400, 'errors.backupInvalid');
    writeSetting('backup', next);
    return next;
  }

  function list() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => NAME.test(name)).sort().reverse().map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    });
  }

  async function run() {
    if (running) throw fail(409, 'errors.backupRunning');
    running = true;
    const started = new Date();
    try {
      fs.mkdirSync(mirror, { recursive: true });
      const stamp = started.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const name = `quesuwa-${stamp}.sqlite`;
      await sqliteBackup(db, path.join(dir, name));
      let copied = 0;
      for (const file of fs.existsSync(uploads) ? fs.readdirSync(uploads) : []) {
        const target = path.join(mirror, file);
        if (!fs.existsSync(target)) { fs.copyFileSync(path.join(uploads, file), target); copied++; }
      }
      for (const old of list().slice(config().keep)) fs.rmSync(path.join(dir, old.name), { force: true });
      const status = { at: started.toISOString(), ok: true, name, copied, error: '' };
      writeSetting('backupStatus', status);
      return status;
    } catch (error) {
      const status = { at: started.toISOString(), ok: false, name: '', copied: 0, error: String(error?.message || error).slice(0, 300) };
      writeSetting('backupStatus', status);
      if (error.status) throw error;
      return status;
    } finally { running = false; }
  }

  // Once per local day after the configured hour.
  async function tick(now = new Date()) {
    const current = config();
    if (!current.enabled || running) return;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: settings.values().timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    if (Number(parts.hour) < current.hour || readSetting('backupLast', '') === today) return;
    writeSetting('backupLast', today);
    await run();
  }

  function file(name) {
    if (!NAME.test(name) || !fs.existsSync(path.join(dir, name))) throw fail(404, 'errors.backupNotFound');
    return path.join(dir, name);
  }

  // A consistent snapshot plus every attachment, streamed as one ZIP.
  async function streamArchive(res) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'quesuwa-archive-'));
    try {
      const snapshot = path.join(temp, 'report.sqlite');
      await sqliteBackup(db, snapshot);
      const entries = [{ name: 'report.sqlite', path: snapshot, date: new Date() }];
      for (const name of fs.existsSync(uploads) ? fs.readdirSync(uploads) : []) entries.push({ name: 'uploads/' + name, path: path.join(uploads, name), date: fs.statSync(path.join(uploads, name)).mtime });
      await writeZip(res, entries);
      res.end();
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }

  return { config, update, list, run, tick, file, streamArchive, status: () => readSetting('backupStatus', null) };
}

// Permanently removes responses older than each questionnaire's retention period.
export function createRetention(db, { storage, tickets, audit }) {
  let last = 0;
  function run(now = Date.now()) {
    let removed = 0;
    for (const row of db.prepare('SELECT id, definition FROM forms').all()) {
      const days = JSON.parse(row.definition).settings?.retentionDays;
      if (!Number.isInteger(days) || days < 1) continue;
      const cutoff = new Date(now - days * 86400_000).toISOString();
      const expired = db.prepare('SELECT id, attachments FROM responses WHERE form_id=? AND created_at<?').all(row.id, cutoff);
      if (!expired.length) continue;
      db.exec('BEGIN IMMEDIATE');
      try {
        storage.queue(expired);
        tickets.removeFor(expired.map(item => item.id));
        const remove = db.prepare('DELETE FROM responses WHERE id=?');
        for (const item of expired) remove.run(item.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      audit(null, 'retention', row.id, String(expired.length));
      removed += expired.length;
    }
    if (removed) storage.cleanup();
    return removed;
  }
  function tick(now = Date.now()) {
    if (now - last < 3600_000) return;
    last = now;
    run(now);
  }
  return { run, tick };
}

export function startJobs(jobs) {
  const tick = async () => {
    for (const job of jobs) {
      try { await job(); } catch (error) { console.error(error); }
    }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, 30_000);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
