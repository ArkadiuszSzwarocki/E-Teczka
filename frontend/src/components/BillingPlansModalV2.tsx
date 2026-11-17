import { Fragment, useEffect, useState } from 'react';
import { resolveApiBase } from '../services/apiBase';

type Plan = 'standard' | 'premium';
type PaidPlan = Plan | 'family' | 'business';
type AnyPlan = 'free' | PaidPlan;
type BillingInterval = 'monthly' | 'yearly';
type Props = { apiUrl?: string; fetcher?: typeof fetch; busy: boolean; currentPlan: AnyPlan; developmentOverride: boolean; cancellationScheduled: boolean; onClose: () => void; onSelectFree: () => void; onSelect: (plan: Plan, interval: BillingInterval) => void };
type Value = boolean | string;
type Feature = { name: string; description?: string; free: Value; standard: Value; premium: Value; family: Value; business: Value };
type QuoteItem = { base: number; amount: number; promotion: { name: string; percent: number } | null; currency: string };
type PlanEntry = { name: string; monthly: number; yearly: number; mobileDevices: number; accountDevices: number | null; ocr: boolean; cloudBackup: boolean; limits: { documents: number | null; tags: number | null; cameraScan: number | null; printerScan: number | null; merge: number | null } };
type CatalogResponse = {
  catalog: { usageDays: number; ocrTrialDays: number; standardOcrTrialDays?: number; backupTrialMonths: number; plans: Record<AnyPlan, PlanEntry> };
  quotes: Record<PaidPlan, Record<BillingInterval, QuoteItem>>;
};

const money = (cents: number) => (cents / 100).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
const fmtLimit = (v: number | null, suffix = '') => (v === null ? 'Bez limitu' : `${v}${suffix}`);
const fmtDocs = (v: number | null) => (v === null ? 'Bez limitu' : `Do ${v}`);
const fmtOcrTrial = (days: number) => (days <= 0 ? false : days % 30 === 0 ? (days / 30 === 1 ? '1 miesiąc próbny' : `${days / 30} miesiące próbne`) : `${days} dni próbne`);

