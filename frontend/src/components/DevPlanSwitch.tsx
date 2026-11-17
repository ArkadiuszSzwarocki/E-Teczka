import { useEffect, useState } from 'react';
type Plan = 'free' | 'standard' | 'premium' | 'family' | 'business';
type Props = { apiUrl: string; fetcher: typeof fetch; onChanged: () => void };
const options: Array<{ value: Plan; label: string }> = [
  { value: 'free', label: 'Darmowy' },
  { value: 'standard', label: 'Standard' },
  { value: 'premium', label: 'Premium' },
  { value: 'family', label: 'Rodzinny' },
  { value: 'business', label: 'Firmowy' },
];
export default function DevPlanSwitch({ apiUrl, fetcher, onChanged }: Props) {
  const [selected, setSelected] = useState<Plan | null>(null); const [available, setAvailable] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { let mounted = true; void fetcher(`${apiUrl}/api/dev/plan`).then(async response => { if (!response.ok) throw new Error(); const data = await response.json(); if (mounted) { setSelected(data.override ?? null); setAvailable(true); } }).catch(() => { if (mounted && import.meta.env.DEV) setError('Uruchom serwer E‑Teczki w trybie deweloperskim z testowym Stripe.'); }); return () => { mounted = false; }; }, [apiUrl, fetcher]);
  const choose = async (plan: Plan | null) => { setBusy(true); setError(''); try { const response = await fetcher(`${apiUrl}/api/dev/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Nie udało się zmienić planu testowego.'); setSelected(plan); onChanged(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zmienić planu testowego.'); } finally { setBusy(false); } };
  if (!available && !import.meta.env.DEV) return null;
  return <div className="cyber-dev-switch flex flex-wrap items-center gap-1 rounded-lg border border-amber-600/70 bg-amber-950/30 px-2 py-1" title="Plan testowy nie zmienia subskrypcji Stripe. Limity skanów i okresy próbne mają osobny licznik testowy.">{import.meta.env.DEV ? <a href="/developer" target="_blank" rel="noopener noreferrer" className="mr-1 text-xs font-bold text-amber-200 underline" title="Otwórz konfigurację planów i promocji">PANEL DEWELOPERA ↗</a> : <span className="mr-1 text-xs font-bold text-amber-200">PLAN TESTOWY:</span>}{options.map(option => <button key={option.value} type="button" disabled={!available || busy} onClick={() => void choose(option.value)} aria-pressed={selected === option.value} className={`rounded px-2 py-1 text-xs font-semibold disabled:opacity-40 ${selected === option.value ? 'cyber-dev-pill-active bg-amber-400 text-slate-950' : 'bg-slate-700 text-slate-100 hover:bg-slate-600'}`}>{option.label}</button>)}<button type="button" disabled={!available || busy || selected === null} onClick={() => void choose(null)} className="rounded px-2 py-1 text-xs text-amber-200 hover:bg-amber-900/50 disabled:opacity-40">Domyślny</button>{error && <span role="status" className="max-w-48 text-xs text-red-300">{error}</span>}</div>;
}
