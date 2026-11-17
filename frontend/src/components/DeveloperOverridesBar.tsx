import { useEffect, useState } from 'react';
import { resolveApiBase } from '../services/apiBase';

type Plan = 'free' | 'standard' | 'premium';
type Overrides = { bypassDeviceLimit: boolean; bypassPlanLimits: boolean; bypassRateLimit: boolean };
const api = resolveApiBase(window.location, import.meta.env.VITE_API_URL);

export default function DeveloperOverridesBar({ onRefresh, onStatus }: { onRefresh: () => void; onStatus: (msg: string) => void }) {
  const [overrides, setOverrides] = useState<Overrides>({ bypassDeviceLimit: false, bypassPlanLimits: false, bypassRateLimit: false });
  const [planOverride, setPlanOverride] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('eteczka_auth_token');
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async function loadAll() {
    const [ovRes, plRes] = await Promise.all([
      fetch(`${api}/api/dev/catalog/overrides`),
      fetch(`${api}/api/dev/plan`, { headers: authHeaders() })
    ]);
    if (ovRes.ok) setOverrides(await ovRes.json() as Overrides);
    if (plRes.ok) {
      const p = await plRes.json() as { override?: Plan | null };
      setPlanOverride(p.override ?? null);
    }
  }

  useEffect(() => { void loadAll().catch(() => undefined); }, []);

  async function toggle(key: keyof Overrides, value: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`${api}/api/dev/catalog/overrides`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      });
      if (!res.ok) throw new Error('Nie udało się zapisać przełącznika.');
      setOverrides(await res.json() as Overrides);
      onStatus('Zapisano ustawienie deweloperskie.');
    } catch (e) {
      onStatus(e instanceof Error ? e.message : 'Błąd zapisu.');
    } finally { setBusy(false); }
  }

  async function choosePlan(plan: Plan | null) {
    setBusy(true);
    try {
      const res = await fetch(`${api}/api/dev/plan`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ plan })
      });
      if (!res.ok) throw new Error('Nie udało się zmienić planu testowego.');
      setPlanOverride(plan);
      onStatus(`Aktywny plan testowy: ${plan ?? 'rzeczywisty'}.`);
    } catch (e) {
      onStatus(e instanceof Error ? e.message : 'Błąd zmiany planu.');
    } finally { setBusy(false); }
  }

  async function clearSessions() {
    setBusy(true);
    try {
      const res = await fetch(`${api}/api/dev/catalog/clear-sessions`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { cleared?: number };
      if (!res.ok) throw new Error('Nie udało się wyczyścić sesji.');
      onStatus(`Wyczyszczono lokalne sesje (AuthSession): ${data.cleared ?? 0}.`);
    } catch (e) {
      onStatus(e instanceof Error ? e.message : 'Błąd czyszczenia sesji.');
    } finally { setBusy(false); }
  }

  const toggleCls = (on: boolean) => `relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-500'}`;
  const knobCls = (on: boolean) => `pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${on ? 'translate-x-5' : 'translate-x-0'}`;

  return (
    <section className="mb-6 rounded-2xl border border-emerald-600/40 bg-slate-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Narzędzia deweloperskie i omijanie blokad</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => { void loadAll(); onRefresh(); }} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40">
            ↻ Odśwież
          </button>
          <button type="button" disabled={busy} onClick={() => void clearSessions()} className="rounded-lg border border-red-500/60 bg-red-950/40 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/50 disabled:opacity-40">
            Wyczyść lokalne sesje
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
          <div>
            <p className="text-sm font-semibold text-white">Pomiń limit urządzeń przy logowaniu</p>
            <p className="text-xs text-slate-400">Omija blokadę „Limit urządzeń dla tego planu został osiągnięty”.</p>
          </div>
          <button type="button" role="switch" aria-checked={overrides.bypassDeviceLimit} disabled={busy} onClick={() => void toggle('bypassDeviceLimit', !overrides.bypassDeviceLimit)} className={toggleCls(overrides.bypassDeviceLimit)}>
            <span className={knobCls(overrides.bypassDeviceLimit)} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
          <div>
            <p className="text-sm font-semibold text-white">Pomiń limity planu (tryb Premium)</p>
            <p className="text-xs text-slate-400">Odblokowuje wszystkie funkcje i znosi limity dokumentów/skanów.</p>
          </div>
          <button type="button" role="switch" aria-checked={overrides.bypassPlanLimits} disabled={busy} onClick={() => void toggle('bypassPlanLimits', !overrides.bypassPlanLimits)} className={toggleCls(overrides.bypassPlanLimits)}>
            <span className={knobCls(overrides.bypassPlanLimits)} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
          <div>
            <p className="text-sm font-semibold text-white">Pomiń czas i limit prób logowania</p>
            <p className="text-xs text-slate-400">Wyłącza lokalne blokady czasowe po nieudanych próbach logowania (429).</p>
          </div>
          <button type="button" role="switch" aria-checked={overrides.bypassRateLimit} disabled={busy} onClick={() => void toggle('bypassRateLimit', !overrides.bypassRateLimit)} className={toggleCls(overrides.bypassRateLimit)}>
            <span className={knobCls(overrides.bypassRateLimit)} />
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-2 text-xs text-slate-400">Aktywny plan testowy:</span>
        {(['free', 'standard', 'premium'] as Plan[]).map(p => (
          <button key={p} type="button" disabled={busy} onClick={() => void choosePlan(p)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${planOverride === p ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>
            {p === 'free' ? 'Darmowy' : p === 'standard' ? 'Standard' : 'Premium'}
          </button>
        ))}
        <button type="button" disabled={busy || planOverride === null} onClick={() => void choosePlan(null)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-40">
          Rzeczywisty
        </button>
      </div>
    </section>
  );
}
