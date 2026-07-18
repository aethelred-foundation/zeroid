import { Router, Request, Response } from 'express';
import { z } from 'zod';

import { authRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validation';
import { identityAuthService } from '../services/identity-auth';
import { asRouteError, sendRouteError } from '../utils/route-error';

const challengeSchema = z
  .object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
  })
  .strict();

const loginSchema = z
  .object({
    challengeId: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  })
  .strict();

const router = Router();
router.use(authRateLimiter);

router.post(
  '/challenge',
  validate({ body: challengeSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const challenge = await identityAuthService.createChallenge(
        req.body.address,
      );
      res.status(201).json({
        data: challenge,
        message: 'Wallet authentication challenge created',
      });
    } catch (error) {
      sendRouteError(
        res,
        asRouteError(error),
        'IDENTITY_AUTH_CHALLENGE_FAILED',
      );
    }
  },
);

router.post(
  '/login',
  validate({ body: loginSchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const session = await identityAuthService.authenticate(req.body);
      res.status(200).json({
        data: session,
        message: 'Wallet authentication successful',
      });
    } catch (error) {
      sendRouteError(res, asRouteError(error), 'IDENTITY_AUTH_FAILED');
    }
  },
);

export { router as identityAuthRoutes };
