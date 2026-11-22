import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { assertUniqueDocument, DuplicateDocumentError } from './duplicateDocuments';
import { checkDocumentCapacity, ensurePlanLedger, getPlan } from './planLedger';

export type AutoAssignHandler = (folderId: number, filename: string, mimeType: string, content: Buffer) => Promise<boolean>;

/** Creates an auto-assign handler for sender-folder rules when the user's plan permits moving attachments. */
export async function buildMailAutoAssigner(prisma: PrismaClient, ownerId: number): Promise<AutoAssignHandler | undefined> {
  const plan = await getPlan(prisma, `user:${ownerId}`);
  if (plan === 'free') return undefined;

  return async (folderId: number, filename: string, mimeType: string, content: Buffer): Promise<boolean> => {
    const ext = path.extname(filename) || '.pdf';
    const targetName = `${crypto.randomUUID()}${ext}`;
    const targetPath = path.join(uploadsDir, targetName);
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');
    try {
      await ensurePlanLedger(prisma);
      fs.mkdirSync(uploadsDir, { recursive: true });
      await prisma.$transaction(async tx => {
        await assertUniqueDocument(tx, ownerId, folderId, fileHash);
        await checkDocumentCapacity(tx, ownerId, plan, 1);
        fs.writeFileSync(targetPath, content);
        try {
          await tx.document.create({
            data: {
              title: filename,
              filePath: targetName,
              mimeType,
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
      return true;
    } catch (err) {
      if (err instanceof DuplicateDocumentError) return true;
      return false;
    }
  };
}
