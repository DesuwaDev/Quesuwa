import { Router } from 'express';
import { fail } from '../errors.js';

// Public side of human verification: the widget configuration and the built-in Cap server.
export function captchaRoutes({ captcha, limiter }) {
  const router = Router();
  router.get('/', (_req, res) => res.json(captcha.publicConfig()));

  // The Cap widget calls "<endpoint>challenge" and "<endpoint>redeem".
  const builtin = (_req, _res, next) => next(captcha.builtin() ? undefined : fail(404, 'errors.captchaUnavailable'));
  router.post('/cap/challenge', limiter(15 * 60_000, 120), builtin, async (_req, res) => res.json(await captcha.challenge()));
  router.post('/cap/redeem', limiter(15 * 60_000, 120), builtin, async (req, res) => res.json(await captcha.redeem(req.body)));
  return router;
}
