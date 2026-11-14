import { useCallback, useEffect, useState } from 'react';

type Props = { apiUrl: string; documentId: number; title: string; fetcher: typeof fetch; onClose: () => void };
type Status = { state: 'not_started' | 'queued' | 'processing' | 'done' | 'error' | 'paused'; error?: string | null; text?: string };
const labels: Record<Status['state'], string> = { not_started: 'Nie uruchomiono', queued: 'W kolejce', processing: 'Rozpoznawanie…', done: 'Gotowe', error: 'Błąd', paused: 'Wstrzymane' };

export default function OcrPanel({ apiUrl, documentId, title, fetcher, onClose }: Props) {
  const [status, setStatus] = useState<Status | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState('');
  const load = useCallback(async () => {
    try { const response = await fetcher(`${apiUrl}/api/ocr/${documentId}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Nie udało się pobrać wyniku OCR.'); setStatus(data); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać wyniku OCR.'); }
  }, [apiUrl, documentId, fetcher]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 3000); return () => window.clearInterval(timer); }, [load]);
  const start = async () => {
    setBusy(true); setError('');
    try { const response = await fetcher(`${apiUrl}/api/ocr/${documentId}`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Nie udało się uruchomić OCR.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się uruchomić OCR.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try { const response = await fetcher(`${apiUrl}/api/ocr/${documentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: draft }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Nie udało się zapisać tekstu.'); setEditing(false); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać tekstu.'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4"><section role="dialog" aria-modal="true" aria-labelledby="ocr-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
    <div className="flex items-start justify-between gap-3"><div><h2 id="ocr-title" className="text-lg font-bold text-white">Rozpoznany tekst — OCR</h2><p className="mt-1 break-words text-sm text-slate-400">{title}</p></div><button type="button" onClick={onClose} aria-label="Zamknij" className="text-2xl text-slate-400">×</button></div>
    <p className="mt-4 text-sm">Stan: <strong>{status ? labels[status.state] : 'Pobieranie…'}</strong></p>
    {(error || status?.error) && <p role="alert" className="mt-2 text-sm text-red-300">{error || status?.error}</p>}
    <p className="mt-2 text-xs text-slate-400">Rozpoznawanie odbywa się lokalnie. Oryginalny dokument nie jest zmieniany. Wynik może zawierać błędy.</p>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || editing || status?.state === 'queued' || status?.state === 'processing'} onClick={() => void start()} className="rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{status?.state === 'done' ? 'Rozpoznaj ponownie' : 'Rozpoznaj tekst'}</button>{!editing && <button type="button" disabled={busy || !status?.text || status.state === 'queued' || status.state === 'processing'} onClick={() => { setDraft(status?.text || ''); setEditing(true); }} className="rounded border border-slate-500 px-4 py-2 disabled:opacity-50">Popraw tekst</button>}{editing && <><button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-emerald-700 px-4 py-2 disabled:opacity-50">Zapisz tekst</button><button type="button" disabled={busy} onClick={() => setEditing(false)} className="rounded border border-slate-500 px-4 py-2">Anuluj</button></>}</div>
    {editing ? <textarea value={draft} maxLength={2_000_000} onChange={event => setDraft(event.target.value)} aria-label="Rozpoznany tekst dokumentu" className="mt-4 min-h-48 w-full resize-y rounded border border-slate-700 bg-[#111827] p-4 text-sm" /> : <pre className="mt-4 min-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-700 bg-[#111827] p-4 font-sans text-sm">{status?.text || 'Tutaj pojawi się rozpoznany tekst.'}</pre>}
  </section></div>;
}
