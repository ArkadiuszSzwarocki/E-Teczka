type Codec = { encrypt: (value: string) => Promise<string>; decrypt: (value: string) => Promise<string>; encryptChunk?: (value: string) => Promise<string>; decryptChunk?: (value: string) => Promise<string> };
type Manifest = { version: 2; directory: string; chunks: number; size: number; filePath: string };
const CHUNK_SIZE = 192 * 1024;
const manifestPath = (root: string, id: number) => `${root}${id}.manifest.enc`;
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function createOfflineChunkStore(FileSystem: typeof import('expo-file-system/legacy'), randomBytes: (length: number) => Promise<Uint8Array>) {
async function readChunkManifest(root: string, id: number, codec: Codec): Promise<Manifest | null> {
  const path = manifestPath(root, id);
  if (!(await FileSystem.getInfoAsync(path)).exists) return null;
  const value: unknown = JSON.parse(await codec.decrypt(await FileSystem.readAsStringAsync(path)));
  const manifest = value as Partial<Manifest>;
  if (manifest.version !== 2 || typeof manifest.directory !== 'string' || !new RegExp(`^${id}\\.chunks-[0-9a-f]{16}$`).test(manifest.directory) || !Number.isInteger(manifest.chunks) || Number(manifest.chunks) < 0 || !Number.isSafeInteger(manifest.size) || Number(manifest.size) < 0 || typeof manifest.filePath !== 'string') throw new Error('Nieprawidłowe dane kopii offline.');
  return manifest as Manifest;
}

async function encryptFileInChunks(root: string, id: number, filePath: string, source: string, codec: Codec, onProgress?: (done: number, total: number) => void) {
  const info = await FileSystem.getInfoAsync(source);
  if (!info.exists || !('size' in info) || typeof info.size !== 'number') throw new Error('Nie znaleziono pobranego pliku.');
  const suffix = Array.from(await randomBytes(8)).map(value => value.toString(16).padStart(2, '0')).join('');
  const directory = `${id}.chunks-${suffix}`; const folder = `${root}${directory}/`;
  const tempManifest = `${root}${id}.${suffix}.manifest.tmp`;
  const chunks = Math.ceil(info.size / CHUNK_SIZE);
  let committed = false;
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  try {
    for (let index = 0; index < chunks; index++) {
      const position = index * CHUNK_SIZE;
      const data = await FileSystem.readAsStringAsync(source, { encoding: FileSystem.EncodingType.Base64, position, length: Math.min(CHUNK_SIZE, info.size - position) });
      await FileSystem.writeAsStringAsync(`${folder}${index}.enc`, await (codec.encryptChunk || codec.encrypt)(data));
      onProgress?.(index + 1, chunks); await yieldToUI();
    }
    const manifest: Manifest = { version: 2, directory, chunks, size: info.size, filePath };
    await FileSystem.writeAsStringAsync(tempManifest, await codec.encrypt(JSON.stringify(manifest)));
    await FileSystem.moveAsync({ from: tempManifest, to: manifestPath(root, id) });
    committed = true;
  } finally {
    if (!committed) { await FileSystem.deleteAsync(tempManifest, { idempotent: true }).catch(() => undefined); await FileSystem.deleteAsync(folder, { idempotent: true }).catch(() => undefined); }
  }
}

async function decryptFileInChunks(root: string, id: number, target: string, manifest: Manifest, codec: Codec) {
  const temp = `${target}.${Date.now()}.partial`;
  try {
    if (!manifest.chunks) await FileSystem.writeAsStringAsync(temp, '', { encoding: FileSystem.EncodingType.Base64 });
    for (let index = 0; index < manifest.chunks; index++) {
      const encrypted = await FileSystem.readAsStringAsync(`${root}${manifest.directory}/${index}.enc`);
      const data = encrypted.startsWith('v3:') && codec.decryptChunk ? await codec.decryptChunk(encrypted) : await codec.decrypt(encrypted);
      await FileSystem.writeAsStringAsync(temp, data, { encoding: FileSystem.EncodingType.Base64, append: index > 0 });
      await yieldToUI();
    }
    const result = await FileSystem.getInfoAsync(temp);
    if (!result.exists || !('size' in result) || result.size !== manifest.size) throw new Error('Niepełna kopia pliku offline.');
    await FileSystem.moveAsync({ from: temp, to: target });
    return target;
  } catch (error) { await FileSystem.deleteAsync(temp, { idempotent: true }).catch(() => undefined); throw error; }
}
return { readChunkManifest, encryptFileInChunks, decryptFileInChunks };
}
