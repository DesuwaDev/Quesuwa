import { Router } from 'express';

// Owner-only configuration of alert and respondent channels.
export function notificationRoutes({ notifier, audit, auth }) {
  const router = Router();
  router.get('/', (_req, res) => res.json({ config: notifier.masked(), log: notifier.history() }));
  router.put('/', (req, res) => {
    const config = notifier.update(req.body);
    audit(req, 'notifications', 'system', '');
    res.json({ config, log: notifier.history() });
  });
  router.post('/test', async (req, res) => {
    const result = await notifier.test(req.body?.channel, req.body?.to, auth.getUser(req.user.id)?.email || '');
    res.json({ ...result, log: notifier.history() });
  });
  router.post('/outbox/:id/retry', (req, res) => {
    notifier.retry(Number(req.params.id));
    res.json({ log: notifier.history() });
  });
  router.post('/preview', (req, res) => {
    res.json({ html: notifier.preview(['alert', 'receipt', 'reply'].includes(req.body?.kind) ? req.body.kind : 'reply', req.body?.appearance) });
  });
  return router;
}

// Available to every workspace member: which channels work and the reply templates.
export function messagingRoutes({ notifier }) {
  const router = Router();
  router.get('/', (_req, res) => res.json({ ...notifier.status(), templates: notifier.templates() }));
  return router;
}
