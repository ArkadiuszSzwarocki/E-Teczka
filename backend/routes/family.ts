import express from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  acceptFamilyInvite,
  cancelFamilyInvite,
  createFamilyInvite,
  FamilyError,
  getFamilyOverview,
  removeFamilyMember,
} from '../services/familyGroup';

/** REST endpoints for Family plan invitations, membership, and shared workspace status. */
export function createFamilyRouter(prisma: PrismaClient) {
  const router = express.Router();
  const userId = (res: express.Response) => Number(res.locals.userId || 1);

  const handleError = (res: express.Response, error: unknown, fallback: string) => {
    if (error instanceof FamilyError) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: fallback });
  };

  router.get('/', async (_req, res) => {
    try {
      res.json(await getFamilyOverview(prisma, userId(res)));
    } catch (error) {
      handleError(res, error, 'Nie udało się pobrać informacji o grupie rodzinnej.');
    }
  });

  router.post('/invite', async (req, res) => {
    try {
      const invite = await createFamilyInvite(prisma, userId(res), String(req.body?.email || ''));
      res.status(201).json(invite);
    } catch (error) {
      handleError(res, error, 'Nie udało się wysłać zaproszenia.');
    }
  });

  router.post('/accept', async (req, res) => {
    try {
      await acceptFamilyInvite(prisma, userId(res), String(req.body?.code || ''));
      res.json(await getFamilyOverview(prisma, userId(res)));
    } catch (error) {
      handleError(res, error, 'Nie udało się zaakceptować zaproszenia.');
    }
  });

  router.delete('/invites/:inviteId', async (req, res) => {
    try {
      await cancelFamilyInvite(prisma, userId(res), Number(req.params.inviteId));
      res.status(204).end();
    } catch (error) {
      handleError(res, error, 'Nie udało się anulować zaproszenia.');
    }
  });

  router.delete('/members/:memberUserId', async (req, res) => {
    try {
      await removeFamilyMember(prisma, userId(res), Number(req.params.memberUserId));
      res.status(204).end();
    } catch (error) {
      handleError(res, error, 'Nie udało się zaktualizować składu rodziny.');
    }
  });

  return router;
}
