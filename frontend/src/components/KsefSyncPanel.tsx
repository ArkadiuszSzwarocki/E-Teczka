import { useCallback, useEffect, useState } from 'react';
import type { FolderRecord } from '../types/domain';

type KsefConfig = {
  configured: boolean;
  nip: string;
  environment: 'test' | 'demo' | 'prod';
  targetFolderId: number | null;
  schedule: 'manual' | 'daily';
  hasToken: boolean;
  lastSyncAt: string | null;
  lastSyncCount: number;
  lastSyncError: string | null;
};

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  folders: FolderRecord[];
  billingPlan: string;
  onSynced: () => Promise<void> | void;
  showToast: (message: string, type?: string) => void;
};

/** Configuration and 1-click sync panel for official Polish MF KSeF API (Business JDG plan). */
export default function KsefSyncPanel({ apiUrl, fetcher, folders, billingPlan, onSynced, showToast }: Props) {
  const [config, setConfig] = useState<KsefConfig | null>(null);
  const [nip, setNip] = useState('');
  const [token, setToken] = useState('');
  const [environment, setEnvironment] = useState<'test' | 'demo' | 'prod'>('test');
  const [targetFolderId, setTargetFolderId] = useState<string>('');
  const [schedule, setSchedule] = useState<'manual' | 'daily'>('daily');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const isBusiness = billingPlan === 'business';

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetcher(`${apiUrl}/api/ksef/config`);
      if (!res.ok) return;
      const data = (await res.json()) as KsefConfig;
      setConfig(data);
      setNip(data.nip || '');
      setEnvironment(data.environment || 'test');
      setTargetFolderId(data.targetFolderId ? String(data.targetFolderId) : '');
      setSchedule(data.schedule || 'manual');
    } catch { /* ignore */ }
  }, [apiUrl, fetcher]);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetcher(`${apiUrl}/api/ksef/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nip, token: token || undefined, environment, targetFolderId: targetFolderId ? Number(targetFolderId) : null, schedule }),
      });
      const payload = await res.json().catch(() => ({})) as KsefConfig & { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Nie udało się zapisać ustawień KSeF.');
      setConfig(payload);
      setToken('');
      showToast('Zapisano szyfrowaną konfigurację KSeF.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd zapisu KSeF.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetcher(`${apiUrl}/api/ksef/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack: 30 }),
      });
      const payload = await res.json().catch(() => ({})) as { imported?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Nie udało się pobrać faktur z KSeF.');
      await loadConfig();
      await onSynced();
      showToast(`KSeF: pobrano ${payload.imported ?? 0} nowych faktur (pominięto duplikaty: ${payload.skipped ?? 0}).`, 'success');
    } catch (err) {
      await loadConfig();
      showToast(err instanceof Error ? err.message : 'Błąd pobierania z KSeF.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl rounded-2xl border border-slate-700 bg-[#111c33]/90 p-6 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase text-indigo-300">Plan Firmowy (JDG)</span>
          <h3 className="mt-2 text-xl font-bold text-white">🏛️ KSeF — automatyczne pobieranie faktur z API MF</h3>
          <p className="mt-1 text-xs text-slate-400">Token KSeF jest szyfrowany lokalnie (AES-256-GCM). Pobrane faktury kosztowe automatycznie trafiają do wybranej kartoteki z pełnym podglądem pozycji.</p>
        </div>
        {config?.configured && (
          <button type="button" disabled={syncing || !isBusiness} onClick={() => void syncNow()} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
            {syncing ? 'Pobieranie z MF…' : '⬇️ Pobierz faktury z KSeF'}
          </button>
        )}
      </div>

      {!isBusiness && (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
          Funkcja dostępna w planie <strong>Firmowy (JDG)</strong>. Zmień plan w menu użytkownika, aby włączyć automatyczną synchronizację z KSeF.
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-300">
          NIP firmy (10 cyfr)
          <input value={nip} onChange={e => setNip(e.target.value)} placeholder="np. 5210082546" className="mt-1 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white" />
        </label>
        <label className="text-xs font-semibold text-slate-300">
          Środowisko MF KSeF
          <select value={environment} onChange={e => setEnvironment(e.target.value as 'test' | 'demo' | 'prod')} className="mt-1 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white">
            <option value="test">Testowe (ksef-test.mf.gov.pl)</option>
            <option value="demo">Demo (ksef-demo.mf.gov.pl)</option>
            <option value="prod">Produkcyjne (ksef.mf.gov.pl)</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-300 sm:col-span-2">
          Token autoryzacyjny KSeF {config?.hasToken ? '(zapisany — zostaw puste, aby zachować obecny)' : ''}
          <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Wklej token wygenerowany w Aplikacji Podatnika KSeF" className="mt-1 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white" />
        </label>
        <label className="text-xs font-semibold text-slate-300">
          Kartoteka docelowa dla faktur
          <select value={targetFolderId} onChange={e => setTargetFolderId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white">
            <option value="">Automatycznie (KSeF Koszty)</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-300">
          Harmonogram pobierania
          <select value={schedule} onChange={e => setSchedule(e.target.value as 'manual' | 'daily')} className="mt-1 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white">
            <option value="daily">Codziennie rano (07:15)</option>
            <option value="manual">Tylko ręcznie</option>
          </select>
        </label>
      </div>

      {config?.lastSyncAt && (
        <p className="mt-4 text-xs text-slate-400">
          Ostatnia synchronizacja: <strong className="text-slate-200">{new Date(config.lastSyncAt).toLocaleString('pl-PL')}</strong> · Pobrano: <strong className="text-emerald-300">{config.lastSyncCount}</strong>
        </p>
      )}
      {config?.lastSyncError && (
        <p className="mt-2 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">{config.lastSyncError}</p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={saving || !isBusiness} onClick={() => void save()} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">
          {saving ? 'Zapisywanie…' : 'Zapisz konfigurację KSeF'}
        </button>
      </div>
    </section>
  );
}