function buildSections(catalog?: CatalogResponse['catalog']): { title: string; items: Feature[] }[] {
  const days = catalog?.usageDays ?? 7;
  const ocrDays = catalog?.ocrTrialDays ?? 30;
  const standardOcrDays = catalog?.standardOcrTrialDays ?? 60;
  const backupMonths = catalog?.backupTrialMonths ?? 2;
  const f = catalog?.plans.free;
  const s = catalog?.plans.standard;
  const p = catalog?.plans.premium;
  const fam = catalog?.plans.family;
  const biz = catalog?.plans.business;
  const trialFreeOcr = fmtOcrTrial(ocrDays);
  const trialStandardOcr = fmtOcrTrial(standardOcrDays);
  const trialBackup = backupMonths > 0 ? `${backupMonths} miesiące próbne` : false;

  return [
    {
      title: 'Dokumenty i kartoteki',
      items: [
        { name: 'Kartoteki, dodawanie i podgląd dokumentów', free: true, standard: true, premium: true, family: true, business: true },
        { name: 'Archiwum, kosz i termin życia', free: true, standard: true, premium: true, family: true, business: true },
        { name: 'Powiadomienia o terminach', free: true, standard: true, premium: true, family: true, business: true },
        { name: 'Liczba dokumentów', description: 'Do limitu wliczane są również dokumenty w archiwum i koszu.', free: fmtDocs(f ? f.limits.documents : 200), standard: fmtDocs(s ? s.limits.documents : 400), premium: fmtDocs(p ? p.limits.documents : null), family: fmtDocs(fam ? fam.limits.documents : null), business: fmtDocs(biz ? biz.limits.documents : null) },
        { name: 'Skanowanie aparatem telefonu', description: `Limit w kroczącym okresie ${days} dni.`, free: fmtLimit(f ? f.limits.cameraScan : 50, ` / ${days} dni`), standard: fmtLimit(s ? s.limits.cameraScan : 100, ` / ${days} dni`), premium: fmtLimit(p ? p.limits.cameraScan : null, ` / ${days} dni`), family: fmtLimit(fam ? fam.limits.cameraScan : null, ` / ${days} dni`), business: fmtLimit(biz ? biz.limits.cameraScan : null, ` / ${days} dni`) },
        { name: 'Połączenie stron podczas wgrywania', description: `Limit w kroczącym okresie ${days} dni.`, free: fmtLimit(f ? f.limits.merge : 10, ` / ${days} dni`), standard: fmtLimit(s ? s.limits.merge : 20, ` / ${days} dni`), premium: fmtLimit(p ? p.limits.merge : null, ` / ${days} dni`), family: fmtLimit(fam ? fam.limits.merge : null, ` / ${days} dni`), business: fmtLimit(biz ? biz.limits.merge : null, ` / ${days} dni`) },
        { name: 'Skanowanie z drukarki', description: `Limit w kroczącym okresie ${days} dni.`, free: fmtLimit(f ? f.limits.printerScan : 50, ` / ${days} dni`), standard: fmtLimit(s ? s.limits.printerScan : 100, ` / ${days} dni`), premium: fmtLimit(p ? p.limits.printerScan : null, ` / ${days} dni`), family: fmtLimit(fam ? fam.limits.printerScan : null, ` / ${days} dni`), business: fmtLimit(biz ? biz.limits.printerScan : null, ` / ${days} dni`) },
        { name: 'OCR i wyszukiwanie w treści dokumentów', description: 'Lokalnie na komputerze. Okres próbny liczony jest od pierwszego użycia OCR.', free: f?.ocr ? 'Bez limitu' : trialFreeOcr, standard: s?.ocr ? 'Bez limitu' : trialStandardOcr, premium: p?.ocr ?? true ? 'Bez limitu' : trialFreeOcr, family: fam?.ocr ?? true ? 'Bez limitu' : trialFreeOcr, business: biz?.ocr ?? true ? 'Bez limitu' : trialFreeOcr },
        { name: 'Odczyt paragonów i faktur do dashboardu', description: 'Automatyczne podsumowanie wydatków i terminów płatności w panelu analiz.', free: f?.ocr ? 'Bez limitu' : trialFreeOcr, standard: s?.ocr ? 'Bez limitu' : trialStandardOcr, premium: 'Bez limitu', family: 'Bez limitu', business: 'Bez limitu' },
        { name: 'Eksport zaznaczonych dokumentów do jednego PDF', free: false, standard: false, premium: true, family: true, business: true },
        { name: 'Tworzenie i usuwanie tagów', description: 'Limit dotyczy tagów przypisanych do konta.', free: fmtLimit(f ? f.limits.tags : 3, ' tagi'), standard: fmtLimit(s ? s.limits.tags : 6, ' tagów'), premium: fmtLimit(p ? p.limits.tags : null), family: fmtLimit(fam ? fam.limits.tags : null), business: fmtLimit(biz ? biz.limits.tags : null) },
      ],
    },
    {
      title: 'Urządzenia i bezpieczeństwo',
      items: [
        { name: 'Zaufane telefony połączone z komputerem', description: 'Limit telefonów sparowanych z archiwum.', free: `${f?.mobileDevices ?? 1} telefon`, standard: `${s?.mobileDevices ?? 1} telefon`, premium: `${p?.mobileDevices ?? 1} telefon`, family: `${fam?.mobileDevices ?? 4} telefony`, business: `${biz?.mobileDevices ?? 10} telefonów` },
        { name: 'Urządzenia zalogowane na konto', description: 'Limit dotyczy aktywnych sesji konta użytkownika.', free: fmtLimit(f ? f.accountDevices : 1, ' urządzenie'), standard: fmtLimit(s ? s.accountDevices : 2, ' urządzenia'), premium: p?.accountDevices === null || !p ? 'Bez limitu sesji' : `${p.accountDevices}`, family: fam?.accountDevices === null || !fam ? 'Bez limitu sesji' : `${fam.accountDevices}`, business: biz?.accountDevices === null || !biz ? 'Bez limitu sesji' : `${biz.accountDevices}` },
        { name: 'Lokalna kopia i przywracanie', free: true, standard: true, premium: true, family: true, business: true },
        { name: 'Wybrane dokumenty dostępne offline na telefonie', description: 'Wymaga wcześniejszego pobrania na urządzenie.', free: true, standard: true, premium: true, family: true, business: true },
        { name: 'Kopia na NAS lub do chmury', description: 'Okres próbny liczony od pierwszego użycia. Kopia wymaga działającego komputera.', free: f?.cloudBackup ? true : trialBackup, standard: s?.cloudBackup ? true : trialBackup, premium: p?.cloudBackup ?? true, family: fam?.cloudBackup ?? true, business: biz?.cloudBackup ?? true },
        { name: 'Wygasające linki do dokumentów', description: 'Bezpieczne linki z terminem wygaśnięcia, opcjonalnym PIN-em i trybem jednorazowym.', free: false, standard: false, premium: true, family: true, business: true },
        { name: 'Znak wodny na dokumentach', description: 'Opcjonalny znak wodny (e-mail właściciela, logo i E-Teczka) w eksporcie PDF i bezpiecznych linkach.', free: false, standard: false, premium: true, family: true, business: true },
      ],
    },
  ];
}

