import { useState } from 'react';
import type { BillingPlan, PaidBillingPlan } from '../services/billing';

type Props = {
  message: string;
  plan: BillingPlan;
  busy: boolean;
  onClose: () => void;
  onSelect: (plan: PaidBillingPlan, interval: 'monthly' | 'yearly') => void;
};

const PLAN_PRICES: Record<PaidBillingPlan, { monthly: string; yearly: string }> = {
  standard: { monthly: '4,99', yearly: '49,90' },
  premium: { monthly: '9,99', yearly: '99,90' },
  family: { monthly: '14,99', yearly: '149,90' },
  business: { monthly: '29,99', yearly: '299,90' },
};

/** Displays a plan-limit or upgrade prompt tailored to all 5 plans (Free, Standard, Premium, Family, Business). */
export default function PlanLimitModal({ message, plan, busy, onClose, onSelect }: Props) {
  const [otherPlans, setOtherPlans] = useState(false);
  const googlePlayAvailable = false;
  const needsBusiness = /ksef|ksi[ęe]gow|firmow/i.test(message) || plan === 'premium' || plan === 'family';
  const showBusinessOffer = plan !== 'business' && needsBusiness;
  const showPremiumOffer = (plan === 'free' || plan === 'standard') && !needsBusiness;

  const prices = (selected: PaidBillingPlan) => (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button
        disabled={busy || !googlePlayAvailable}
        onClick={() => onSelect(selected, 'monthly')}
        className="rounded-lg border border-blue-400 px-3 py-2 text-sm font-semibold text-blue-100 disabled:opacity-50"
      >
        {PLAN_PRICES[selected].monthly} zł / miesiąc
      </button>
      <button
        disabled={busy || !googlePlayAvailable}
        onClick={() => onSelect(selected, 'yearly')}
        className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-emerald-950 disabled:opacity-50"
      >
        {PLAN_PRICES[selected].yearly} zł / rok
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[160] overflow-y-auto bg-black/80 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="limit-title" className="mx-auto my-8 max-w-lg rounded-2xl border border-slate-600 bg-[#0f172a] p-6 shadow-2xl">
        <div className="flex justify-between gap-4">
          <h2 id="limit-title" className="text-xl font-bold text-white">Limit Twojego planu</h2>
          <button onClick={onClose} aria-label="Zamknij" className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-200">{message}</p>

        {showBusinessOffer && (
          <div className="mt-5 rounded-xl border border-violet-500 bg-violet-950/30 p-4">
            <h3 className="font-bold text-violet-300">MojaTeczka Firmowy (JDG)</h3>
            <p className="mt-1 text-sm text-slate-300">Import faktur KSeF (XML + podgląd PDF), Paczka dla księgowej (ZIP + CSV) oraz do 10 telefonów firmowych.</p>
            {prices('business')}
          </div>
        )}

        {showPremiumOffer && (
          <>
            <div className="mt-5 rounded-xl border border-emerald-500 bg-emerald-950/30 p-4">
              <h3 className="font-bold text-emerald-300">MojaTeczka Premium</h3>
              <p className="mt-1 text-sm text-slate-300">Bez limitu dokumentów, tagów, skanów i łączenia stron. OCR, IMAP i kopie NAS/chmura.</p>
              {prices('premium')}
            </div>
            <button onClick={() => setOtherPlans(!otherPlans)} className="mt-4 text-sm font-semibold text-blue-300 hover:text-white">
              {otherPlans ? 'Ukryj inne plany' : 'Inne plany'} {otherPlans ? '▴' : '▾'}
            </button>
            {otherPlans && (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-slate-700 p-3 text-sm text-slate-300">
                  <strong>Darmowy</strong> — 20 dokumentów, 3 tagi, 20 skanów i 3 łączenia co 7 dni.
                </div>
                <div className="rounded-lg border border-slate-700 p-3 text-sm text-slate-300">
                  <strong>Standard</strong> — 40 dokumentów, 6 tagów, 40 skanów i 10 łączeń co 7 dni.
                  {plan === 'free' ? prices('standard') : <p className="mt-2 text-xs">To Twój obecny plan.</p>}
                </div>
                <div className="rounded-lg border border-amber-600/50 p-3 text-sm text-slate-300">
                  <strong>Rodzinny</strong> — wszystko z Premium + do 4 telefonów domowników.{prices('family')}
                </div>
                <div className="rounded-lg border border-violet-600/50 p-3 text-sm text-slate-300">
                  <strong>Firmowy (JDG)</strong> — KSeF XML + PDF, Paczka dla księgowej i do 10 telefonów.{prices('business')}
                </div>
              </div>
            )}
          </>
        )}

        {(showBusinessOffer || showPremiumOffer) ? (
          <p className="mt-4 text-xs text-slate-400">Zakup przez Google Play jest w przygotowaniu.</p>
        ) : (
          <p className="mt-3 text-sm text-slate-400">Sprawdź szczegóły limitu lub spróbuj ponownie później.</p>
        )}

        <button onClick={onClose} className="mt-5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">Wróć do pracy</button>
      </section>
    </div>
  );
}
