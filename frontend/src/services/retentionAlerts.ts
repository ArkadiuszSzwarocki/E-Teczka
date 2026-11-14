import { getExpiryDate } from '../utils/documentLifecycle';
import type { DocumentRecord } from '../types/domain';

export type RetentionAlert = { id: number; title: string; text: string; type: 'warning' | 'danger' };

export function getRetentionAlerts(documents: DocumentRecord[]): RetentionAlert[] {
  const alerts: RetentionAlert[] = [];
  const now = new Date();
  for (const doc of documents) {
    if (doc.retentionEnabled === false || doc.isDeleted || doc.isArchived) continue;
    const expiry = getExpiryDate(doc); if (!expiry) continue;
    const diffMs = expiry.getTime() - now.getTime(); if (diffMs <= 0) continue;
    const diffDays = Math.ceil(diffMs / 86_400_000);
    const diffMonths = Math.round(diffDays / 30);
    const diffMinutes = Math.ceil(diffMs / 60_000);
    if (diffMinutes <= 60 && diffDays === 1) alerts.push({ id: doc.id, title: doc.title, text: `Wygasa za ${diffMinutes} min!`, type: 'danger' });
    else if (diffDays >= 1 && diffDays <= 15) alerts.push({ id: doc.id, title: doc.title, text: `Termin życia: ${diffDays} ${diffDays === 1 ? 'dzień' : 'dni'}.`, type: 'danger' });
    else if (diffMonths >= 1 && diffMonths <= 6) alerts.push({ id: doc.id, title: doc.title, text: `Termin życia: ${diffMonths} ${diffMonths === 1 ? 'miesiąc' : 'mies.'}.`, type: 'warning' });
  }
  return alerts.sort((a, b) => (a.type === b.type ? 0 : a.type === 'danger' ? -1 : 1));
}