function Cell({ value }: { value: Value }) {
  if (typeof value === 'string') return <span className="text-xs font-medium text-slate-200">{value}</span>;
  return <span className={`text-lg font-bold ${value ? 'text-emerald-300' : 'text-slate-500'}`} aria-label={value ? 'Dostępne' : 'Niedostępne'}>{value ? '✓' : '✕'}</span>;
}

function PriceDisplay({ cents, quote, suffix }: { cents: number; quote?: QuoteItem; suffix: string }) {
  const promo = quote?.promotion;
  if (!promo || !quote || quote.amount === quote.base) return <span className="font-normal">{money(cents)} {suffix}</span>;
  return (
    <span className="block font-normal">
      <span className="line-through opacity-60 mr-1">{money(quote.base)}</span>
      <strong className="text-emerald-300">{money(quote.amount)}</strong> {suffix}
      <span className="mt-1 block text-[11px] text-emerald-300">−{promo.percent}% · {promo.name}</span>
    </span>
  );
}

const DEFAULT_PRICES: Record<PaidPlan, { monthly: number; yearly: number }> = {
  standard: { monthly: 499, yearly: 4990 },
  premium: { monthly: 999, yearly: 9990 },
  family: { monthly: 1499, yearly: 14990 },
  business: { monthly: 2999, yearly: 29990 },
};

function CheckoutButtons({ plan, busy, onSelect, catalogData }: { plan: PaidPlan; busy: boolean; onSelect: Props['onSelect']; catalogData: CatalogResponse | null }) {
  const googlePlayAvailable = false;
  const monthlyCents = catalogData?.catalog.plans[plan]?.monthly ?? DEFAULT_PRICES[plan].monthly;
  const yearlyCents = catalogData?.catalog.plans[plan]?.yearly ?? DEFAULT_PRICES[plan].yearly;
  const quotes = catalogData?.quotes?.[plan];
  const triggerSelect = (interval: BillingInterval) => {
    if (plan === 'standard' || plan === 'premium') onSelect(plan, interval);
  };

  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <p className="col-span-2 text-xs text-amber-200">Zakup przez Google Play jest w przygotowaniu.</p>
      <button disabled={busy || !googlePlayAvailable} onClick={() => triggerSelect('monthly')} className="rounded-lg border border-blue-400 px-2 py-2 text-xs font-bold text-blue-200 hover:bg-blue-500/20 disabled:opacity-50">
        Miesięcznie<br />
        <PriceDisplay cents={monthlyCents} quote={quotes?.monthly} suffix="/ mies." />
      </button>
      <button disabled={busy || !googlePlayAvailable} onClick={() => triggerSelect('yearly')} className="rounded-lg bg-emerald-500 px-2 py-2 text-xs font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50">
        Rocznie<br />
        <PriceDisplay cents={yearlyCents} quote={quotes?.yearly} suffix="/ rok" />
      </button>
    </div>
  );
}

