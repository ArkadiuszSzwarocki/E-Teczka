import express from 'express';
import { requireLocalDesktop } from '../middleware/accessControl';
import { catalogEnabled } from '../services/planCatalog';
import {
  listCentralFeedback,
  submitCentralFeedback,
  updateCentralFeedbackStatus,
  type FeedbackCategory,
  type FeedbackStatus,
} from '../services/centralFeedback';

const ALLOWED_CATEGORIES = new Set<FeedbackCategory>(['bug', 'feedback', 'backup', 'other']);
const ALLOWED_STATUSES = new Set<FeedbackStatus>(['new', 'in_progress', 'resolved', 'closed']);

/** Public desktop route for sending user feedback/bug reports with screenshots to QNAP. */
export function createFeedbackRouter() {
  const router = express.Router();
  router.post('/', (req, res, next) => {
    if (process.env.ETECZKA_PUBLIC_TEST_MODE === '1' && process.env.NODE_ENV !== 'production') { next(); return; }
    requireLocalDesktop(req, res, next);
  }, async (req, res) => {
    const category = String(req.body?.category || 'bug') as FeedbackCategory;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Wybierz prawidłową kategorię zgłoszenia.' });
    if (title.length < 3 || title.length > 160) return res.status(400).json({ error: 'Temat musi mieć od 3 do 160 znaków.' });
    if (description.length < 5 || description.length > 5000) return res.status(400).json({ error: 'Opis musi mieć od 5 do 5000 znaków.' });

    try {
      const result = await submitCentralFeedback({
        category,
        title,
        description,
        contactEmail: typeof req.body?.contactEmail === 'string' ? req.body.contactEmail.trim() : undefined,
        appVersion: typeof req.body?.appVersion === 'string' ? req.body.appVersion : undefined,
        platform: typeof req.body?.platform === 'string' ? req.body.platform : process.platform,
        activeView: typeof req.body?.activeView === 'string' ? req.body.activeView : undefined,
        screenshotDataUrl: typeof req.body?.screenshotDataUrl === 'string' ? req.body.screenshotDataUrl : undefined,
      });
      return res.status(201).json(result);
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : 'Nie udało się wysłać zgłoszenia.' });
    }
  });
  return router;
}

/** Developer-only route for viewing and managing feedback reports stored on QNAP. */
export function createDeveloperFeedbackRouter() {
  const router = express.Router();
  router.use(requireLocalDesktop);
  router.use((req, res, next) => {
    if (!catalogEnabled()) return res.status(404).json({ error: 'Panel jest dostępny tylko w trybie deweloperskim.' });
    if (!/^http:\/\/(127\.0\.0\.1|localhost):5173$/.test(req.header('origin') || '')) {
      return res.status(403).json({ error: 'Otwórz panel w lokalnej aplikacji deweloperskiej.' });
    }
    next();
  });

  router.get('/', async (req, res) => {
    const status = typeof req.query.status === 'string' && ALLOWED_STATUSES.has(req.query.status as FeedbackStatus)
      ? req.query.status
      : undefined;
    try { return res.json({ items: await listCentralFeedback(status) }); }
    catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'Nie udało się pobrać zgłoszeń.' }); }
  });

  router.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '') as FeedbackStatus;
    if (!Number.isSafeInteger(id) || id < 1 || !ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Nieprawidłowy identyfikator lub status.' });
    }
    try { return res.json(await updateCentralFeedbackStatus(id, status)); }
    catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'Nie udało się zmienić statusu.' }); }
  });

  return router;
}
