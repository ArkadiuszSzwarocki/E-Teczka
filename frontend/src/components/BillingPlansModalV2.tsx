import { Fragment } from 'react';

type Plan = 'standard' | 'premium';
type BillingInterval = 'monthly' | 'yearly';
type Props = { busy: boolean; currentPlan: 'free' | Plan; developmentOverride: boolean; cancellationScheduled: boolean; onClose: () => void; onSelectFree: () => void; onSelect: (plan: Plan, interval: BillingInterval) => void };
type Value = boolean | string;
type Feature = { name: string; description?: string; free: Value; standard: Value; premium: Value };

const sections: { title: string; items: Feature[] }[] = [
  { title: 'Dokumenty i kartoteki', items: [
    { name: 'Kartoteki, dodawanie i podgląd dokumentów', free: true, standard: true, premium: true },
    { name: 'Archiwum, kosz i termin życia', free: true, standard: true, premium: true },
    { name: 'Powiadomienia o terminach', free: true, standard: true, premium: true },
    { name: 'Liczba dokumentów', description: 'Do limitu wliczane są również dokumenty w archiwum i koszu.', free: 'Do 200', standard: 'Do 400', premium: 'Bez limitu' },
    { name: 'Skanowanie aparatem telefonu', description: 'Limit w kroczącym okresie 7 dni.', free: '50 / 7 dni', standard: '100 / 7 dni', premium: 'Bez limitu' },
    { name: 'Połączenie stron podczas wgrywania', description: 'Limit w kroczącym okresie 7 dni.', free: '10 / 7 dni', standard: '20 / 7 dni', premium: 'Bez limitu' },
    { name: 'Skanowanie z drukarki', description: 'Limit w kroczącym okresie 7 dni.', free: '50 / 7 dni', standard: '100 / 7 dni', premium: 'Bez limitu' },
    { name: 'OCR i wyszukiwanie w treści dokumentów', description: 'Lokalnie na komputerze. Okres próbny liczony jest od pierwszego użycia OCR.', free: '14 dni próbne', standard: '14 dni próbne', premium: 'Bez limitu' },
    { name: 'Eksport zaznaczonych dokumentów do jednego PDF', free: false, standard: false, premium: true },
    { name: 'Tworzenie i usuwanie tagów', description: 'Limit dotyczy tagów przypisanych do konta.', free: '3 tagi', standard: '6 tagów', premium: 'Bez limitu' },
  ] },
  { title: 'Funkcje Premium w przygotowaniu', items: [
    { name: 'Profile rodzinne', description: 'Plan Premium — funkcja jeszcze niewdrożona.', free: false, standard: false, premium: 'W przygotowaniu' },
    { name: 'Wygasające linki do dokumentów', description: 'Plan Premium — funkcja jeszcze niewdrożona.', free: false, standard: false, premium: 'W przygotowaniu' },
    { name: 'Znak wodny na dokumentach', description: 'Plan Premium — funkcja jeszcze niewdrożona.', free: false, standard: false, premium: 'W przygotowaniu' },
  ] },
  { title: 'Urządzenia i bezpieczeństwo', items: [
    { name: 'Urządzenia zalogowane na konto', description: 'Limit dotyczy aktywnych sesji konta użytkownika.', free: '1 urządzenie', standard: '2 urządzenia', premium: 'Bez limitu sesji' },
    { name: 'Lokalna kopia i przywracanie', free: true, standard: true, premium: true },
    { name: 'Wybrane dokumenty dostępne offline na telefonie', description: 'Wymaga wcześniejszego pobrania na urządzenie.', free: true, standard: true, premium: true },
    { name: 'Kopia na NAS lub do chmury', description: 'Okres próbny liczony od pierwszego użycia. Kopia wymaga działającego komputera.', free: '2 miesiące próbne', standard: '2 miesiące próbne', premium: true },
  ] },
];

