// Read receipts for the respondent's follow-up page. A staff message counts as read only after
// it has really been on screen: the page is visible and at least 60% of the message (or 40% of the
// window, for long ones) stays in view for half a second. Quick scroll-throughs and background
// tabs do not count; anything that was actually shown is always reported.
const DWELL_MS = 500;

export function trackReads(report) {
  const reported = new Set(), onScreen = new Set(), pending = new Set();
  const timers = new Map(), elements = new Map();
  let flushTimer = null;

  async function flush() {
    const ids = [...pending];
    pending.clear();
    if (!ids.length) return;
    // A failed report is retried the next time the message is seen.
    try { await report(ids); } catch { for (const id of ids) reported.delete(id); }
  }

  function confirm(id) {
    timers.delete(id);
    if (document.visibilityState !== 'visible' || !onScreen.has(id) || reported.has(id)) return;
    reported.add(id);
    pending.add(id);
    if (elements.has(id)) observer.unobserve(elements.get(id));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 300);
  }
  const arm = id => { if (!reported.has(id) && !timers.has(id)) timers.set(id, setTimeout(() => confirm(id), DWELL_MS)); };
  const disarm = id => { clearTimeout(timers.get(id)); timers.delete(id); };

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const id = entry.target.dataset.readId;
      const shown = entry.isIntersecting && (entry.intersectionRatio >= 0.6 || entry.intersectionRect.height >= window.innerHeight * 0.4);
      if (shown) {
        onScreen.add(id);
        if (document.visibilityState === 'visible') arm(id);
      } else {
        onScreen.delete(id);
        disarm(id);
      }
    }
  }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });

  // Returning to the tab starts the clock again for whatever is on screen.
  const onVisibility = () => {
    if (document.visibilityState === 'visible') onScreen.forEach(arm);
    else [...timers.keys()].forEach(disarm);
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    // Watches every element marked with data-read-id inside root that is not reported yet.
    observe(root) {
      for (const element of root?.querySelectorAll('[data-read-id]') || []) {
        const id = element.dataset.readId;
        if (reported.has(id) || elements.get(id) === element) continue;
        if (elements.has(id)) observer.unobserve(elements.get(id));
        elements.set(id, element);
        observer.observe(element);
      }
    },
    stop() {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const timer of timers.values()) clearTimeout(timer);
      clearTimeout(flushTimer);
      flush();
    }
  };
}
