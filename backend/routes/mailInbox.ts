import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { isDocumentFolder } from '../services/folders';
import { getAccessibleFolderIds } from '../services/familyAccess';
import { ocrOwnerKey } from '../services/ocrPremium';
import { getPlan, ensurePlanLedger, checkDocumentCapacity, PlanLimitError } from '../services/planLedger';
import { annotateMailItemsAccess, isMailItemLocked } from '../services/mailInboxAccess';
import { assertUniqueDocument, DuplicateDocumentError, hashFile } from '../services/duplicateDocuments';
import { enqueuePremiumOcr } from '../services/ocrEnqueue';
import { recordFolderChoice } from '../services/folderLearningStore';
import {
  clearAccountSyncCursors,
  deleteMailAccount,
  deleteMailItem,
  extractSenderEmail,
  getMailAccounts,
  getMailConfig,
  getMailFilters,
  getPublicMailAccounts,
  getPublicMailConfig,
  isSenderExcluded,
  listMailItems,
  mailInboxDir,
  markProcessedAttachmentKeys,
  readMailItem,
  saveMailConfig,
  setSenderExcluded,
  setSenderFolderRule,
  upsertMailAccount,
} from '../services/mailInboxStore';
import { fetchMailboxStats, getMailSyncProgress, requestMailSyncStop, resetMailSyncState, syncMailboxAttachments } from '../services/mailImapFetcher';
import { testImapConnection } from '../services/mailImapStats';
import type { createOcrQueue } from '../services/ocrQueue';

