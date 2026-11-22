import { useState } from 'react';
import { applyClientPreferences, collectClientPreferences } from '../services/preferencesBackup';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  isPremiumPlan?: boolean;
  onRestored?: () => void;
};

/** Card for exporting and restoring non-secret system settings, mailbox metadata, preferences, and learned rules (Premium+). */
export function BackupSettingsTransferCard({ apiUrl, fetcher, isPremiumPlan = false, onRestored }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetcher(`${apiUrl}/api/backup/settings/export`);
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Nie udało się wyeksportować ustawień.');

      const payload = {
        ...data,
        clientPreferences: collectClientPreferences(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eteczka-ustawienia-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus({ ok: true, message: 'Pobrano kopię ustawień, preferencji i wyuczonej wiedzy systemu (bez haseł).' });
    } catch (error) {
      setStatus({ ok: false, message: error instanceof Error ? error.message : 'Błąd eksportu ustawień.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreFile = async (file: File) => {
    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const res = await fetcher(`${apiUrl}/api/backup/settings/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const summary = await res.json() as {
        error?: string;
        mailAccountsRestored?: number;
        excludedSendersCount?: number;
        senderRulesCount?: number;
        learnedSignaturesCount?: number;
      };
      if (!res.ok) throw new Error(summary.error || 'Nie udało się przywrócić ustawień.');
      const prefCount = applyClientPreferences(parsed.clientPreferences);
      setStatus({
        ok: true,
        message: `Przywrócono ustawienia: skrzynki (${summary.mailAccountsRestored ?? 0}, bez haseł), wykluczeni nadawcy (${summary.excludedSendersCount ?? 0}), reguły auto-kartotek (${summary.senderRulesCount ?? 0}), wyuczone dopasowania (${summary.learnedSignaturesCount ?? 0}), preferencje (${prefCount}).`,
      });
      onRestored?.();
    } catch (error) {
      setStatus({ ok: false, message: error instanceof Error ? error.message : 'Nie udało się wczytać pliku ustawień.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-cyan-500/30 bg-[#111827]/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">⚙️ Kopia zapasowa ustawień i wiedzy systemu (bez haseł)</h3>
          <p className="mt-1 text-xs text-slate-400">
            Zawiera podłączone skrzynki pocztowe (bez haseł), reguły nadawców, wykluczenia, wyuczone dopasowania kartotek (NIP/nadawcy), konfigurację folderu obserwowanego, preferencje wyglądu oraz miejsce kopii (bez haseł i tokenów).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!isPremiumPlan || busy}
          onClick={() => void handleExport()}
          title={!isPremiumPlan ? 'Dostępne od pakietu Premium' : undefined}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-45"
        >
          ⬇️ Pobierz kopię ustawień (.json)
        </button>
        <label
          title={!isPremiumPlan ? 'Dostępne od pakietu Premium' : undefined}
          className={`rounded-lg border border-cyan-500/50 bg-cyan-950/30 px-4 py-2 text-xs font-semibold text-cyan-200 ${
            !isPremiumPlan || busy ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:bg-cyan-900/40'
          }`}
        >
          ⬆️ Przywróć ustawienia z pliku (.json)
          <input
            type="file"
            accept=".json,application/json"
            disabled={!isPremiumPlan || busy}
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void handleRestoreFile(file);
              e.target.value = '';
            }}
          />
        </label>
        {!isPremiumPlan && (
          <span className="text-[11px] font-medium text-amber-300/90">
            🔒 Dostępne od pakietu Premium
          </span>
        )}
      </div>

      {status && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-xs font-medium ${status.ok ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-200' : 'border-rose-500/50 bg-rose-950/40 text-rose-200'}`}>
          {status.ok ? '✅ ' : '❌ '}
          {status.message}
        </p>
      )}
    </div>
  );
}
