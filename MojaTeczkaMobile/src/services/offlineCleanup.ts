type LocalFiles = Pick<typeof import('expo-file-system/legacy'), 'getInfoAsync' | 'readDirectoryAsync' | 'deleteAsync'>;
const isOfflineCacheFile = (name: string) => /^vault-\d+(?:-\d+)?(?:\.download)?$/.test(name) || /^opened-\d+\.[a-z0-9]{1,16}(?:\.\d+\.partial)?$/i.test(name) || /^(?:mojateczka|eteczka)(?:_v2)?_\d+\.[a-z0-9]{1,16}(?:\.[a-z0-9.-]+\.download)?$/i.test(name);

export async function getOfflineCacheBytes(fs: LocalFiles, cacheRoot: string | null) {
  if (!cacheRoot || !(await fs.getInfoAsync(cacheRoot)).exists) return 0;
  let total = 0;
  for (const name of await fs.readDirectoryAsync(cacheRoot)) if (isOfflineCacheFile(name)) {
    const info = await fs.getInfoAsync(`${cacheRoot}${name}`);
    if (info.exists && !info.isDirectory && 'size' in info) total += Number(info.size || 0);
  }
  return total;
}

/** Remove only files generated for offline copies or the document viewer. */
export async function removeOfflineFiles(fs: LocalFiles, vaultRoot: string, cacheRoot: string | null, onProgress?: (removed: number, total: number) => void) {
  const targets: string[] = [];
  if ((await fs.getInfoAsync(vaultRoot)).exists) {
    for (const name of await fs.readDirectoryAsync(vaultRoot)) {
      if (/^ocr-\d+\.enc(?:\.\d+\.tmp)?$/.test(name) || /^\d+\.enc$/.test(name) || /^\d+\.manifest\.enc$/.test(name) || /^\d+\.chunks-[0-9a-f]{16}$/.test(name) || /^\d+\.[0-9a-f]{16}\.manifest\.tmp$/.test(name)) targets.push(`${vaultRoot}${name}`);
    }
  }
  if (cacheRoot && (await fs.getInfoAsync(cacheRoot)).exists) {
    for (const name of await fs.readDirectoryAsync(cacheRoot)) {
      if (isOfflineCacheFile(name)) targets.push(`${cacheRoot}${name}`);
    }
  }
  for (let i = 0; i < targets.length; i++) { await fs.deleteAsync(targets[i], { idempotent: true }); onProgress?.(i + 1, targets.length); }
  return targets.length;
}

const DEFAULT_CACHE_LIMIT_BYTES = 500 * 1024 * 1024;
const DEFAULT_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Garbage-collects temporary opened/vault binary cache files using LRU + max-age
 * while leaving lightweight folder/document JSON catalog caches untouched.
 */
export async function pruneOfflineCache(
  fs: LocalFiles,
  cacheRoot: string | null,
  options?: { maxBytes?: number; maxAgeMs?: number; now?: number },
): Promise<{ removedCount: number; freedBytes: number; remainingBytes: number }> {
  if (!cacheRoot || !(await fs.getInfoAsync(cacheRoot)).exists) {
    return { removedCount: 0, freedBytes: 0, remainingBytes: 0 };
  }

  const maxBytes = options?.maxBytes ?? DEFAULT_CACHE_LIMIT_BYTES;
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;
  const now = options?.now ?? Date.now();

  const entries: Array<{ path: string; size: number; mtimeMs: number }> = [];
  for (const name of await fs.readDirectoryAsync(cacheRoot)) {
    if (!isOfflineCacheFile(name)) continue;
    const fullPath = `${cacheRoot}${name}`;
    const info = await fs.getInfoAsync(fullPath);
    if (!info.exists || info.isDirectory) continue;
    const size = Number('size' in info ? info.size || 0 : 0);
    const rawMtime = Number('modificationTime' in info ? info.modificationTime || 0 : 0);
    const mtimeMs = rawMtime > 1e12 ? rawMtime : rawMtime * 1000;
    entries.push({ path: fullPath, size, mtimeMs });
  }

  let removedCount = 0;
  let freedBytes = 0;
  const kept: typeof entries = [];

  for (const entry of entries) {
    if (maxAgeMs > 0 && entry.mtimeMs > 0 && now - entry.mtimeMs > maxAgeMs) {
      await fs.deleteAsync(entry.path, { idempotent: true });
      removedCount += 1;
      freedBytes += entry.size;
    } else {
      kept.push(entry);
    }
  }

  let remainingBytes = kept.reduce((sum, item) => sum + item.size, 0);
  if (remainingBytes > maxBytes) {
    kept.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of kept) {
      if (remainingBytes <= maxBytes) break;
      await fs.deleteAsync(entry.path, { idempotent: true });
      removedCount += 1;
      freedBytes += entry.size;
      remainingBytes -= entry.size;
    }
  }

  return { removedCount, freedBytes, remainingBytes };
}
