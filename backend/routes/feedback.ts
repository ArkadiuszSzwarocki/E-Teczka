import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireLocalDesktop } from '../middleware/accessControl';
import { catalogEnabled } from '../services/planCatalog';
import { archiveClosedFeedbackReport } from '../services/feedbackArchive';
import {
  listCentralFeedback,
  submitCentralFeedback,
  updateCentralFeedbackStatus,
  type FeedbackCategory,
  type FeedbackStatus,
} from '../services/centralFeedback';
import {
  addFeedbackThreadMessage,
  getFeedbackThreadMessages,
  listUserFeedbackHistory,
  recordFeedbackSubmission,
  sendFeedbackEmailCopy,
  updateFeedbackHistoryStatus,
} from '../services/feedbackThreadStore';

const ALLOWED_CATEGORIES = new Set<FeedbackCategory>(['bug', 'feedback', 'backup', 'other']);
const ALLOWED_STATUSES = new Set<FeedbackStatus>(['new', 'in_progress', 'resolved', 'closed']);

/** Public desktop route for sending user feedback/bug reports with screenshots to QNAP. */
export function createFeedbackRouter() {
  const router = express.Router();
  router.post('/', (req, res, next) => {
    if (process.env.MOJATECZKA_PUBLIC_TEST_MODE === '1' && process.env.NODE_ENV !== 'production') { next(); return; }
    requireLocalDesktop(req, res, next);
  }, async (req, res) => {
    const category = String(req.body?.category || 'bug') as FeedbackCategory;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (!ALLOWED_CATEGORIES.has(category)) return res.status(400).json({ error: 'Wybierz prawidłową kategorię zgłoszenia.' });
    if (title.length < 3 || title.length > 160) return res.status(400).json({ error: 'Temat musi mieć od 3 do 160 znaków.' });
    if (description.length < 5 || description.length > 5000) return res.status(400).json({ error: 'Opis musi mieć od 5 do 5000 znaków.' });

    try {
      const contactEmail = typeof req.body?.contactEmail === 'string' ? req.body.contactEmail.trim() : undefined;
      const result = await submitCentralFeedback({
        category,
        title,
        description,
        contactEmail,
        appVersion: typeof req.body?.appVersion === 'string' ? req.body.appVersion : undefined,
        platform: typeof req.body?.platform === 'string' ? req.body.platform : process.platform,
        activeView: typeof req.body?.activeView === 'string' ? req.body.activeView : undefined,
        screenshotDataUrl: typeof req.body?.screenshotDataUrl === 'string' ? req.body.screenshotDataUrl : undefined,
      });
      recordFeedbackSubmission({
        id: result.id,
        category,
        title,
        description,
        contactEmail: contactEmail || null,
        status: (result.status as FeedbackStatus) || 'new',
        createdAt: result.createdAt,
      });
      return res.status(201).json(result);
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : 'Nie udało się wysłać zgłoszenia.' });
    }
  });

  router.get('/history', (_req, res) => {
    return res.json({ items: listUserFeedbackHistory() });
  });

  router.post('/:id/reply', (req, res, next) => {
    if (process.env.MOJATECZKA_PUBLIC_TEST_MODE === '1' && process.env.NODE_ENV !== 'production') { next(); return; }
    requireLocalDesktop(req, res, next);
  }, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Nieprawidłowy numer zgłoszenia.' });
    try {
      const message = addFeedbackThreadMessage(id, 'user', String(req.body?.text || ''));
      return res.status(201).json({ message });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zapisać odpowiedzi.' });
    }
  });

  router.post('/:id/email-copy', async (req, res) => {
    const id = Number(req.params.id);
    const toEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (!Number.isSafeInteger(id) || id < 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return res.status(400).json({ error: 'Podaj poprawny adres e-mail.' });
    }
    const found = listUserFeedbackHistory().find(item => item.id === id);
    const result = await sendFeedbackEmailCopy({
      id,
      toEmail,
      title: found?.title || String(req.body?.title || `Zgłoszenie #${id}`),
      category: found?.category || String(req.body?.category || 'bug'),
      description: found?.description || String(req.body?.description || ''),
    });
    return res.status(result.sent ? 200 : 400).json(result);
  });

  return router;
}

/** Developer-only route for viewing and managing feedback reports stored on QNAP. */
export function createDeveloperFeedbackRouter(prisma?: PrismaClient) {
  const router = express.Router();
  router.use(requireLocalDesktop);
  router.use((req, res, next) => {
    if (!catalogEnabled()) return res.status(404).json({ error: 'Panel jest dostępny tylko w trybie deweloperskim.' });
    const reqOrigin = req.header('origin') || '';
    if (reqOrigin && !/^http:\/\/(127\.0\.0\.1|localhost):(5173|3000)$/.test(reqOrigin)) {
      return res.status(403).json({ error: 'Otwórz panel w lokalnej aplikacji deweloperskiej.' });
    }
    next();
  });

  router.get('/', async (req, res) => {
    const status = typeof req.query.status === 'string' && ALLOWED_STATUSES.has(req.query.status as FeedbackStatus)
      ? req.query.status
      : undefined;
    try {
      const items = await listCentralFeedback(status);
      return res.json({ items: items.map(item => ({ ...item, messages: getFeedbackThreadMessages(item.id) })) });
    }
    catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'Nie udało się pobrać zgłoszeń.' }); }
  });

  router.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '') as FeedbackStatus;
    if (!Number.isSafeInteger(id) || id < 1 || !ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Nieprawidłowy identyfikator lub status.' });
    }
    try {
      const updated = await updateCentralFeedbackStatus(id, status);
      updateFeedbackHistoryStatus(id, status);
      let archivedDocumentId: number | null = null;
      if (status === 'closed' && prisma) {
        try {
          const all = await listCentralFeedback();
          const item = all.find(entry => entry.id === id);
          if (item) {
            const owner = Number(res.locals.userId || 1);
            archivedDocumentId = await archiveClosedFeedbackReport(prisma, owner, item, getFeedbackThreadMessages(id));
          }
        } catch (archiveErr) {
          console.warn('[dev/feedback] archive failed:', archiveErr instanceof Error ? archiveErr.message : archiveErr);
        }
      }
      return res.json({ ...updated, archivedDocumentId });
    }
    catch (error) { return res.status(502).json({ error: error instanceof Error ? error.message : 'Nie udało się zmienić statusu.' }); }
  });

  router.post('/:id/reply', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Nieprawidłowy numer zgłoszenia.' });
    try {
      const message = addFeedbackThreadMessage(id, 'admin', String(req.body?.text || ''));
      return res.status(201).json({ message });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zapisać pytania.' });
    }
  });

  return router;
}
