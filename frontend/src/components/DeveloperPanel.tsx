import { useEffect, useState } from 'react';
import { resolveApiBase } from '../services/apiBase';
import DeveloperOverridesBar from './DeveloperOverridesBar';
import DeveloperFeedbackTab from './DeveloperFeedbackTab';

type PlanId = 'free' | 'standard' | 'premium' | 'family' | 'business';
type Limit = 'documents' | 'tags' | 'cameraScan' | 'printerScan' | 'merge';
type Settings = {
  name: string;
  monthly: number;
  yearly: number;
  mobileDevices: number;
  accountDevices: number | null;
  ocr: boolean;
  cloudBackup: boolean;
  premiumTools: boolean;
  limits: Record<Limit, number | null>;
};
type Promotion = { id: string; name: string; plan: PlanId; interval: 'monthly' | 'yearly'; percent: number; startsAt: string; endsAt: string; enabled: boolean };
type Catalog = { version: 1; usageDays: number; ocrTrialDays: number; backupTrialMonths: number; plans: Record<PlanId, Settings>; promotions: Promotion[] };
export type DevSection = 'feedback' | 'plans' | 'promotions' | 'settings';

const ids: PlanId[] = ['free', 'standard', 'premium', 'family', 'business'];
const labels: Record<Limit, string> = { documents: 'Dokumenty', tags: 'Tagi', cameraScan: 'Skany aparatem', printerScan: 'Skany z drukarki', merge: 'Łączenie stron' };
const api = resolveApiBase(window.location, import.meta.env.VITE_API_URL);
const money = (value: number) => (value / 100).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
const localDate = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const input = 'w-full rounded-lg border border-slate-600 bg-slate-950 p-2.5 text-slate-100 focus:border-blue-400';

function NumberField({ label, value, onChange, nullable = false, min = 0, step = 1 }: { label: string; value: number | null; onChange: (n: number | null) => void; nullable?: boolean; min?: number; step?: number }) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        value={value ?? ''}
        placeholder={nullable ? 'Bez limitu' : ''}
        onChange={e => onChange(e.target.value === '' && nullable ? null : e.target.value === '' ? 0 : Number(e.target.value))}
        className={`${input} mt-1`}
      />
      {nullable && <span className="mt-1 block text-[11px] text-slate-500">Puste = bez limitu</span>}
    </label>
  );
}

type Props = {
  embedded?: boolean;
  initialSection?: DevSection | null;
  openBugCount?: number;
  adminReplyCount?: number;
  onOpenBugCountChange?: (count: number) => void;
  onAdminReplyCountChange?: (count: number) => void;
  onClose?: () => void;
};

