import express from 'express';
import { getArchiveWorkspace, saveArchiveWorkspace } from '../services/archiveWorkspace';

export function createArchiveWorkspaceRouter() {
  const router = express.Router();
  const ownerId = (res: express.Response) => Number(res.locals.userId || 1);

  router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getArchiveWorkspace(ownerId(res)));
  });

  router.put('/', (req, res) => {
    try {
      res.json(saveArchiveWorkspace(ownerId(res), req.body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zapisać układu archiwum.' });
    }
  });

  return router;
}
