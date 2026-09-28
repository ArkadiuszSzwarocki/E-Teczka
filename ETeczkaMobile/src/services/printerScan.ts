import * as FileSystem from 'expo-file-system/legacy';
import { getApiUrl, getAuthHeaders } from './localConnection';
import type { RetentionUnit } from '../types/domain';

export type PrinterDevice = { id: string; name: string; manufacturer?: string };

type StartPrinterScanInput = {
  folderId: number;
  deviceId: string;
  title: string;
  retentionEnabled: boolean;
  retentionValue: string;
  retentionUnit: RetentionUnit;
  onStage: (label: string) => void;
};

export async function fetchPrinterDevices(): Promise<PrinterDevice[]> {
  const response = await fetch(await getApiUrl('/api/printer-scan/devices'), { headers: await getAuthHeaders() });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error((data as { error?: string }).error || 'Nie udało się wykryć skanerów.');
  return Array.isArray(data) ? data as PrinterDevice[] : [];
}

/** Starts WIA on the desktop and downloads one scanned page to the phone. */
export async function scanPrinterPage(input: StartPrinterScanInput): Promise<string> {
  const apiUrl = (await getApiUrl('/')).replace(/\/$/, '');
  const headers = await getAuthHeaders();
  input.onStage('Wysyłanie zlecenia do komputera…');
  const response = await fetch(`${apiUrl}/api/printer-scan`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderId: input.folderId, deviceId: input.deviceId, title: input.title,
      retentionEnabled: input.retentionEnabled, retentionValue: input.retentionValue, retentionUnit: input.retentionUnit,
    }),
  });
  const started = await response.json() as { jobId?: string; error?: string };
  if (!response.ok || !started.jobId) throw new Error(started.error || 'Komputer nie przyjął zlecenia.');

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const statusResponse = await fetch(`${apiUrl}/api/printer-scan/${started.jobId}`, { headers });
    const status = await statusResponse.json() as { status?: string; stage?: string; error?: string };
    if (!statusResponse.ok) throw new Error(status.error || 'Utracono status skanowania.');
    input.onStage(status.stage || 'Trwa skanowanie…');
    if (status.status === 'failed') throw new Error(status.error || 'Skanowanie nie powiodło się.');
    if (status.status !== 'completed') continue;

    input.onStage('Pobieranie strony do wersji roboczej…');
    const localUri = `${FileSystem.documentDirectory}printer_draft_${Date.now()}.jpg`;
    const downloaded = await FileSystem.downloadAsync(`${apiUrl}/api/printer-scan/${started.jobId}/file`, localUri, { headers });
    if (downloaded.status !== 200) throw new Error(`Komputer nie udostępnił skanu (kod ${downloaded.status}). Spróbuj ponownie; jeśli problem wróci, otwórz E‑Teczkę na komputerze.`);
    return localUri;
  }
  throw new Error('Skanowanie trwa zbyt długo. Sprawdź drukarkę i kartotekę na komputerze.');
}