export function createMailInboxRouter(prisma: PrismaClient, ocrQueue?: ReturnType<typeof createOcrQueue>) {
  const router = express.Router();
  const ownerIdOf = (res: express.Response) => Number(res.locals.userId || 1);

  const PREMIUM_PLANS = new Set(['premium', 'family', 'business']);

  router.get('/accounts', async (_req, res) => {
    const ownerId = ownerIdOf(res);
    const plan = await getPlan(prisma, ocrOwnerKey(res));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      accounts: getPublicMailAccounts(ownerId),
      canAddMultiple: PREMIUM_PLANS.has(plan),
      canAssign: plan !== 'free',
    });
  });

  router.post('/accounts', async (req, res) => {
    const ownerId = ownerIdOf(res);
    const plan = await getPlan(prisma, ocrOwnerKey(res));
    const existingList = getMailAccounts(ownerId);
    const reqId = typeof req.body?.id === 'string' && req.body.id.trim() ? req.body.id.trim() : crypto.randomUUID();
    const existing = existingList.find(a => a.id === reqId);

    if (!existing && existingList.length >= 1 && !PREMIUM_PLANS.has(plan)) {
      return res.status(402).json({
        code: 'PREMIUM_REQUIRED',
        error: 'Dodawanie wielu skrzynek pocztowych jest dostępne od pakietu Premium.',
      });
    }

    const host = String(req.body?.host || '').trim();
    const port = Number(req.body?.port || 993);
    const secure = req.body?.secure !== false;
    const user = String(req.body?.user || '').trim();
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const password = rawPassword || existing?.password || '';
    const mailbox = String(req.body?.mailbox || 'INBOX').trim() || 'INBOX';
    const label = String(req.body?.label || user).trim() || user;

    if (!host || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'Podaj serwer IMAP, port, login oraz hasło (lub hasło aplikacji).' });
    }
    upsertMailAccount(ownerId, { id: reqId, label, host, port, secure, user, password, mailbox });
    return res.json({
      accounts: getPublicMailAccounts(ownerId),
      canAddMultiple: PREMIUM_PLANS.has(plan),
    });
  });

  router.post('/accounts/test', async (req, res) => {
    const ownerId = ownerIdOf(res);
    const reqId = typeof req.body?.id === 'string' && req.body.id.trim() ? req.body.id.trim() : '';
    const existing = reqId ? getMailAccounts(ownerId).find(a => a.id === reqId) : undefined;
    const host = String(req.body?.host || existing?.host || '').trim();
    const port = Number(req.body?.port || existing?.port || 993);
    const secure = req.body?.secure !== undefined ? req.body.secure !== false : (existing?.secure ?? true);
    const user = String(req.body?.user || existing?.user || '').trim();
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const password = rawPassword || existing?.password || '';
    const mailbox = String(req.body?.mailbox || existing?.mailbox || 'INBOX').trim() || 'INBOX';

    if (!host || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ ok: false, error: 'Podaj serwer IMAP, port, login oraz hasło (lub hasło aplikacji).' });
    }
    try {
      const result = await testImapConnection({ host, port, secure, user, password, mailbox });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Test połączenia IMAP nie powiódł się.' });
    }
  });

  router.delete('/accounts/:id', async (req, res) => {
    const ownerId = ownerIdOf(res);
    resetMailSyncState(ownerId);
    clearAccountSyncCursors(ownerId, req.params.id);
    if (!deleteMailAccount(ownerId, req.params.id)) {
      return res.status(404).json({ error: 'Nie znaleziono skrzynki pocztowej.' });
    }
    const plan = await getPlan(prisma, ocrOwnerKey(res));
    return res.json({
      accounts: getPublicMailAccounts(ownerId),
      canAddMultiple: PREMIUM_PLANS.has(plan),
      canAssign: plan !== 'free',
    });
  });

  router.get('/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getPublicMailConfig(ownerIdOf(res)));
  });

  router.put('/config', (req, res) => {
    const ownerId = ownerIdOf(res);
    const existing = getMailConfig(ownerId);
    const host = String(req.body?.host || '').trim();
    const port = Number(req.body?.port || 993);
    const secure = req.body?.secure !== false;
    const user = String(req.body?.user || '').trim();
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const password = rawPassword || existing?.password || '';
    const mailbox = String(req.body?.mailbox || 'INBOX').trim() || 'INBOX';

    if (!host || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'Podaj serwer IMAP, port, login oraz hasło (lub hasło aplikacji).' });
    }
    saveMailConfig(ownerId, { host, port, secure, user, password, mailbox });
    return res.json(getPublicMailConfig(ownerId));
  });

  router.get('/items', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ownerId = ownerIdOf(res);
    const plan = await getPlan(prisma, ocrOwnerKey(res));
    res.json(await annotateMailItemsAccess(prisma, ownerId, plan, listMailItems(ownerId)));
  });

  function buildSenderList(ownerId: number) {
    const items = listMailItems(ownerId);
    const filters = getMailFilters(ownerId);
    const excludedSet = new Set(filters.excludedSenders);
    const counts = new Map<string, number>();
    for (const item of items) {
      const email = item.fromEmail || extractSenderEmail(item.from);
      if (email) counts.set(email, (counts.get(email) || 0) + 1);
    }
    const rules = filters.senderFolderRules || {};
    const allEmails = Array.from(new Set([...filters.excludedSenders, ...Object.keys(rules), ...counts.keys()])).sort();
    return allEmails.map(email => ({
      email,
      pendingCount: counts.get(email) || 0,
      excluded: excludedSet.has(email),
      folderId: rules[email] ?? null,
    }));
  }

  router.get('/senders', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildSenderList(ownerIdOf(res)));
  });

  router.put('/senders/exclusion', (req, res) => {
    const ownerId = ownerIdOf(res);
    const email = String(req.body?.email || '');
    const excluded = Boolean(req.body?.excluded);
    try {
      const state = setSenderExcluded(ownerId, email, excluded);
      if (excluded) {
        for (const item of listMailItems(ownerId)) {
          const itemEmail = item.fromEmail || extractSenderEmail(item.from);
          if (itemEmail && isSenderExcluded(itemEmail, state.excludedSenders)) {
            deleteMailItem(ownerId, item.id);
          }
        }
      }
      return res.json({ senders: buildSenderList(ownerId), items: listMailItems(ownerId) });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zapisać wykluczenia.' });
    }
  });

  async function assignMailItemToFolder(
    res: express.Response,
    ownerId: number,
    item: NonNullable<ReturnType<typeof readMailItem>>,
    folderId: number,
  ) {
    const sourcePath = path.join(mailInboxDir(ownerId), item.storedName);
    if (!fs.existsSync(sourcePath)) {
      throw Object.assign(new Error('Plik załącznika już nie istnieje.'), { statusCode: 404 });
    }
    const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
    if (!accessibleIds.includes(folderId) || !await isDocumentFolder(prisma, folderId)) {
      throw Object.assign(new Error('Nie znaleziono wybranej kartoteki.'), { statusCode: 404 });
    }
    const key = ocrOwnerKey(res);
    const plan = await getPlan(prisma, key);
    if (plan === 'free') {
      throw Object.assign(
        new Error('Plan Darmowy umożliwia tylko podgląd załączników. Przenoszenie do kartotek wymaga planu Standard lub Premium.'),
        { statusCode: 402, code: 'PREMIUM_REQUIRED' },
      );
    }
    await ensurePlanLedger(prisma);

    const ext = path.extname(item.storedName) || '.pdf';
    const targetName = `${crypto.randomUUID()}${ext}`;
    const targetPath = path.join(uploadsDir, targetName);
    const fileHash = await hashFile(sourcePath);

    const document = await prisma.$transaction(async tx => {
      await assertUniqueDocument(tx, ownerId, folderId, fileHash);
      await checkDocumentCapacity(tx, ownerId, plan, 1);
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      try {
        return await tx.document.create({
          data: {
            title: item.filename,
            filePath: targetName,
            mimeType: item.mimeType,
            folderId,
            userId: ownerId,
            retentionEnabled: false,
            retentionValue: 5,
            retentionUnit: 'years',
          },
        });
      } catch (err) {
        try { fs.unlinkSync(targetPath); } catch { /* ignore */ }
        throw err;
      }
    });

    recordFolderChoice(ownerId, item.extractedText, folderId);
    markProcessedAttachmentKeys(ownerId, [`${item.uid}:${item.filename.toLowerCase()}`]);
    deleteMailItem(ownerId, item.id);
    if (ocrQueue) {
      try { await enqueuePremiumOcr(prisma, ocrQueue, res, document.id); } catch { /* OCR queue error is non-fatal */ }
    }
    return document;
  }

  router.put('/senders/folder', async (req, res) => {
    const ownerId = ownerIdOf(res);
    const email = String(req.body?.email || '');
    const rawFolderId = req.body?.folderId;
    const folderId = rawFolderId === null || rawFolderId === '' || rawFolderId === undefined ? null : Number(rawFolderId);
    try {
      if (folderId !== null) {
        const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
        if (!accessibleIds.includes(folderId) || !(await isDocumentFolder(prisma, folderId))) {
          return res.status(404).json({ error: 'Nie znaleziono wybranej kartoteki.' });
        }
      }
      const nextState = setSenderFolderRule(ownerId, email, folderId);
      let movedCount = 0;
      if (folderId !== null) {
        const normRule = extractSenderEmail(email);
        for (const item of listMailItems(ownerId)) {
          const itemEmail = (item.fromEmail || extractSenderEmail(item.from)).toLowerCase();
          const matches = normRule.startsWith('@') ? itemEmail.endsWith(normRule) : itemEmail === normRule;
          if (!matches) continue;
          try {
            await assignMailItemToFolder(res, ownerId, item, folderId);
            movedCount++;
          } catch (err) {
            if (err instanceof DuplicateDocumentError) {
              deleteMailItem(ownerId, item.id);
              continue;
            }
            if ((err as { statusCode?: number }).statusCode === 402 || err instanceof PlanLimitError) {
              break;
            }
          }
        }
      }
      return res.json({ senders: buildSenderList(ownerId), items: listMailItems(ownerId), movedCount, rulesCount: Object.keys(nextState.senderFolderRules || {}).length });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zapisać reguły kartoteki.' });
    }
  });

  router.get('/sync/progress', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getMailSyncProgress(ownerIdOf(res)));
  });

  router.post('/sync/stop', (_req, res) => {
    requestMailSyncStop(ownerIdOf(res));
    res.json({ stopping: true });
  });

  router.post('/sync/reset', (req, res) => {
    const ownerId = ownerIdOf(res);
    const accountId = typeof req.body?.accountId === 'string' && req.body.accountId.trim() ? req.body.accountId.trim() : undefined;
    resetMailSyncState(ownerId);
    clearAccountSyncCursors(ownerId, accountId);
    res.json({ reset: true });
  });

  router.get('/stats', async (req, res) => {
    try {
      const accountId = typeof req.query?.accountId === 'string' && req.query.accountId.trim() ? req.query.accountId.trim() : undefined;
      const stats = await fetchMailboxStats(ownerIdOf(res), accountId);
      return res.json(stats);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się sprawdzić skrzynki.' });
    }
  });

  router.post('/sync', async (req, res) => {
    try {
      const ownerId = ownerIdOf(res);
      const accountId = typeof req.body?.accountId === 'string' && req.body.accountId.trim() ? req.body.accountId.trim() : undefined;
      const rawLimit = req.body?.limit;
      const limit = rawLimit === 'all' || rawLimit === 'incremental' || rawLimit === 'unread' ? rawLimit : Number(rawLimit || 80);
      const rawKind = req.body?.attachmentKind;
      const attachmentKind = rawKind === 'documents' || rawKind === 'images' || rawKind === 'all' ? rawKind : 'documents';
      const result = await syncMailboxAttachments(prisma, ownerId, { accountId, limit, attachmentKind });
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      return res.json({ ...result, items: await annotateMailItemsAccess(prisma, ownerId, plan, result.items) });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się pobrać poczty.' });
    }
  });

  router.get('/items/:id/file', async (req, res) => {
    const ownerId = ownerIdOf(res);
    const item = readMailItem(ownerId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Nie znaleziono załącznika.' });
    const plan = await getPlan(prisma, ocrOwnerKey(res));
    if (await isMailItemLocked(prisma, ownerId, plan, item.id)) {
      return res.status(402).json({ code: 'PLAN_LIMIT_REACHED', error: 'Załącznik poza limitem planu — przejdź na Standard lub Premium, aby odblokować podgląd.' });
    }
    const filePath = path.join(mailInboxDir(ownerId), item.storedName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Brak pliku załącznika.' });
    res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).json({ error: 'Nie udało się odczytać pliku załącznika.' });
    });
    return stream.pipe(res);
  });

  router.post('/items/:id/assign', async (req, res) => {
    const ownerId = ownerIdOf(res);
    const folderId = Number(req.body?.folderId);
    if (!Number.isSafeInteger(folderId) || folderId < 1) {
      return res.status(400).json({ error: 'Wybierz prawidłową kartotekę docelową.' });
    }
    const item = readMailItem(ownerId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Nie znaleziono załącznika w poczekalni.' });

    try {
      const document = await assignMailItemToFolder(res, ownerId, item, folderId);
      return res.status(201).json({ document });
    } catch (error) {
      if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message });
      if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message });
      const statusCode = (error as { statusCode?: number; code?: string }).statusCode;
      const code = (error as { code?: string }).code;
      if (statusCode === 402 || statusCode === 404) {
        return res.status(statusCode).json({ ...(code ? { code } : {}), error: error instanceof Error ? error.message : 'Błąd przypisania.' });
      }
      console.error('[mail-inbox] assign failed:', error);
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Nie udało się przenieść załącznika do kartoteki.' });
    }
  });

  router.post('/items/bulk-assign', async (req, res) => {
    const ownerId = ownerIdOf(res);
    const defaultFolderId = Number(req.body?.folderId);
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : null;
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const pairs: Array<{ id: string; folderId: number }> = rawItems
      ? rawItems
          .map((entry: { id?: unknown; folderId?: unknown }) => ({
            id: String(entry?.id || '').trim(),
            folderId: Number(entry?.folderId),
          }))
          .filter((p: { id: string; folderId: number }) => p.id && Number.isSafeInteger(p.folderId) && p.folderId >= 1)
          .slice(0, 1000)
      : (Number.isSafeInteger(defaultFolderId) && defaultFolderId >= 1
          ? rawIds.map((id: unknown) => ({ id: String(id || '').trim(), folderId: defaultFolderId })).filter((p: { id: string }) => p.id).slice(0, 1000)
          : []);

    if (pairs.length === 0) {
      return res.status(400).json({ error: 'Wybierz załączniki oraz prawidłową kartotekę docelową.' });
    }
    let movedCount = 0;
    let skippedDuplicates = 0;
    let firstError = '';
    try {
      for (const pair of pairs) {
        const item = readMailItem(ownerId, pair.id);
        if (!item) continue;
        try {
          await assignMailItemToFolder(res, ownerId, item, pair.folderId);
          movedCount++;
        } catch (err) {
          if (err instanceof DuplicateDocumentError) {
            deleteMailItem(ownerId, item.id);
            skippedDuplicates++;
            continue;
          }
          if (err instanceof PlanLimitError || (err as { statusCode?: number }).statusCode === 402 || (err as { statusCode?: number }).statusCode === 404) {
            return res.status((err as { statusCode?: number }).statusCode || 403).json({
              error: err instanceof Error ? err.message : 'Nie można przenieść wszystkich załączników.',
              movedCount,
              items: listMailItems(ownerId),
            });
          }
          console.error('[mail-inbox] bulk-assign item failed:', err);
          if (!firstError) firstError = err instanceof Error ? err.message : String(err);
        }
      }
      if (movedCount === 0 && skippedDuplicates === 0 && firstError) {
        return res.status(500).json({ error: firstError, movedCount, items: listMailItems(ownerId) });
      }
      return res.json({ movedCount, skippedDuplicates, items: listMailItems(ownerId) });
    } catch (error) {
      console.error('[mail-inbox] bulk-assign failed:', error);
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Nie udało się hurtowo przenieść załączników.' });
    }
  });

  router.post('/items/bulk-discard', async (req, res) => {
    const ownerId = ownerIdOf(res);
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const block = req.body?.block !== false;
    const ids = rawIds.map((id: unknown) => String(id || '').trim()).filter(Boolean).slice(0, 1000);
    const keysToBlock: string[] = [];
    let removed = 0;
    for (const id of ids) {
      const item = readMailItem(ownerId, id);
      if (item && deleteMailItem(ownerId, id)) {
        removed++;
        if (block) keysToBlock.push(`${item.uid}:${item.filename.toLowerCase()}`);
      }
    }
    if (block && keysToBlock.length > 0) markProcessedAttachmentKeys(ownerId, keysToBlock);
    const plan = await getPlan(prisma, ocrOwnerKey(res));
    return res.json({ removed, items: await annotateMailItemsAccess(prisma, ownerId, plan, listMailItems(ownerId)) });
  });

  router.delete('/items/:id', (req, res) => {
    const ownerId = ownerIdOf(res);
    const item = readMailItem(ownerId, req.params.id);
    if (!item || !deleteMailItem(ownerId, req.params.id)) {
      return res.status(404).json({ error: 'Nie znaleziono załącznika.' });
    }
    markProcessedAttachmentKeys(ownerId, [`${item.uid}:${item.filename.toLowerCase()}`]);
    return res.json({ success: true });
  });

  return router;
}
