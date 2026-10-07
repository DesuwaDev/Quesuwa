// Keeps one long-poll request open at a time and hands every change to onChange.
// request(signal) resolves with fresh data, or null when the server had nothing new.
// Each request carries the revision the page already has and the server answers with the
// complete current state, so anything missed while offline arrives with the first reply.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The server answers within 25 s; a request silent for longer sits on a dead connection
// (for example after switching from Wi-Fi to mobile data) and is replaced.
const WATCHDOG_MS = 40_000;

export function startLive(request, onChange, { onStatus = () => {} } = {}) {
  let stopped = false, controller = null, failures = 0, wakeUp = null, online = true;

  const report = value => {
    if (value === online) return;
    online = value;
    onStatus(value ? 'online' : 'offline');
  };

  async function loop() {
    while (!stopped) {
      controller = new AbortController();
      const watchdog = setTimeout(() => controller.abort(), WATCHDOG_MS);
      const started = Date.now();
      let pause = 0;
      try {
        const data = await request(controller.signal);
        failures = 0;
        report(true);
        if (data && !stopped) onChange(data);
        // An empty answer that came back at once means the server is busy; wait before asking again.
        else if (!data && Date.now() - started < 1000) pause = 5000;
      } catch (error) {
        if (stopped) return;
        if (error?.name === 'AbortError') continue;
        // Back off on errors (offline, server restart) and tell the page it is out of date.
        failures++;
        report(false);
        pause = Math.min(30_000, 1000 * 2 ** failures);
      } finally { clearTimeout(watchdog); }
      // Pauses end early when the network or the page comes back.
      if (pause && !stopped) {
        await Promise.race([sleep(pause), new Promise(resolve => { wakeUp = resolve; })]);
        wakeUp = null;
      }
    }
  }

  // Reconnect at once when the page is shown again (phones pause background tabs),
  // restored from the back/forward cache, or the device regains its network.
  const resume = () => {
    if (stopped) return;
    // Hiding the page restarts the open request too, so the server learns it is no longer being read.
    if (document.visibilityState !== 'visible') { if (!wakeUp) controller?.abort(); return; }
    failures = 0;
    if (wakeUp) wakeUp();
    else controller?.abort();
  };
  const offline = () => report(false);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', resume);
  window.addEventListener('offline', offline);
  loop();

  return () => {
    stopped = true;
    controller?.abort();
    wakeUp?.();
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('online', resume);
    window.removeEventListener('offline', offline);
  };
}

// One key per message being sent: retrying the same text after a network error reuses it,
// so the server can recognise a message that already arrived and not store it twice.
export function sendKey() {
  let current = null, text = null;
  return {
    for(body) {
      if (body !== text || !current) {
        text = body;
        current = (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replaceAll('-', '');
      }
      return current;
    },
    done() { current = null; text = null; }
  };
}
