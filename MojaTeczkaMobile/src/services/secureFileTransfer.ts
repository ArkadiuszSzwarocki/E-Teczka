import ReactNativeBlobUtil from 'react-native-blob-util';
import * as FileSystem from 'expo-file-system/legacy';

/** Uses React Native's pinned OkHttp client; no Expo filesystem HTTP client. */
export async function downloadSecureFile(url: string, target: string, headers: Record<string, string>, onProgress?: (done: number, total: number) => void) {
  if (!url.startsWith('https://')) throw new Error('Pobieranie wymaga HTTPS.');
  let lastProgress = Date.now();
  const task = ReactNativeBlobUtil.config({ path: target.replace(/^file:\/\//, ''), followRedirect: false }).fetch('GET', url, headers);
  task.progress({ interval: 500 }, (received, total) => { lastProgress = Date.now(); onProgress?.(Number(received), Number(total)); });
  let timer: ReturnType<typeof setInterval> | undefined;
  let timedOut = false;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setInterval(() => { if (Date.now() - lastProgress < 30_000) return; timedOut = true; if (timer) clearInterval(timer); task.cancel(); reject(new Error('Pobieranie zatrzymało się na ponad 30 sekund.')); }, 2000); });
    const response = await Promise.race([task, timeout]);
    const status = response.info().status;
    if (status !== 200) throw new Error(`Komputer nie udostępnił dokumentu (HTTP ${status}).`);
    return { uri: target, status };
  } catch (error) {
    if (timedOut) void task.finally(() => FileSystem.deleteAsync(target, { idempotent: true })).catch(() => undefined);
    else await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    throw error;
  } finally { if (timer) clearInterval(timer); }
}
export async function uploadSecureScanPage(url: string, uri: string, headers: Record<string, string>, draftId: string, pageNumber: number) {
  if (!url.startsWith('https://')) throw new Error('Wysyłanie wymaga HTTPS.');
  const response = await ReactNativeBlobUtil.config({ followRedirect: false, timeout: 45_000 }).fetch('POST', url, { ...headers, 'Content-Type': 'multipart/form-data' }, [
    { name: 'draftId', data: draftId }, { name: 'pageNumber', data: String(pageNumber) },
    { name: 'file', filename: `page-${pageNumber}.jpg`, type: 'image/jpeg', data: ReactNativeBlobUtil.wrap(uri.replace(/^file:\/\//, '')) },
  ]);
  return { status: response.info().status };
}
