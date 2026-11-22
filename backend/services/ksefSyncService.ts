import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { assertUniqueDocument, DuplicateDocumentError, hashFile } from './duplicateDocuments';
import { getKsefConfig, updateKsefSyncStatus, type KsefEnvironment } from './ksefCredentialsStore';
import { parseKsefXml } from './ksefXmlParser';
import { protectOcrText } from './ocrText';
import { checkDocumentCapacity, ensurePlanLedger, getPlan } from './planLedger';
import { emitRealtimeEvent } from './realtimeBus';

const KSEF_BASE_URLS: Record<KsefEnvironment, string> = {
  test: 'https://ksef-test.mf.gov.pl/api',
  demo: 'https://ksef-demo.mf.gov.pl/api',
  prod: 'https://ksef.mf.gov.pl/api',
};

const KSEF_FETCH_TIMEOUT_MS = 25_000;

async function ksefFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KSEF_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePublicKeyPem(env: KsefEnvironment, baseUrl: string): Promise<string> {
  const envVar = process.env[`MOJATECZKA_KSEF_PUBLIC_KEY_${env.toUpperCase()}`] || process.env.MOJATECZKA_KSEF_PUBLIC_KEY;
  if (envVar && envVar.includes('BEGIN PUBLIC KEY')) return envVar.replace(/\\n/g, '\n');
  const res = await ksefFetch(`${baseUrl}/online/Session/PublicKey`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Nie udało się pobrać klucza publicznego MF KSeF (${env}). Ustaw klucz w konfiguracji lub sprawdź dostępność API MF.`);
  }
  const text = (await res.text()).trim();
  if (!text.includes('BEGIN PUBLIC KEY') && !text.includes('BEGIN CERTIFICATE')) {
    throw new Error('Nieprawidłowy format klucza publicznego zwrócony przez API KSeF.');
  }
  return text;
}

function buildInitTokenXml(challenge: string, nip: string, encryptedTokenB64: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<InitSessionTokenRequest xmlns="http://ksef.mf.gov.pl/schema/gtw/svc/online/auth/request/20211001/v1" xmlns:types="http://ksef.mf.gov.pl/schema/gtw/svc/types/20211001/v1">
  <Context>
    <Challenge>${challenge}</Challenge>
    <Identifier xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="types:SubjectIdentifierByCompanyType">
      <types:Identifier>${nip}</types:Identifier>
    </Identifier>
    <DocumentType>
      <types:Service>KSeF</types:Service>
      <types:FormCode>
        <types:SystemCode>FA (2)</types:SystemCode>
        <types:SchemaVersion>1-0E</types:SchemaVersion>
        <types:TargetNamespace>http://crd.gov.pl/wzor/2023/06/29/12648/</types:TargetNamespace>
        <types:Value>FA</types:Value>
      </types:FormCode>
    </DocumentType>
    <Token>${encryptedTokenB64}</Token>
  </Context>
</InitSessionTokenRequest>`;
}

async function resolveTargetFolderId(prisma: PrismaClient, ownerId: number, preferredId: number | null): Promise<number> {
  if (preferredId) {
    const owned = await prisma.folder.findFirst({ where: { id: preferredId, ownerId }, select: { id: true } });
    if (owned) return owned.id;
  }
  const ksefFolder = await prisma.folder.findFirst({
    where: { ownerId, name: { contains: 'KSeF' } },
    select: { id: true },
  });
  if (ksefFolder) return ksefFolder.id;
  const anySub = await prisma.folder.findFirst({ where: { ownerId, parentId: { not: null } }, select: { id: true } });
  if (anySub) return anySub.id;
  const anyFolder = await prisma.folder.findFirst({ where: { ownerId }, select: { id: true } });
  if (anyFolder) return anyFolder.id;
  const created = await prisma.folder.create({ data: { name: 'KSeF Koszty', parentId: null, ownerId, order: 0 }, select: { id: true } });
  return created.id;
}

export type KsefSyncResult = {
  imported: number;
  skipped: number;
  totalFound: number;
  syncedAt: string;
};

/** Connects to the official Polish MF KSeF API using the stored token and imports new purchase invoices. */
export async function syncKsefInvoices(prisma: PrismaClient, ownerId: number, daysBack = 30): Promise<KsefSyncResult> {
  const cfg = getKsefConfig(ownerId);
  if (!cfg || !cfg.nip || !cfg.token) {
    throw new Error('Najpierw zapisz NIP i token autoryzacyjny KSeF w ustawieniach.');
  }
  const ownerKey = `user:${ownerId}`;
  const plan = await getPlan(prisma, ownerKey);
  if (plan !== 'business') {
    throw new Error('Automatyczne pobieranie faktur z API KSeF wymaga planu Firmowego (JDG).');
  }

  const baseUrl = KSEF_BASE_URLS[cfg.environment] || KSEF_BASE_URLS.test;
  let sessionToken = '';
  try {
    const challengeRes = await ksefFetch(`${baseUrl}/online/Session/AuthorisationChallenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ contextIdentifier: { type: 'onip', identifier: cfg.nip } }),
    });
    if (!challengeRes.ok) {
      throw new Error(`API KSeF odrzuciło wyzwanie autoryzacyjne (HTTP ${challengeRes.status}).`);
    }
    const challengeData = (await challengeRes.json()) as { timestamp?: string; challenge?: string };
    if (!challengeData.timestamp || !challengeData.challenge) {
      throw new Error('Niepełna odpowiedź challenge z API KSeF.');
    }

    const timestampMs = Date.parse(challengeData.timestamp);
    if (!Number.isFinite(timestampMs)) throw new Error('Nieprawidłowy znacznik czasu z API KSeF.');
    const publicKeyPem = await resolvePublicKeyPem(cfg.environment, baseUrl);
    const encryptedToken = crypto.publicEncrypt(
      { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(`${cfg.token}|${timestampMs}`, 'utf8'),
    ).toString('base64');

    const initXml = buildInitTokenXml(challengeData.challenge, cfg.nip, encryptedToken);
    const initRes = await ksefFetch(`${baseUrl}/online/Session/InitToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Accept: 'application/json' },
      body: initXml,
    });
    if (!initRes.ok) {
      throw new Error(`Autoryzacja tokenem KSeF nie powiodła się (HTTP ${initRes.status}). Sprawdź poprawność NIP i tokenu.`);
    }
    const initData = (await initRes.json()) as { sessionToken?: { token?: string } };
    sessionToken = initData.sessionToken?.token || '';
    if (!sessionToken) throw new Error('API KSeF nie zwróciło tokenu sesji.');

    const now = new Date();
    const safeDays = Math.min(90, Math.max(1, Number(daysBack) || 30));
    const fromDate = cfg.lastSyncAt && Number.isFinite(Date.parse(cfg.lastSyncAt))
      ? new Date(Math.max(now.getTime() - safeDays * 86_400_000, Date.parse(cfg.lastSyncAt) - 3_600_000))
      : new Date(now.getTime() - safeDays * 86_400_000);

    const queryRes = await ksefFetch(`${baseUrl}/online/Query/Invoice/Sync?PageSize=100&PageOffset=0`, {
      method: 'POST',
      headers: { SessionToken: sessionToken, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        queryCriteria: {
          subjectType: 'subject2',
          type: 'incremental',
          acquisitionTimestampThresholdFrom: fromDate.toISOString(),
          acquisitionTimestampThresholdTo: now.toISOString(),
        },
      }),
    });
    if (!queryRes.ok) {
      throw new Error(`Nie udało się pobrać listy faktur KSeF (HTTP ${queryRes.status}).`);
    }
    const queryData = (await queryRes.json()) as { invoiceHeaderList?: Array<{ ksefReferenceNumber?: string; invoiceReferenceNumber?: string }> };
    const headersList = Array.isArray(queryData.invoiceHeaderList) ? queryData.invoiceHeaderList : [];

    const targetFolderId = await resolveTargetFolderId(prisma, ownerId, cfg.targetFolderId);
    await ensurePlanLedger(prisma);

    let imported = 0;
    let skipped = 0;
    for (const item of headersList) {
      const ksefRef = String(item.ksefReferenceNumber || '').trim();
      if (!ksefRef) continue;
      const xmlRes = await ksefFetch(`${baseUrl}/online/Invoice/Get/${encodeURIComponent(ksefRef)}`, {
        method: 'GET',
        headers: { SessionToken: sessionToken, Accept: 'application/xml' },
      });
      if (!xmlRes.ok) { skipped++; continue; }
      const xmlText = await xmlRes.text();
      if (!xmlText.trim()) { skipped++; continue; }

      const fileName = `KSEF_${crypto.randomUUID()}.xml`;
      const fullPath = path.join(uploadsDir, fileName);
      fs.writeFileSync(fullPath, xmlText, { encoding: 'utf8', flag: 'wx' });
      try {
        const digest = await hashFile(fullPath);
        const parsed = parseKsefXml(xmlText);
        const title = parsed
          ? `KSeF ${parsed.invoiceNumber} — ${parsed.merchantName}`.slice(0, 255)
          : `Faktura KSeF ${item.invoiceReferenceNumber || ksefRef}`.slice(0, 255);

        const created = await prisma.$transaction(async tx => {
          await assertUniqueDocument(tx, ownerId, targetFolderId, digest);
          await checkDocumentCapacity(tx, ownerId, plan, 1);
          const doc = await tx.document.create({
            data: {
              title,
              filePath: fileName,
              mimeType: 'application/xml',
              folderId: targetFolderId,
              userId: ownerId,
              merchantName: parsed?.merchantName?.slice(0, 160) ?? null,
              amountCents: parsed?.amountCents ?? null,
              currency: parsed?.currency || 'PLN',
              dueDate: parsed?.dueDate ?? null,
              paymentStatus: parsed?.paymentStatus ?? 'unpaid',
              ocrText: parsed?.summaryText ? protectOcrText(parsed.summaryText) : null,
              createdAt: parsed?.issueDate ?? undefined,
            },
          });
          if (parsed?.items?.length) {
            await tx.documentLineItem.createMany({
              data: parsed.items.map(line => ({
                documentId: doc.id,
                name: line.name.slice(0, 200),
                quantity: line.quantity,
                totalCents: line.totalCents,
                category: line.category.slice(0, 80),
              })),
            });
          }
          return doc;
        });

        imported++;
        emitRealtimeEvent('document:created', { documentId: created.id, folderId: targetFolderId, title: created.title }, ownerId);
      } catch (err) {
        try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
        if (err instanceof DuplicateDocumentError) {
          skipped++;
          continue;
        }
        throw err;
      }
    }

    const syncedAt = new Date().toISOString();
    updateKsefSyncStatus(ownerId, { lastSyncAt: syncedAt, lastSyncCount: imported, lastSyncError: null });
    return { imported, skipped, totalFound: headersList.length, syncedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Błąd synchronizacji z API KSeF.';
    updateKsefSyncStatus(ownerId, { lastSyncAt: cfg.lastSyncAt || new Date().toISOString(), lastSyncCount: 0, lastSyncError: message });
    throw error;
  } finally {
    if (sessionToken) {
      await ksefFetch(`${baseUrl}/online/Session/Terminate`, {
        method: 'GET',
        headers: { SessionToken: sessionToken },
      }).catch(() => undefined);
    }
  }
}
