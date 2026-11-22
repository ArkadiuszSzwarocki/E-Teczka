import crypto from 'node:crypto';
import path from 'node:path';
import { simpleParser } from 'mailparser';
import { classifyDocumentOffline } from './documentFolderClassifier';
import { getLearnedFolderBoosts } from './folderLearningStore';
import { extractSenderEmail, getSenderFolderRule, isSenderExcluded, saveMailItem, type MailInboxItem } from './mailInboxStore';
import { extractQuickPdfText } from './pdfQuickText';

const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.xml', '.json']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg']);
const STRUCTURED_DOC_EXT = new Set(['.xml', '.json']);
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentKind = 'all' | 'documents' | 'images';

function matchesAttachmentKind(isImage: boolean, kind: AttachmentKind = 'all'): boolean {
  if (kind === 'documents') return !isImage;
  if (kind === 'images') return isImage;
  return true;
}

function guessMime(ext: string, rawMime?: string): string {
  const normalized = (rawMime || '').toLowerCase();
  if (normalized && (normalized.includes('pdf') || normalized.startsWith('image/') || normalized.includes('xml') || normalized.includes('json'))) return rawMime!;
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.xml') return 'application/xml';
  if (ext === '.json') return 'application/json';
  if (ext === '.png') return 'image/png';
  return 'image/jpeg';
}

type BodyStructureContext = {
  accountId: string;
  uid: number;
  seenKeys: Set<string>;
  existingTitles: Set<string>;
  attachmentKind?: AttachmentKind;
};

/** Checks IMAP bodyStructure recursively for new, supported attachment or image/PDF parts. */
export function hasCandidateAttachment(node: unknown, ctx?: BodyStructureContext): boolean {
  if (!node || typeof node !== 'object') return false;
  const part = node as {
    type?: string;
    subtype?: string;
    disposition?: string;
    size?: number;
    dispositionParameters?: { filename?: string };
    parameters?: { name?: string };
    childNodes?: unknown[];
  };
  if (Array.isArray(part.childNodes) && part.childNodes.length > 0) {
    return part.childNodes.some(child => hasCandidateAttachment(child, ctx));
  }

  const rawType = (part.type || '').toLowerCase();
  const mime = part.subtype ? `${rawType}/${part.subtype.toLowerCase()}` : rawType;
  const rawName = part.dispositionParameters?.filename || part.parameters?.name || '';
  const filename = rawName ? path.basename(rawName) : '';
  const ext = filename ? path.extname(filename).toLowerCase() : '';
  const isSupportedMime = mime === 'application/pdf' || mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'application/xml' || mime === 'text/xml' || mime === 'application/json' || mime === 'text/json';
  const isSupportedExt = Boolean(ext && ALLOWED_EXT.has(ext));
  const isSupportedAttachment = part.disposition?.toLowerCase() === 'attachment' && (!ext || ALLOWED_EXT.has(ext));
  if (!isSupportedMime && !isSupportedExt && !isSupportedAttachment) return false;
  const isImage = mime.startsWith('image/') || IMAGE_EXT.has(ext);
  if (!matchesAttachmentKind(isImage, ctx?.attachmentKind)) return false;

  if (isImage && part.disposition?.toLowerCase() === 'inline' && typeof part.size === 'number' && part.size < 20_000) {
    return false;
  }
  if (typeof part.size === 'number' && part.size > MAX_ATTACHMENT_BYTES * 1.4) {
    return false;
  }

  if (ctx && filename) {
    const nameLower = filename.trim().toLowerCase();
    const uidKey = `${ctx.uid}:${nameLower}`;
    if (ctx.seenKeys.has(`${ctx.accountId}:${uidKey}`) || ctx.seenKeys.has(uidKey)) return false;
    const baseLower = path.parse(nameLower).name;
    if (ctx.existingTitles.has(nameLower) || ctx.existingTitles.has(baseLower)) return false;
  }
  return true;
}

type ExtractParams = {
  ownerId: number;
  accountId: string;
  uid: number;
  source: Buffer;
  folders: Array<{ id: number; name: string; parentId: number | null }>;
  existingTitles: Set<string>;
  seenKeys: Set<string>;
  excludedList: string[];
  senderFolderRules?: Record<string, number>;
  attachmentKind?: AttachmentKind;
  onAutoAssign?: (folderId: number, filename: string, mimeType: string, content: Buffer) => Promise<boolean>;
};

