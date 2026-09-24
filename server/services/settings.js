import { normalizeLocale } from '../../i18n/core.js';
import { fail } from '../errors.js';

// Runtime settings editable in the web UI. A value supplied through the
// environment takes precedence and is reported as locked.
const defaults = { defaultLocale: 'zh-CN', maxStorageMB: 1024, trustProxyHops: 0 };
const validators = {
  defaultLocale: value => normalizeLocale(value) === value,
  maxStorageMB: value => Number.isInteger(value) && value >= 1 && value <= 1048576,
  trustProxyHops: value => Number.isInteger(value) && value >= 0 && value <= 5
};

export function createSettings(db, locked) {
  const load = () => Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, JSON.parse(row.value)]));
  const listeners = [];
  let current;
  function refresh() {
    const stored = load();
    current = Object.fromEntries(Object.keys(defaults).map(key => {
      const value = locked[key] ?? stored[key];
      return [key, value !== undefined && validators[key](value) ? value : defaults[key]];
    }));
    for (const listener of listeners) listener(current);
  }
  refresh();
  return {
    values: () => current,
    locked: () => Object.keys(defaults).filter(key => locked[key] !== undefined),
    onChange(listener) { listeners.push(listener); listener(current); },
    update(changes) {
      if (!changes || typeof changes !== 'object') throw fail(400, 'errors.badRequest');
      const entries = Object.entries(changes).filter(([key]) => Object.hasOwn(defaults, key));
      for (const [key, value] of entries) {
        if (locked[key] !== undefined) throw fail(400, 'errors.settingLocked');
        if (!validators[key](value)) throw fail(400, 'errors.settingValue');
      }
      const upsert = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      for (const [key, value] of entries) upsert.run(key, JSON.stringify(value));
      refresh();
      return current;
    }
  };
}
