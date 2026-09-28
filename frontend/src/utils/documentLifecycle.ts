export function formatFileSize(bytes?: number) {
  if (!bytes) return '—';
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

import type { DocumentRecord } from '../types/domain';

export function getExpiryDate(document: Pick<DocumentRecord, 'createdAt' | 'retentionEnabled' | 'retentionUnit' | 'retentionValue'>): Date | null {
  if (document.retentionEnabled === false) return null;
  const date = new Date(document.createdAt);
  if (document.retentionUnit === 'years') date.setFullYear(date.getFullYear() + document.retentionValue);
  else if (document.retentionUnit === 'months') date.setMonth(date.getMonth() + document.retentionValue);
  else if (document.retentionUnit === 'days') date.setDate(date.getDate() + document.retentionValue);
  else if (document.retentionUnit === 'minutes') date.setMinutes(date.getMinutes() + document.retentionValue);
  return date;
}