/** Parses raw email source, skips excluded/duplicate attachments, auto-routes by sender rule or saves to staging. */
export async function extractAndSaveMessageAttachments({
  ownerId, accountId, uid, source, folders, existingTitles, seenKeys, excludedList, senderFolderRules, attachmentKind, onAutoAssign,
}: ExtractParams): Promise<{ addedCount: number; senderEmail: string; addedKeys: string[] }> {
  const parsed = await simpleParser(source);
  const subject = parsed.subject || '(Bez tematu)';
  const from = parsed.from?.text || '';
  const fromEmail = extractSenderEmail(parsed.from?.value?.[0]?.address || from);
  if (fromEmail && isSenderExcluded(fromEmail, excludedList)) {
    return { addedCount: 0, senderEmail: '', addedKeys: [] };
  }

  const receivedAt = (parsed.date || new Date()).toISOString();
  let addedCount = 0;
  const addedKeys: string[] = [];

  for (const att of parsed.attachments || []) {
    const filename = path.basename(att.filename || `zalacznik-${uid}.pdf`);
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext) || !att.content || att.content.length === 0 || att.content.length > MAX_ATTACHMENT_BYTES) continue;
    const isImage = IMAGE_EXT.has(ext) || Boolean(att.contentType?.toLowerCase().startsWith('image/'));
    if (!matchesAttachmentKind(isImage, attachmentKind)) continue;
    if (isImage && att.contentDisposition === 'inline' && att.content.length < 15_000) continue;

    const uidKey = `${uid}:${filename.toLowerCase()}`;
    const dedupKey = `${accountId}:${uidKey}`;
    if (seenKeys.has(dedupKey) || seenKeys.has(uidKey)) continue;
    const nameLower = filename.trim().toLowerCase();
    const baseLower = path.parse(nameLower).name;
    if (existingTitles.has(nameLower) || existingTitles.has(baseLower)) continue;
    seenKeys.add(dedupKey);
    seenKeys.add(uidKey);

    const mimeType = guessMime(ext, att.contentType);
    const ruleFolderId = fromEmail ? getSenderFolderRule(fromEmail, senderFolderRules) : null;
    const ruleFolder = ruleFolderId ? folders.find(f => f.id === ruleFolderId) : undefined;
    if (ruleFolder && onAutoAssign) {
      const assigned = await onAutoAssign(ruleFolder.id, filename, mimeType, att.content);
      if (assigned) {
        addedKeys.push(uidKey);
        addedCount++;
        continue;
      }
    }

    const contentText = ext === '.pdf'
      ? await extractQuickPdfText(att.content)
      : (STRUCTURED_DOC_EXT.has(ext) ? att.content.toString('utf8').slice(0, 4000) : '');
    const extractedText = [from, subject, filename, contentText].filter(Boolean).join('\n');
    const learnedBoosts = getLearnedFolderBoosts(ownerId, extractedText);
    const classified = classifyDocumentOffline(extractedText, folders, learnedBoosts);
    const top = classified.suggestions[0] || null;

    const id = crypto.randomUUID();
    const item: MailInboxItem = {
      id,
      uid,
      filename,
      storedName: `${id}${ext}`,
      mimeType,
      size: att.content.length,
      subject,
      from,
      fromEmail: fromEmail || undefined,
      receivedAt,
      suggestedFolderId: ruleFolder ? ruleFolder.id : (top ? top.folderId : null),
      suggestedFolderName: ruleFolder ? ruleFolder.name : (top ? top.folderName : null),
      detectedLabel: classified.detectedLabel,
      reason: ruleFolder ? 'Reguła nadawcy (automatyczne przypisanie)' : (top ? top.reason : 'Brak dopasowania — przeciągnij na kartotekę'),
      extractedText,
    };
    saveMailItem(ownerId, item, att.content);
    addedKeys.push(uidKey);
    addedCount++;
  }

  return { addedCount, senderEmail: addedCount > 0 ? fromEmail : '', addedKeys };
}
