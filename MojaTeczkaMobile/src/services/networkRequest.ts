export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, operation: string): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    if (timedOut) throw new Error(`${operation}: komputer nie odpowiedział w ciągu ${Math.round(timeoutMs / 1000)} sekund. Sprawdź połączenie Wi‑Fi i czy E‑Teczka działa na komputerze.`);
    throw new Error(`${operation}: połączenie z komputerem zostało przerwane. Sprawdź Wi‑Fi i adres komputera w ustawieniach.`);
  } finally { clearTimeout(timeout); }
}
