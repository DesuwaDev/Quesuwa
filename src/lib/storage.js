// localStorage access that tolerates private browsing and disabled storage.
export const storage = {
  get(key) {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  },
  set(key, value) {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* Storage may be full or disabled. */ }
  },
  remove(key) {
    try { globalThis.localStorage?.removeItem(key); } catch { /* Storage may be disabled. */ }
  },
  getJSON(key) {
    const raw = this.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  setJSON(key, value) { this.set(key, JSON.stringify(value)); }
};
