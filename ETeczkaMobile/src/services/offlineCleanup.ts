type LocalFiles = Pick<typeof import('expo-file-system/legacy'), 'getInfoAsync' | 'readDirectoryAsync' | 'deleteAsync'>;
const isOfflineCacheFile = (name: string) => /^vault-\d+(?:-\d+)?(?:\.download)?$/.test(name) || /^opened-\d+\.[a-z0-9]{1,16}(?:\.\d+\.partial)?$/i.test(name) || /^eteczka(?:_v2)?_\d+\.[a-z0-9]{1,16}(?:\.[a-z0-9.-]+\.download)?$/i.test(name);

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