export default function DeveloperPanel({
  embedded = false,
  initialSection = null,
  openBugCount = 0,
  adminReplyCount = 0,
  onOpenBugCountChange,
  onAdminReplyCountChange,
  onClose,
}: Props) {
  const [data, setData] = useState<Catalog | null>(null);
  const [original, setOriginal] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<DevSection | null>(initialSection);
  const [previewAt, setPreviewAt] = useState(() => localDate(new Date().toISOString()));

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  async function request(method: string, body?: Catalog) {
    const token = localStorage.getItem('eteczka_auth_token');
    const response = await fetch(`${api}/api/dev/catalog`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Nie można połączyć się z panelem. Uruchom wersję deweloperską z pulpitu.');
    return payload as Catalog;
  }

  async function loadCatalog() {
    try {
      const value = await request('GET');
      setData(value);
      setOriginal(JSON.stringify(value));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nie można odczytać konfiguracji.');
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  function editPlan(id: PlanId, patch: Partial<Settings>) {
    if (data) setData({ ...data, plans: { ...data.plans, [id]: { ...data.plans[id], ...patch } } });
  }

  function editPromotion(index: number, patch: Partial<Promotion>) {
    if (data) setData({ ...data, promotions: data.promotions.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
  }

  async function save() {
    if (!data) return;
    setBusy(true);
    setMessage('');
    try {
      const value = await request('PUT', data);
      setData(value);
      setOriginal(JSON.stringify(value));
      setMessage('Zapisano. Limity i okresy obowiązują w lokalnym trybie deweloperskim.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Błąd zapisu.');
    } finally {
      setBusy(false);
    }
  }

  const dirty = Boolean(data && JSON.stringify(data) !== original);
  const modules: Array<{ id: DevSection; icon: string; title: string; description: string; badge?: number }> = [
    { id: 'feedback', icon: '🐛', title: 'Zgłoszenia błędów (QNAP)', description: adminReplyCount > 0 ? `Przeglądaj zgłoszenia użytkowników, odpowiadaj i zamykaj rozwiązane wątki. Odpowiedzi użytkowników: ${adminReplyCount}.` : 'Przeglądaj zgłoszenia użytkowników, odpowiadaj i zamykaj rozwiązane wątki.', badge: openBugCount },
    { id: 'plans', icon: '💳', title: 'Plany i limity', description: 'Konfiguruj ceny, limity dokumentów, tagów, skanów i zaufanych urządzeń.' },
    { id: 'promotions', icon: '🏷️', title: 'Promocje czasowe', description: 'Twórz rabaty procentowe na plany oraz sprawdzaj podgląd cen.' },
    { id: 'settings', icon: '⚙️', title: 'Ustawienia okresów i okien', description: 'Okno limitów skanowania oraz długość okresów próbnych OCR i chmury.' },
  ];

  const sectionTitle = modules.find(m => m.id === section)?.title || 'Panel dewelopera';

  const body = (
    <div className={embedded ? 'w-full space-y-5' : 'mx-auto max-w-7xl space-y-5'}>
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-700/80 bg-slate-900/90 px-6 py-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.2em] text-amber-400">E‑Teczka · Deweloper</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">{sectionTitle}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {section && (
            <button type="button" onClick={() => setSection(null)} className="rounded-lg border border-slate-600 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800">
              ← Lista modułów
            </button>
          )}
          {section && section !== 'feedback' && data && (
            <>
              <span className="text-xs text-slate-400">{dirty ? 'Niezapisane zmiany' : 'Zapisano'}</span>
              <button disabled={busy || !dirty} onClick={() => { setData(JSON.parse(original)); setMessage('Odrzucono niezapisane zmiany.'); }} className="rounded-lg px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40">
                Cofnij
              </button>
              <button disabled={busy || !dirty} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40">
                {busy ? 'Zapisywanie…' : 'Zapisz konfigurację'}
              </button>
            </>
          )}
          {embedded && onClose ? (
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-600 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800">
              ✕ Zamknij panel
            </button>
          ) : (
            <a href="/" className="rounded-lg border border-slate-600 px-4 py-2 text-sm">← Wróć do aplikacji</a>
          )}
        </div>
      </header>

      {message && <p role="status" className="rounded-xl border border-blue-500/40 bg-blue-950/30 p-4 text-sm text-blue-100">{message}</p>}

      {section === null && (
        <>
          <DeveloperOverridesBar onRefresh={() => void loadCatalog()} onStatus={setMessage} />
          <div className="grid gap-4 sm:grid-cols-2">
            {modules.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className="flex flex-col justify-between rounded-2xl border border-slate-700 bg-slate-900/90 p-6 text-left transition-colors hover:border-blue-400 hover:bg-slate-800/80"
              >
                <div className="flex items-start justify-between gap-3">
                  <span aria-hidden="true" className="text-3xl">{item.icon}</span>
                  {typeof item.badge === 'number' && (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${item.badge > 0 ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                      {item.badge} otwartych
                    </span>
                  )}
                </div>
                <div className="mt-4">
                  <h2 className="text-lg font-semibold text-white">
                    {item.title} <span className="float-right text-slate-500">→</span>
                  </h2>
                  <p className="mt-1.5 text-sm leading-5 text-slate-400">{item.description}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {section === 'feedback' && <DeveloperFeedbackTab apiUrl={api} onStatus={setMessage} onOpenCountChange={onOpenBugCountChange} onAdminReplyCountChange={onAdminReplyCountChange} />}

      {section === 'settings' && data && (
        <section className="grid gap-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 md:grid-cols-3">
          <NumberField label="Okno limitów skanowania i łączenia (dni)" min={1} value={data.usageDays} onChange={n => setData({ ...data, usageDays: n ?? 7 })} />
          <NumberField label="Okres próbny OCR (dni, 0 = brak)" value={data.ocrTrialDays} onChange={n => setData({ ...data, ocrTrialDays: n ?? 0 })} />
          <NumberField label="Okres próbny kopii w chmurze (miesiące, 0 = brak)" value={data.backupTrialMonths} onChange={n => setData({ ...data, backupTrialMonths: n ?? 0 })} />
        </section>
      )}

      {section === 'plans' && data && (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {ids.map(id => {
            const plan = data.plans[id];
            return (
              <section key={id} className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
                <p className="text-xs uppercase tracking-widest text-blue-400">{id}</p>
                <label className="mt-4 block text-xs text-slate-400">
                  Nazwa planu
                  <input className={`${input} mt-1`} value={plan.name} maxLength={60} onChange={e => editPlan(id, { name: e.target.value })} />
                </label>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <NumberField label="Cena / miesiąc (zł)" step={0.01} value={plan.monthly / 100} onChange={n => editPlan(id, { monthly: Math.round((n ?? 0) * 100) })} />
                  <NumberField label="Cena / rok (zł)" step={0.01} value={plan.yearly / 100} onChange={n => editPlan(id, { yearly: Math.round((n ?? 0) * 100) })} />
                </div>
                <h2 className="mb-3 mt-6 font-semibold text-white">Limity</h2>
                <div className="grid grid-cols-2 gap-3">
                  {(Object.keys(labels) as Limit[]).map(key => (
                    <NumberField key={key} label={labels[key]} nullable value={plan.limits[key]} onChange={n => editPlan(id, { limits: { ...plan.limits, [key]: n } })} />
                  ))}
                  <NumberField label="Zaufane telefony" min={1} value={plan.mobileDevices} onChange={n => editPlan(id, { mobileDevices: n ?? 1 })} />
                  <NumberField label="Urządzenia z sesją konta" min={1} nullable value={plan.accountDevices} onChange={n => editPlan(id, { accountDevices: n })} />
                </div>
                <h2 className="mb-3 mt-6 font-semibold text-white">Funkcje w cenie planu</h2>
                {([['ocr', 'OCR bez okresu próbnego'], ['cloudBackup', 'Kopie w chmurze bez okresu próbnego'], ['premiumTools', 'Funkcje chronione planem Premium']] as const).map(([key, label]) => (
                  <label key={key} className="mt-3 flex items-center gap-3 text-sm">
                    <input type="checkbox" checked={plan[key]} onChange={e => editPlan(id, { [key]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </section>
            );
          })}
        </div>
      )}

      {section === 'promotions' && data && (
        <>
          <button
            onClick={() => {
              const now = new Date();
              setData({
                ...data,
                promotions: [...data.promotions, { id: crypto.randomUUID(), name: 'Nowa promocja', plan: 'standard', interval: 'monthly', percent: 20, startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 7 * 86400000).toISOString(), enabled: false }],
              });
            }}
            className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500"
          >
            + Dodaj promocję
          </button>
          {!data.promotions.length && <p className="rounded-xl border border-dashed border-slate-600 p-8 text-center text-sm text-slate-400">Brak promocji. Dodaj rabat procentowy z terminem obowiązywania.</p>}
          {data.promotions.map((promo, index) => (
            <section key={promo.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
              <div className="mb-4 flex justify-between gap-4">
                <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={promo.enabled} onChange={e => editPromotion(index, { enabled: e.target.checked })} />Promocja włączona</label>
                <button onClick={() => setData({ ...data, promotions: data.promotions.filter(p => p.id !== promo.id) })} className="text-sm text-red-300">Usuń z projektu</button>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="text-xs text-slate-400">Nazwa<input className={`${input} mt-1`} value={promo.name} maxLength={100} onChange={e => editPromotion(index, { name: e.target.value })} /></label>
                <label className="text-xs text-slate-400">Plan<select className={`${input} mt-1`} value={promo.plan} onChange={e => editPromotion(index, { plan: e.target.value as PlanId })}><option value="standard">Standard</option><option value="premium">Premium</option><option value="family">Rodzinny</option><option value="business">Firmowy</option></select></label>
                <label className="text-xs text-slate-400">Rozliczenie<select className={`${input} mt-1`} value={promo.interval} onChange={e => editPromotion(index, { interval: e.target.value as 'monthly' | 'yearly' })}><option value="monthly">Miesięczne</option><option value="yearly">Roczne</option></select></label>
                <NumberField label="Rabat (%)" min={1} value={promo.percent} onChange={n => editPromotion(index, { percent: n ?? 1 })} />
                <label className="text-xs text-slate-400">Od (czas lokalny)<input type="datetime-local" className={`${input} mt-1`} value={localDate(promo.startsAt)} onChange={e => { if (e.target.value) editPromotion(index, { startsAt: new Date(e.target.value).toISOString() }); }} /></label>
                <label className="text-xs text-slate-400">Do (czas lokalny)<input type="datetime-local" className={`${input} mt-1`} value={localDate(promo.endsAt)} onChange={e => { if (e.target.value) editPromotion(index, { endsAt: new Date(e.target.value).toISOString() }); }} /></label>
              </div>
            </section>
          ))}
          <section className="rounded-2xl border border-blue-500/40 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold text-white">Podgląd cen i promocji</h2>
            <label className="mt-4 block max-w-xs text-xs text-slate-400">Sprawdź ceny na dzień<input type="datetime-local" className={`${input} mt-1`} value={previewAt} onChange={e => setPreviewAt(e.target.value)} /></label>
            <div className="mt-5 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
              {ids.map(id => (
                <div key={id} className="rounded-xl border border-slate-700 p-4">
                  <h3 className="font-semibold">{data.plans[id].name}</h3>
                  {(['monthly', 'yearly'] as const).map(interval => {
                    const now = new Date(previewAt).getTime();
                    const promo = data.promotions.filter(p => p.enabled && p.plan === id && p.interval === interval && Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt)).sort((a, b) => b.percent - a.percent || a.id.localeCompare(b.id))[0];
                    const base = data.plans[id][interval];
                    return (
                      <p key={interval} className="mt-3 text-sm">
                        <span className="text-slate-400">{interval === 'monthly' ? 'Miesiąc' : 'Rok'}: </span>
                        <strong>{money(Math.round(base * (100 - (promo?.percent || 0)) / 100))}</strong>
                        {promo && <span className="mt-1 block text-xs text-emerald-300">−{promo.percent}% · {promo.name} (z {money(base)})</span>}
                      </p>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {!data && !message && section !== 'feedback' && section !== null && <p className="text-sm text-slate-400">Wczytywanie konfiguracji…</p>}
    </div>
  );

  if (embedded) return body;
  return <main className="min-h-screen bg-[#0b1120] p-6 text-slate-200 md:p-10">{body}</main>;
}
