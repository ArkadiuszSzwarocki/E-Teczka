import { useEffect, useState } from 'react';

type PromoHit = { planLabel: string; intervalLabel: string; name: string; percent: number };
type QuoteItem = { promotion: { name: string; percent: number } | null };
type CatalogQuotes = { quotes?: { standard?: { monthly?: QuoteItem; yearly?: QuoteItem }; premium?: { monthly?: QuoteItem; yearly?: QuoteItem } } };

export default function PromotionBanner({ apiUrl, fetcher, currentPlan, onOpenPlans }: { apiUrl: string; fetcher: typeof fetch; currentPlan: string; onOpenPlans: () => void }) {
  const [promo, setPromo] = useState<PromoHit | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    void fetcher(`${apiUrl}/api/billing/catalog`)
      .then(async res => (res.ok ? ((await res.json()) as CatalogQuotes) : null))
      .then(data => {
        if (!active || !data?.quotes) return;
        const candidates: PromoHit[] = [];
        const entries: Array<['standard' | 'premium', string, 'monthly' | 'yearly', string]> = [
          ['standard', 'Standard', 'monthly', 'miesięczny'],
          ['standard', 'Standard', 'yearly', 'roczny'],
          ['premium', 'Premium', 'monthly', 'miesięczny'],
          ['premium', 'Premium', 'yearly', 'roczny'],
        ];
        for (const [plan, planLabel, interval, intervalLabel] of entries) {
          const item = data.quotes[plan]?.[interval]?.promotion;
          if (item) candidates.push({ planLabel, intervalLabel, name: item.name, percent: item.percent });
        }
        candidates.sort((a, b) => b.percent - a.percent);
        setPromo(candidates[0] ?? null);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [apiUrl, fetcher, currentPlan]);

  if (!promo || dismissed) return null;

  return (
    <div role="status" className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/35 px-4 py-2.5 text-sm text-emerald-100">
      <p>
        <strong className="text-emerald-300">Promocja −{promo.percent}%</strong> · {promo.name} (plan {promo.planLabel}, rozliczenie {promo.intervalLabel})
      </p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onOpenPlans} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-950 hover:bg-emerald-400">
          Zobacz plany
        </button>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Ukryj informację o promocji" className="px-2 py-1 text-xs text-slate-400 hover:text-white">
          ×
        </button>
      </div>
    </div>
  );
}
