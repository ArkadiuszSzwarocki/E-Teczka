import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createQrFrameDecoder } from '../services/qrFrameDecoder';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  initialFolderId: string;
  folderOptions: ReactNode[];
  onImported: () => Promise<void>;
  onClose: () => void;
  showToast: (message: string, type?: string) => void;
};

/** Modal for importing an e-Receipt from a QR code, link, or JSON payload. */
export default function EReceiptImportModal({
  apiUrl, fetcher, initialFolderId, folderOptions, onImported, onClose, showToast,
}: Props) {
  const [folderId, setFolderId] = useState(initialFolderId);
  const [payload, setPayload] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanningQr, setScanningQr] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const scanSessionRef = useRef(0);

  const stopCamera = () => {
    scanSessionRef.current += 1;
    if (tickTimerRef.current !== null) {
      window.clearTimeout(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (mountedRef.current) setScanningQr(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scanSessionRef.current += 1;
      if (tickTimerRef.current !== null) {
        window.clearTimeout(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  const startQrScan = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Brak dostępu do aparatu w tej przeglądarce (wymagane HTTPS lub localhost). Wklej kod QR albo JSON poniżej.');
      return;
    }
    const session = ++scanSessionRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!mountedRef.current || scanSessionRef.current !== session) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      setScanningQr(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      });
      const decoder = createQrFrameDecoder();
      const tick = async () => {
        if (!mountedRef.current || scanSessionRef.current !== session || !streamRef.current || !videoRef.current) return;
        try {
          const value = await decoder.decode(videoRef.current);
          if (value && scanSessionRef.current === session) {
            setPayload(value);
            stopCamera();
            return;
          }
        } catch { /* wait next frame */ }
        if (mountedRef.current && scanSessionRef.current === session && streamRef.current) {
          tickTimerRef.current = window.setTimeout(() => void tick(), 250);
        }
      };
      tickTimerRef.current = window.setTimeout(() => void tick(), 400);
    } catch {
      stopCamera();
      setError('Brak dostępu do aparatu. Wklej kod QR lub JSON e-Paragonu ręcznie.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderId || !payload.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetcher(`${apiUrl}/api/automation/e-receipt/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: Number(folderId),
          payload: payload.trim(),
          ...(title.trim() ? { title: title.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: string;
        parsed?: { merchantName?: string; amountCents?: number; currency?: string; suggestWarrantyYears?: number | null };
      };
      if (!res.ok) throw new Error(data.error || 'Nie udało się zaimportować e-Paragonu.');
      const amt = typeof data.parsed?.amountCents === 'number'
        ? `${(data.parsed.amountCents / 100).toFixed(2)} ${data.parsed.currency || 'PLN'}`
        : '';
      const warranty = data.parsed?.suggestWarrantyYears ? ` (ustawiono gwarancję ${data.parsed.suggestWarrantyYears} lata)` : '';
      showToast(`Zaimportowano e-Paragon: ${data.parsed?.merchantName || ''} ${amt}${warranty}`.trim(), 'success');
      await onImported();
      stopCamera();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd importu e-Paragonu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={() => { stopCamera(); onClose(); }} className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 p-4">
      <section role="dialog" aria-modal="true" aria-label="Importuj e-Paragon" onClick={e => e.stopPropagation()} className="w-full max-w-xl space-y-4 rounded-2xl border border-slate-600 bg-[#1e293b] p-5 text-slate-200 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-white">📲 Importuj e-Paragon (QR / JSON)</h3>
            <p className="mt-0.5 text-xs text-slate-400">Wklej zawartość kodu QR, link e-paragonu lub plik JSON. Dla aplikacji takich jak Moja Biedronka lub Lidl Plus możesz też pobrać paragon jako PDF i wgrać go w formularzu obok.</p>
          </div>
          <button type="button" onClick={() => { stopCamera(); onClose(); }} aria-label="Zamknij" className="rounded px-2 py-1 text-xl text-slate-400 hover:bg-slate-700 hover:text-white">×</button>
        </div>

        <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-300">Docelowa kartoteka</label>
            <select value={folderId} onChange={e => setFolderId(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2.5 text-sm text-white">
              <option value="">-- Wybierz kartotekę --</option>
              {folderOptions}
            </select>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300">Kod QR / link / JSON e-Paragonu</label>
              <button
                type="button"
                onClick={() => (scanningQr ? stopCamera() : void startQrScan())}
                className="rounded-md border border-cyan-500/50 bg-cyan-950/40 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50"
              >
                {scanningQr ? '⏹ Zatrzymaj kamerę' : '📷 Skanuj QR aparatem'}
              </button>
            </div>
            {scanningQr && (
              <div className="mb-2 overflow-hidden rounded-lg border border-cyan-500/40 bg-black">
                <video ref={videoRef} playsInline muted className="max-h-52 w-full object-cover" />
              </div>
            )}
            <textarea
              rows={4}
              value={payload}
              onChange={e => setPayload(e.target.value)}
              placeholder={'np. SKLEP:Biedronka;SUMA:48.90;DATA:2026-11-22\nlub JSON / link QR e-Paragonu'}
              className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2.5 font-mono text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Własny tytuł (opcjonalnie)</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="np. Zakupy Biedronka"
              className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2.5 text-sm text-white placeholder-slate-500"
            />
          </div>

          {error && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">⚠️ {error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => { stopCamera(); onClose(); }} className="rounded-lg border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700">
              Anuluj
            </button>
            <button type="submit" disabled={busy || !folderId || !payload.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-45">
              {busy ? 'Importowanie…' : '✅ Importuj e-Paragon'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