export default function BillingPlansModalV2({ apiUrl, fetcher, busy, currentPlan, developmentOverride, cancellationScheduled, onClose, onSelectFree, onSelect }: Props) {
  const [catalogData, setCatalogData] = useState<CatalogResponse | null>(null);

  useEffect(() => {
    let active = true;
    const base = apiUrl ?? resolveApiBase(window.location, import.meta.env.VITE_API_URL);
    const runFetch = fetcher ?? fetch;
    void runFetch(`${base}/api/billing/catalog`)
      .then(async res => (res.ok ? (await res.json()) as CatalogResponse : null))
      .then(data => { if (active && data) setCatalogData(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [apiUrl, fetcher]);

  const sections = buildSections(catalogData?.catalog);
  const stdMonthly = catalogData?.quotes.standard?.monthly;
  const stdYearly = catalogData?.quotes.standard?.yearly;
  const premMonthly = catalogData?.quotes.premium?.monthly;
  const premYearly = catalogData?.quotes.premium?.yearly;
  const famMonthly = catalogData?.quotes.family?.monthly;
  const famYearly = catalogData?.quotes.family?.yearly;
  const bizMonthly = catalogData?.quotes.business?.monthly;
  const bizYearly = catalogData?.quotes.business?.yearly;

  return (
    <div className="fixed inset-0 z-[115] overflow-y-auto bg-black/80 p-3 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="plans-title" className="mx-auto my-3 w-full max-w-7xl rounded-2xl border border-slate-600 bg-[#0f172a] p-5 shadow-2xl md:my-6 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="plans-title" className="text-2xl font-bold text-white">Porównaj plany E‑Teczki</h2><p className="mt-1 text-sm text-slate-400">Zobacz, co jest dostępne w każdym planie, i wybierz sposób rozliczenia.</p></div>
          <button onClick={onClose} aria-label="Zamknij" className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-xl border border-slate-700 bg-[#1e293b] p-4">
            <p className="font-semibold text-slate-300">{catalogData?.catalog.plans.free.name || 'Darmowy'}</p>
            <p className="mt-2 text-3xl font-bold text-white">0 zł</p>
            <p className="mt-2 text-sm text-slate-400">Podstawowe zarządzanie dokumentami.</p>
            <button type="button" disabled={busy || currentPlan === 'free'} onClick={onSelectFree} className="mt-4 w-full rounded-lg border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:cursor-default disabled:opacity-60">{currentPlan === 'free' ? 'Twój obecny plan' : developmentOverride ? 'Testuj plan Darmowy' : cancellationScheduled ? 'Sprawdź przejście na Darmowy' : 'Przejdź na Darmowy'}</button>
            {currentPlan !== 'free' && !developmentOverride && <p className="mt-2 text-xs text-slate-400">Zmiana nastąpi po zakończeniu opłaconego okresu.</p>}
          </div>
          <div className="rounded-xl border border-blue-500/70 bg-blue-950/20 p-4">
            <p className="font-semibold text-blue-300">{catalogData?.catalog.plans.standard.name || 'Standard'}</p>
            <p className="mt-2 text-3xl font-bold text-white">{money(stdMonthly?.amount ?? 499)} <span className="text-sm font-normal text-slate-400">/ mies.</span></p>
            {stdMonthly?.promotion && <p className="text-xs text-emerald-300">Promocja −{stdMonthly.promotion.percent}%: {stdMonthly.promotion.name} (z {money(stdMonthly.base)})</p>}
            <p className="text-sm text-slate-400">lub {money(stdYearly?.amount ?? 4990)} / rok</p>
            {stdYearly?.promotion && <p className="text-xs text-emerald-300">Promocja roczna −{stdYearly.promotion.percent}%: {stdYearly.promotion.name} (z {money(stdYearly.base)})</p>}
            <p className="mt-2 text-xs text-slate-300">Wyższe limity dokumentów, skanowania i tagów.</p>
            <CheckoutButtons plan="standard" busy={busy} onSelect={onSelect} catalogData={catalogData} />
          </div>
          <div className="relative rounded-xl border-2 border-emerald-400 bg-emerald-950/30 p-4">
            <p className="font-semibold text-emerald-300">{catalogData?.catalog.plans.premium.name || 'Premium'}</p>
            <p className="mt-2 text-3xl font-bold text-white">{money(premMonthly?.amount ?? 999)} <span className="text-sm font-normal text-slate-400">/ mies.</span></p>
            {premMonthly?.promotion && <p className="text-xs text-emerald-300">Promocja −{premMonthly.promotion.percent}%: {premMonthly.promotion.name} (z {money(premMonthly.base)})</p>}
            <p className="text-sm text-slate-400">lub {money(premYearly?.amount ?? 9990)} / rok</p>
            {premYearly?.promotion && <p className="text-xs text-emerald-300">Promocja roczna −{premYearly.promotion.percent}%: {premYearly.promotion.name} (z {money(premYearly.base)})</p>}
            <p className="mt-2 text-xs text-slate-300">OCR, drukarka, tagi i kopie w chmurze.</p>
            <CheckoutButtons plan="premium" busy={busy} onSelect={onSelect} catalogData={catalogData} />
          </div>
          <div className="rounded-xl border border-amber-500/70 bg-amber-950/20 p-4">
            <p className="font-semibold text-amber-300">{catalogData?.catalog.plans.family?.name || 'Rodzinny'}</p>
            <p className="mt-2 text-3xl font-bold text-white">{money(famMonthly?.amount ?? 1499)} <span className="text-sm font-normal text-slate-400">/ mies.</span></p>
            {famMonthly?.promotion && <p className="text-xs text-emerald-300">Promocja −{famMonthly.promotion.percent}%: {famMonthly.promotion.name} (z {money(famMonthly.base)})</p>}
            <p className="text-sm text-slate-400">lub {money(famYearly?.amount ?? 14990)} / rok</p>
            {famYearly?.promotion && <p className="text-xs text-emerald-300">Promocja roczna −{famYearly.promotion.percent}%: {famYearly.promotion.name} (z {money(famYearly.base)})</p>}
            <p className="mt-2 text-xs text-slate-300">Wszystko z Premium + do {catalogData?.catalog.plans.family?.mobileDevices ?? 4} telefonów.</p>
            <CheckoutButtons plan="family" busy={busy} onSelect={onSelect} catalogData={catalogData} />
          </div>
          <div className="rounded-xl border border-violet-500/70 bg-violet-950/20 p-4">
            <p className="font-semibold text-violet-300">{catalogData?.catalog.plans.business?.name || 'Firmowy'}</p>
            <p className="mt-2 text-3xl font-bold text-white">{money(bizMonthly?.amount ?? 2999)} <span className="text-sm font-normal text-slate-400">/ mies.</span></p>
            {bizMonthly?.promotion && <p className="text-xs text-emerald-300">Promocja −{bizMonthly.promotion.percent}%: {bizMonthly.promotion.name} (z {money(bizMonthly.base)})</p>}
            <p className="text-sm text-slate-400">lub {money(bizYearly?.amount ?? 29990)} / rok</p>
            {bizYearly?.promotion && <p className="text-xs text-emerald-300">Promocja roczna −{bizYearly.promotion.percent}%: {bizYearly.promotion.name} (z {money(bizYearly.base)})</p>}
            <p className="mt-2 text-xs text-slate-300">Wszystko z Premium + do {catalogData?.catalog.plans.business?.mobileDevices ?? 10} telefonów.</p>
            <CheckoutButtons plan="business" busy={busy} onSelect={onSelect} catalogData={catalogData} />
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between gap-2"><h3 className="text-lg font-bold text-white">Porównanie funkcji</h3><span className="text-xs text-slate-400">✓ dostępne · ✕ niedostępne</span></div>
        <p className="mt-1 text-xs text-slate-400 md:hidden">Przesuń tabelę w bok, aby zobaczyć wszystkie plany.</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-700"><table className="w-full min-w-[780px] border-collapse text-sm"><thead><tr className="bg-slate-800/70 text-left text-xs uppercase text-slate-300"><th scope="col" className="px-4 py-3">Funkcja</th><th scope="col" className="w-28 px-2 text-center">Darmowy</th><th scope="col" className="w-28 px-2 text-center">Standard</th><th scope="col" className="w-28 px-2 text-center text-emerald-300">Premium</th><th scope="col" className="w-28 px-2 text-center text-amber-300">Rodzinny</th><th scope="col" className="w-28 px-2 text-center text-violet-300">Firmowy</th></tr></thead><tbody>{sections.map(section => <Fragment key={section.title}><tr><th colSpan={6} scope="colgroup" className="border-t border-slate-700 bg-slate-800/40 px-4 py-2 text-left font-bold text-blue-200">{section.title}</th></tr>{section.items.map(item => <tr key={item.name} className="border-t border-slate-800"><th scope="row" className="px-4 py-3 text-left font-medium text-slate-200">{item.name}{item.description && <span className="mt-1 block text-xs font-normal text-slate-400">{item.description}</span>}</th><td className="px-2 text-center"><Cell value={item.free} /></td><td className="px-2 text-center"><Cell value={item.standard} /></td><td className="px-2 text-center"><Cell value={item.premium} /></td><td className="px-2 text-center"><Cell value={item.family} /></td><td className="px-2 text-center"><Cell value={item.business} /></td></tr>)}</Fragment>)}</tbody></table></div>
        <div className="mt-5 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-100">Funkcje oznaczone „W przygotowaniu” są przypisane do planu Premium i nie są jeszcze dostępne.</div>
        <p className="mt-4 text-center text-xs text-slate-400">Zakupy przez Google Play będą dostępne po zakończeniu konfiguracji.</p>
      </div>
    </div>
  );
}