function Cell({ value }: { value: Value }) {
  if (typeof value === 'string') return <span className="text-xs font-medium text-slate-200">{value}</span>;
  return <span className={`text-lg font-bold ${value ? 'text-emerald-300' : 'text-slate-500'}`} aria-label={value ? 'Dostępne' : 'Niedostępne'}>{value ? '✓' : '✕'}</span>;
}
function CheckoutButtons({ plan, busy, onSelect }: { plan: Plan; busy: boolean; onSelect: Props['onSelect'] }) {
  const standard = plan === 'standard';
  return <div className="mt-4 grid grid-cols-2 gap-2"><button disabled={busy} onClick={() => onSelect(plan, 'monthly')} className="rounded-lg border border-blue-400 px-2 py-2 text-xs font-bold text-blue-200 hover:bg-blue-500/20 disabled:opacity-50">Miesięcznie<br /><span className="font-normal">{standard ? '4,99 zł' : '9,99 zł'} / mies.</span></button><button disabled={busy} onClick={() => onSelect(plan, 'yearly')} className="rounded-lg bg-emerald-500 px-2 py-2 text-xs font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50">Rocznie<br /><span className="font-normal">{standard ? '49,90 zł' : '99,90 zł'} / rok</span></button></div>;
}
export default function BillingPlansModalV2({ busy, currentPlan, developmentOverride, cancellationScheduled, onClose, onSelectFree, onSelect }: Props) {
  return <div className="fixed inset-0 z-[115] overflow-y-auto bg-black/80 p-3 backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-labelledby="plans-title" className="mx-auto my-3 w-full max-w-6xl rounded-2xl border border-slate-600 bg-[#0f172a] p-5 shadow-2xl md:my-6 md:p-7">
    <div className="flex items-start justify-between gap-4"><div><h2 id="plans-title" className="text-2xl font-bold text-white">Porównaj plany E‑Teczki</h2><p className="mt-1 text-sm text-slate-400">Zobacz, co jest dostępne w każdym planie, i wybierz sposób rozliczenia.</p></div><button onClick={onClose} aria-label="Zamknij" className="text-2xl text-slate-400 hover:text-white">×</button></div>
    <div className="mt-5 grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-slate-700 bg-[#1e293b] p-4"><p className="font-semibold text-slate-300">Darmowy</p><p className="mt-2 text-3xl font-bold text-white">0 zł</p><p className="mt-2 text-sm text-slate-400">Podstawowe zarządzanie dokumentami.</p><button type="button" disabled={busy || currentPlan === 'free'} onClick={onSelectFree} className="mt-4 w-full rounded-lg border border-slate-500 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:cursor-default disabled:opacity-60">{currentPlan === 'free' ? 'Twój obecny plan' : developmentOverride ? 'Testuj plan Darmowy' : cancellationScheduled ? 'Sprawdź przejście na Darmowy' : 'Przejdź na Darmowy'}</button>{currentPlan !== 'free' && !developmentOverride && <p className="mt-2 text-xs text-slate-400">Zmiana nastąpi po zakończeniu opłaconego okresu.</p>}</div><div className="rounded-xl border border-blue-500/70 bg-blue-950/20 p-4"><p className="font-semibold text-blue-300">Standard</p><p className="mt-2 text-3xl font-bold text-white">4,99 zł <span className="text-sm font-normal text-slate-400">/ mies.</span></p><p className="text-sm text-slate-400">lub 49,90 zł / rok</p><p className="mt-2 text-xs text-slate-300">Wyższe limity dokumentów, skanowania i tagów.</p><CheckoutButtons plan="standard" busy={busy} onSelect={onSelect} /></div><div className="rounded-xl border-2 border-emerald-400 bg-emerald-950/30 p-4"><p className="font-semibold text-emerald-300">Premium</p><p className="mt-2 text-3xl font-bold text-white">9,99 zł <span className="text-sm font-normal text-slate-400">/ mies.</span></p><p className="text-sm text-slate-400">lub 99,90 zł / rok</p><p className="mt-2 text-xs text-slate-300">OCR, drukarka, tagi i kopie w chmurze.</p><CheckoutButtons plan="premium" busy={busy} onSelect={onSelect} /></div></div>
    <div className="mt-6 flex items-center justify-between gap-2"><h3 className="text-lg font-bold text-white">Porównanie funkcji</h3><span className="text-xs text-slate-400">✓ dostępne · ✕ niedostępne</span></div><p className="mt-1 text-xs text-slate-400 md:hidden">Przesuń tabelę w bok, aby zobaczyć wszystkie plany.</p>
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-700"><table className="w-full min-w-[650px] border-collapse text-sm"><thead><tr className="bg-slate-800/70 text-left text-xs uppercase text-slate-300"><th scope="col" className="px-4 py-3">Funkcja</th><th scope="col" className="w-32 px-2 text-center">Darmowy</th><th scope="col" className="w-32 px-2 text-center">Standard</th><th scope="col" className="w-32 px-2 text-center text-emerald-300">Premium</th></tr></thead><tbody>{sections.map(section => <Fragment key={section.title}><tr><th colSpan={4} scope="colgroup" className="border-t border-slate-700 bg-slate-800/40 px-4 py-2 text-left font-bold text-blue-200">{section.title}</th></tr>{section.items.map(item => <tr key={item.name} className="border-t border-slate-800"><th scope="row" className="px-4 py-3 text-left font-medium text-slate-200">{item.name}{item.description && <span className="mt-1 block text-xs font-normal text-slate-400">{item.description}</span>}</th><td className="px-2 text-center"><Cell value={item.free} /></td><td className="px-2 text-center"><Cell value={item.standard} /></td><td className="px-2 text-center"><Cell value={item.premium} /></td></tr>)}</Fragment>)}</tbody></table></div>
    <div className="mt-5 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-100">Funkcje oznaczone „W przygotowaniu” są przypisane do planu Premium i nie są jeszcze dostępne.</div><p className="mt-4 text-center text-xs text-slate-400">Ostateczna kwota i okres rozliczenia są pokazane przed zatwierdzeniem płatności w Stripe.</p>
  </div></div>;
}
