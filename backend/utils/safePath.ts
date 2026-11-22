import path from 'node:path';

/** Resolves a path inside baseDir and throws if the resolved path escapes baseDir. */
export function resolveSafePath(baseDir: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, ...segments);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error('Nieprawidłowa ścieżka pliku.');
  }
  return resolvedTarget;
}
