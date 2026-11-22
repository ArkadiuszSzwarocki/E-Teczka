import { buildLocalAnalytics } from './localTesterAnalytics';
import {
  clearLocalTesterWorkspace,
  dataUrlToResponse,
  getSelectedDiskFolderName,
  hasActiveDiskPermission,
  isDiskStorageSupported,
  pickTesterDiskDirectory,
  readBlobDataUrl,
  readLocalDb,
  requestSavedDiskPermission,
} from './localTesterDisk';
import { handleDocumentRoutes, handleFolderRoutes, handleTagRoute, jsonResponse } from './localTesterRoutes';

export {
  clearLocalTesterWorkspace,
  getSelectedDiskFolderName,
  hasActiveDiskPermission,
  isDiskStorageSupported,
  pickTesterDiskDirectory,
  requestSavedDiskPermission,
};

export const LOCAL_TESTER_FETCH_FLAG = Symbol('isLocalTesterFetcher');

export function isLocalTesterFetcher(fetcher: typeof fetch): boolean {
  return Boolean((fetcher as typeof fetch & { [LOCAL_TESTER_FETCH_FLAG]?: boolean })?.[LOCAL_TESTER_FETCH_FLAG]);
}

/**
 * Creates a fetch wrapper backed by the user's chosen local disk directory (or IndexedDB fallback).
 * Auth, tester consent, billing, feedback, and plan endpoints still talk to the server.
 */
export function createLocalTesterFetcher(userEmail: string, networkFetch: typeof fetch): typeof fetch {
  const key = `user:${userEmail.trim().toLowerCase()}`;

  const localFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let pathname = rawUrl;
    let searchParams = new URLSearchParams();
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      pathname = parsed.pathname;
      searchParams = parsed.searchParams;
    } catch { /* keep pathname */ }

    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string'
      ? (() => { try { return JSON.parse(init.body) as Record<string, any>; } catch { return {}; } })()
      : {};

    if (pathname.startsWith('/uploads/')) {
      const db = await readLocalDb(key);
      const blob = await readBlobDataUrl(key, db, decodeURIComponent(pathname.slice('/uploads/'.length)));
      return blob ? dataUrlToResponse(blob.dataUrl, blob.mimeType) : new Response('Not found', { status: 404 });
    }

    const handled =
      (await handleFolderRoutes(key, pathname, method, body)) ||
      (await handleDocumentRoutes(key, pathname, method, searchParams, body)) ||
      (await handleTagRoute(key, pathname, method, body));
    if (handled) return handled;

    if (pathname === '/api/billing/usage' && method === 'GET') {
      const db = await readLocalDb(key);
      const docsUsed = db.documents.length;
      const tagsUsed = db.tags.length;
      try {
        const upstream = await networkFetch(input, init);
        if (upstream.ok) {
          const data = await upstream.json() as Record<string, any>;
          const docLimit = typeof data?.documents?.limit === 'number' ? data.documents.limit : null;
          const tagLimit = typeof data?.tags?.limit === 'number' ? data.tags.limit : null;
          return jsonResponse({
            ...data,
            documents: { ...(data.documents || {}), used: docsUsed, limit: docLimit, remaining: docLimit === null ? null : Math.max(0, docLimit - docsUsed) },
            tags: { ...(data.tags || {}), used: tagsUsed, limit: tagLimit, remaining: tagLimit === null ? null : Math.max(0, tagLimit - tagsUsed) },
          });
        }
      } catch { /* fallback when offline */ }
      return jsonResponse({
        plan: 'free',
        documents: { used: docsUsed, limit: 20, remaining: Math.max(0, 20 - docsUsed) },
        tags: { used: tagsUsed, limit: 10, remaining: Math.max(0, 10 - tagsUsed) },
        merge: { used: 0, limit: 5, remaining: 5 },
      });
    }

    if (pathname === '/api/analytics/summary' && method === 'GET') {
      return jsonResponse(buildLocalAnalytics(await readLocalDb(key), searchParams.get('month') || undefined));
    }

    return networkFetch(input, init);
  };

  (localFetch as typeof fetch & { [LOCAL_TESTER_FETCH_FLAG]?: boolean })[LOCAL_TESTER_FETCH_FLAG] = true;
  return localFetch;
}
