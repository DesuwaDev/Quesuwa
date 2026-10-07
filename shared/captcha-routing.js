// Which verification channel to try next when the current one fails.
//   kind: 'blocked' (Cap refused the visitor), 'network' (cause unknown) or 'unavailable'
//   (script, solver or service failure). Cap's own failures follow config.capFallbacks;
//   anything else moves from the primary to the general backup. No channel is tried twice.
export function nextCaptchaChannel(config, current, kind, tried) {
  const target = current === 'cap' && kind !== 'unavailable' ? config.capFallbacks?.[kind] : tried.length === 1 ? config.fallback : null;
  return target && !tried.includes(target.provider) ? target : null;
}
