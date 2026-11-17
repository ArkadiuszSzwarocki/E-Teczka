import type { DocumentRecord, Tag } from '../types/domain';
import { getExpiryDate } from './documentLifecycle';

export type DocSortField = 'name' | 'size' | 'createdAt' | 'retention';
export type SortDir = 'asc' | 'desc';
export type RetentionFilter = 'all' | 'active' | 'indefinite' | 'expired' | 'range';
export type TypeFilter = 'all' | 'pdf' | 'image';

export type DocFilterState = {
  sortBy: DocSortField;
  sortDir: SortDir;
  tagId: string;
  retentionFilter: RetentionFilter;
  retentionFrom: string;
  retentionTo: string;
  typeFilter: TypeFilter;
};

export const DEFAULT_DOC_FILTER: DocFilterState = {
  sortBy: 'createdAt',
  sortDir: 'desc',
  tagId: '',
  retentionFilter: 'all',
  retentionFrom: '',
  retentionTo: '',
  typeFilter: 'all',
};

/** Collects unique tags present on a list of documents, sorted alphabetically. */
export function collectDocumentTags(docs: DocumentRecord[]): Tag[] {
  const byId = new Map<number, Tag>();
  for (const doc of docs) {
    for (const entry of doc.tags || []) {
      if (entry.tag && !byId.has(entry.tag.id)) byId.set(entry.tag.id, entry.tag);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

/** Filters and sorts documents by name, size, creation date, retention, tags, and type. */
export function filterAndSortDocuments(docs: DocumentRecord[], filter: DocFilterState): DocumentRecord[] {
  const now = Date.now();
  const filtered = docs.filter((doc) => {
    if (filter.tagId && !(doc.tags || []).some((entry) => String(entry.tagId) === filter.tagId)) return false;
    if (filter.retentionFilter !== 'all') {
      const expiry = getExpiryDate(doc);
      if (filter.retentionFilter === 'indefinite' && expiry !== null) return false;
      if (filter.retentionFilter === 'active' && (!expiry || expiry.getTime() <= now)) return false;
      if (filter.retentionFilter === 'expired' && (!expiry || expiry.getTime() > now)) return false;
      if (filter.retentionFilter === 'range') {
        if (!expiry) return false;
        if (filter.retentionFrom && expiry.getTime() < new Date(`${filter.retentionFrom}T00:00:00`).getTime()) return false;
        if (filter.retentionTo && expiry.getTime() > new Date(`${filter.retentionTo}T23:59:59.999`).getTime()) return false;
      }
    }
    if (filter.typeFilter !== 'all') {
      const isPdf = doc.mimeType.includes('pdf') || doc.title.toLowerCase().endsWith('.pdf');
      if (filter.typeFilter === 'pdf' && !isPdf) return false;
      if (filter.typeFilter === 'image' && isPdf) return false;
    }
    return true;
  });

  const dir = filter.sortDir === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => {
    if (filter.sortBy === 'name') return dir * a.title.localeCompare(b.title, 'pl', { sensitivity: 'base' });
    if (filter.sortBy === 'size') return dir * ((a.fileSize || 0) - (b.fileSize || 0));
    if (filter.sortBy === 'createdAt') return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const expA = getExpiryDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const expB = getExpiryDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return dir * (expA - expB);
  });
}
