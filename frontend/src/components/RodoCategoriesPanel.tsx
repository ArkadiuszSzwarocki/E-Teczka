import { useState } from 'react';
import {
  RODO_CATEGORIES,
  getRodoCategories,
  getRodoSmartDetectionEnabled,
  setRodoCategories,
  setRodoSmartDetectionEnabled,
  type RodoCategory,
} from '../services/rodoProtection';

/** Lets users choose which RODO personal/sensitive data categories trigger automatic OCR protection. */
export default function RodoCategoriesPanel() {
  const [selected, setSelected] = useState<RodoCategory[]>(getRodoCategories);
  const [smartEnabled, setSmartEnabled] = useState<boolean>(getRodoSmartDetectionEnabled);

  const toggleCategory = (id: RodoCategory) => {
    const next = selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id];
    setSelected(next);
    setRodoCategories(next);
  };

  const toggleSmart = () => {
    const next = !smartEnabled;
    setSmartEnabled(next);
    setRodoSmartDetectionEnabled(next);
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-700/80 bg-[#0f172a]/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Zakres ochrony RODO (wykrywanie po OCR)</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Wybierz dane, które mają wyzwalać maskowanie [RODO] i blokadę podglądu. Dokumenty bez tych danych (np. regulaminy) otworzą się bez hasła.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={smartEnabled}
          onClick={toggleSmart}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${smartEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
          title="Chroń tylko dokumenty zawierające wybrane dane RODO"
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${smartEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      <p className="text-[11px] font-semibold text-cyan-300">
        {smartEnabled
          ? 'Tryb inteligentny: chronione są tylko dokumenty, w których OCR wykrył zaznaczone poniżej dane RODO.'
          : 'Tryb ścisły: blokada PIN/hasłem obowiązuje dla wszystkich dokumentów niezależnie od treści.'}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {RODO_CATEGORIES.map(cat => {
          const checked = selected.includes(cat.id);
          return (
            <label
              key={cat.id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-xs transition ${checked ? 'border-cyan-500/50 bg-cyan-950/20 text-slate-100' : 'border-slate-700 bg-slate-900/40 text-slate-400'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleCategory(cat.id)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cyan-500"
              />
              <span className="min-w-0">
                <span className="block font-semibold">{cat.label}</span>
                <span className="block text-[11px] opacity-80">{cat.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
