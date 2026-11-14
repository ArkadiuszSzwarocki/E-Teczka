import type { PrismaClient } from '@prisma/client';
import { errorMessage } from '../utils/errors';
import { featureTrial } from './planLedger';
import { devPlan } from './devPlans';

type Destination = { schedule: string | null; createdAt: Date; lastBackupAt: Date | null; lastBackupStatus: string | null };

/** Most recent scheduled time, using the server's local timezone. */
export function latestScheduledTime(schedule: string | null, now: Date): Date | null {
  const match = /^(daily|weekly)(?:@([01]\d|2[0-3]):([0-5]\d))?$/.exec(schedule || '');
  if (!match) return null;
  const due = new Date(now); due.setHours(match[2] === undefined ? 2 : Number(match[2]), match[3] === undefined ? 15 : Number(match[3]), 0, 0);
  if (match[1] === 'weekly') {
    const daysSinceMonday = (due.getDay() + 6) % 7;
    due.setDate(due.getDate() - daysSinceMonday);
    if (due > now) due.setDate(due.getDate() - 7);
  } else if (due > now) due.setDate(due.getDate() - 1);
  return due;
}

export function backupDue(destination: Destination, now: Date): boolean {
  const due = latestScheduledTime(destination.schedule, now);
  if (!due || due < destination.createdAt) return false;
  if (!destination.lastBackupAt || destination.lastBackupAt < due) return true;
  return destination.lastBackupStatus === 'failed' && now.getTime() - destination.lastBackupAt.getTime() >= 60 * 60 * 1000;
}

export function createBackupScheduler(prisma: PrismaClient, runBackup: (prisma: PrismaClient, ownerKey: string, ownerId: number) => Promise<boolean>) {
  let running = false;
  return async function checkScheduledBackups(now = new Date()): Promise<void> {
    if (running) return;
    running = true;
    try {
      const destinations = await prisma.backupDestination.findMany({ where: { enabled: true } });
      for (const destination of destinations) {
        // A simulated subscription must never trigger a real scheduled upload.
        if (devPlan(destination.ownerKey) !== undefined) continue;
        if (!backupDue(destination, now)) continue;
        if (!(await featureTrial(prisma, destination.ownerKey, 'cloudBackup', false, now)).allowed) continue;
        const ownerId = destination.ownerKey.startsWith('user:') ? Number(destination.ownerKey.slice(5)) : 1;
        const run = await prisma.backupRun.create({ data: { destinationId: destination.id, status: 'running' } });
        try {
          if (!await runBackup(prisma, destination.ownerKey, Number.isFinite(ownerId) && ownerId > 0 ? ownerId : 1)) throw new Error('Harmonogram kopii został wyłączony.');
          const finishedAt = new Date();
          await prisma.backupRun.update({ where: { id: run.id }, data: { status: 'success', finishedAt } });
          await prisma.backupDestination.update({ where: { id: destination.id }, data: { lastBackupAt: finishedAt, lastBackupStatus: 'success', lastBackupError: null } });
        } catch (error) {
          const details = errorMessage(error).slice(0, 1000); const finishedAt = new Date();
          await prisma.backupRun.update({ where: { id: run.id }, data: { status: 'failed', error: details, finishedAt } });
          await prisma.backupDestination.update({ where: { id: destination.id }, data: { lastBackupAt: finishedAt, lastBackupStatus: 'failed', lastBackupError: details } });
          console.error(`[backup] Scheduled backup failed for ${destination.ownerKey}:`, details);
        }
      }
    } finally { running = false; }
  };
}
