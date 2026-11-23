import { useState } from 'react';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  onClose: () => void;
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Błąd odczytu pliku.')));
    reader.onerror = () => reject(new Error('Błąd odczytu pliku.'));
    reader.readAsDataURL(file);
  });
}

/** Composes front + back ID card photos onto one A4 PDF with a diagonal purpose-bound watermark. */
export default function IdCardCopyModal({ apiUrl, fetcher, onClose }: Props) {
  const [frontDataUrl, setFrontDataUrl] = useState('');
  const [backDataUrl, setBackDataUrl] = useState('');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File | undefined, side: 'front' | 'back') => {
    if (!file) return;
    try {
      const url = await readAsDataUrl(file);
      if (side === 'front') setFrontDataUrl(url);
      else setBackDataUrl(url);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się wczytać obrazu.');
    }
  };

  const generate = async () => {
    if (!frontDataUrl) { setError('Wybierz przynajmniej zdjęcie przodu dokumentu.'); return; }
    if (!recipient.trim()) { setError('Wpisz nazwę odbiorcy (np. Bank PKO, Wypożyczalnia).'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetcher(`${apiUrl}/api/documents/id-card-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontDataUrl, backDataUrl: backDataUrl || undefined, recipient: recipient.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Nie udało się wygenerować bezpiecznej kopii.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kopia-dokumentu-${recipient.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 28)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd generowania PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" className="w-full max-w-2xl rounded-2xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-blue-400">Ochrona tożsamości</p>
            <h3 className="mt-1 text-xl font-bold text-white">🪪 Bezpieczna kopia dowodu / karty (2 strony na 1 A4)</h3>
            <p className="mt-1 text-xs text-slate-400">
              Złóż przód i tył dokumentu na jednej stronie A4 z ukośnym znakiem wodnym celu — nikt nie użyje kopii poza wskazaną instytucją.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-slate-300">
            Kopia wyłącznie dla (odbiorca na znaku wodnym):
            <input
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="np. Bank PKO BP / Wypożyczalnia aut / Biuro podróży"
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-900/60 p-4 text-center hover:border-blue-400">
              <span className="text-xs font-bold text-white">{frontDataUrl ? '✅ Przód załadowany' : '📷 Zdjęcie PRZODU (JPG/PNG)'}</span>
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => void handleFile(e.target.files?.[0], 'front')} />
            </label>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-900/60 p-4 text-center hover:border-blue-400">
              <span className="text-xs font-bold text-white">{backDataUrl ? '✅ Tył załadowany' : '📷 Zdjęcie TYŁU (opcjonalnie)'}</span>
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => void handleFile(e.target.files?.[0], 'back')} />
            </label>
          </div>
        </div>

        {error && <p role="alert" className="mt-3 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Anuluj</button>
          <button type="button" disabled={busy} onClick={() => void generate()} className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50">
            {busy ? 'Generowanie A4 PDF…' : '📄 Pobierz bezpieczną kopię PDF'}
          </button>
        </div>
      </section>
    </div>
  );
}
