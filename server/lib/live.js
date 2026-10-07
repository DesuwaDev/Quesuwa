// Long-poll hub: a request waits until the watched item changes or the timeout passes.
// Works through any proxy or CDN and keeps ticket keys in headers, never in URLs.
const WAIT_MS = 25_000;
const MAX_WAITERS = 2000;

export function createLive() {
  const listeners = new Map();
  const pending = new Set();
  const active = new Set();
  let waiting = 0;

  function subscribe(id, listener) {
    let set = listeners.get(id);
    if (!set) listeners.set(id, set = new Set());
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) listeners.delete(id);
    };
  }

  // Changes are announced on the next turn so the caller can finish related writes first.
  function changed(id) {
    if (pending.has(id)) return;
    pending.add(id);
    setImmediate(() => {
      pending.delete(id);
      for (const listener of [...(listeners.get(id) || [])]) listener();
    });
  }

  // snapshot() returns { rev, body }; the client passes the rev it already has.
  function wait(req, res, id, snapshot) {
    const known = typeof req.query.rev === 'string' ? req.query.rev : '';
    const first = snapshot();
    if (first.rev !== known) return res.json(first.body);
    // At capacity the client gets an empty answer and retries a little later.
    if (waiting >= MAX_WAITERS) return res.status(204).end();
    waiting++;
    let done = false;
    const finish = send => {
      if (done) return;
      done = true;
      waiting--;
      active.delete(release);
      clearTimeout(timer);
      unsubscribe();
      send?.();
    };
    const release = () => finish(() => res.status(204).end());
    active.add(release);
    const unsubscribe = subscribe(id, () => {
      let next;
      try { next = snapshot(); } catch { return finish(() => res.status(204).end()); }
      if (next.rev !== known) finish(() => res.json(next.body));
    });
    const timer = setTimeout(() => finish(() => res.status(204).end()), WAIT_MS);
    res.on('close', () => finish());
  }

  // Answers every waiting request so the server can stop without delay.
  const release = () => { for (const finish of [...active]) finish(); };

  return { changed, wait, release, waiting: () => waiting };
}
