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

export type RetentionSummary = {
  label: string;
  title: string;
  expired: boolean;
  indefinite: boolean;
};

/** Formats remaining document retention time or marks it as indefinite. */
export function formatRetentionSummary(document: Pick<DocumentRecord, 'createdAt' | 'retentionEnabled' | 'retentionUnit' | 'retentionValue'>): RetentionSummary {
  const expiry = getExpiryDate(document);
  if (!expiry) return { label: 'Bezterminowo', title: 'Brak określonego terminu życia', expired: false, indefinite: true };
  const diffMs = expiry.getTime() - Date.now();
  const title = `Termin życia do: ${expiry.toLocaleString('pl-PL')}`;
  if (diffMs <= 0) return { label: 'Wygasł', title, expired: true, indefinite: false };
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const unit = years === 1 ? 'rok' : years < 5 ? 'lata' : 'lat';
    return { label: `Pozostało ${years} ${unit}`, title, expired: false, indefinite: false };
  }
  if (days >= 30) return { label: `Pozostało ${Math.floor(days / 30)} mies.`, title, expired: false, indefinite: false };
  if (days >= 1) return { label: `Pozostało ${days} ${days === 1 ? 'dzień' : 'dni'}`, title, expired: false, indefinite: false };
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 1) return { label: `Pozostało ${hours} godz.`, title, expired: false, indefinite: false };
  return { label: `Pozostało ${Math.max(1, Math.ceil(diffMs / 60_000))} min`, title, expired: false, indefinite: false };
}
