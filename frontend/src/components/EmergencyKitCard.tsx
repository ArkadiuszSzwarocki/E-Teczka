import { useState } from 'react';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
};

/** 1-click Family Emergency Kit PDF generator ("Teczka Awaryjna Rodziny"). */
export default function EmergencyKitCard({ apiUrl, fetcher }: Props) {
  const [contacts, setContacts] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generatePdf = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetcher(`${apiUrl}/api/backup/emergency-kit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Nie udało się wygenerować Teczki Awaryjnej.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'MojaTeczka-Teczka-Awaryjna.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd generowania Teczki Awaryjnej.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-emerald-500/35 bg-emerald-950/20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-emerald-300">Plan Rodzinny i Firmowy</span>
          <h4 className="mt-1.5 text-base font-bold text-white">🛟 Teczka Awaryjna Rodziny (Emergency Kit PDF)</h4>
          <p className="mt-1 text-xs text-slate-300">
            Jedno kliknięcie generuje wydruk PDF ze spisem dokumentów z tagiem „Awaryjne” (polisy, kredyty, akty notarialne), ich miejscem przechowywania i instrukcją odzyskania dostępu.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void generatePdf()}
          className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Generowanie PDF…' : '📄 Pobierz Teczkę Awaryjną (PDF)'}
        </button>
      </div>
      <textarea
        rows={2}
        value={contacts}
        onChange={e => setContacts(e.target.value)}
        placeholder="Opcjonalne kontakty alarmowe / notatka dla rodziny (np. agent ubezpieczeniowy, doradca, lokalizacja klucza odzyskiwania)…"
        className="mt-3 w-full rounded-lg border border-slate-700 bg-[#0f172a] px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
      />
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </section>
  );
}
