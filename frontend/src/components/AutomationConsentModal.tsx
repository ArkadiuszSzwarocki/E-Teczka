import { useState } from 'react';

export type AutomationConsentFeature = 'autoSuggest' | 'allowServerAi' | 'autoMailSync';

type ConsentCopy = {
  title: string;
  summary: string;
  details: string[];
};

const CONSENT_COPY: Record<AutomationConsentFeature, ConsentCopy> = {
  autoSuggest: {
    title: 'Automatyczna sugestia kartoteki po skanie (offline)',
    summary: 'Włączenie tej funkcji oznacza zgodę na lokalne analizowanie dokumentów w celu automatycznego dopasowania kartoteki.',
    details: [
      'Aplikacja lokalnie analizuje nazwę pliku, rozpoznany tekst OCR oraz Twoje wcześniejsze korekty przypisań.',
      'Przetwarzanie odbywa się wyłącznie na tym urządzeniu (offline) — dane nie są wysyłane w sieć.',
      'Sugestia ma charakter pomocniczy i zawsze możesz ją zmienić przed zapisaniem dokumentu.',
    ],
  },
  allowServerAi: {
    title: 'Zezwól na własny serwer AI/OCR (opcjonalnie, bez zapisu)',
    summary: 'Włączenie tej funkcji oznacza zgodę na tymczasowe przesyłanie dokumentów do bezstanowego serwera AI/OCR MojejTeczki.',
    details: [
      'Dokument może zostać przekazany do serwera AI/OCR w celu rozpoznania tekstu i kategoryzacji.',
      'Przetwarzanie odbywa się wyłącznie w pamięci RAM serwera, bez trwałego zapisu ani archiwizowania plików.',
      'Funkcja jest całkowicie opcjonalna — możesz ją wyłączyć w dowolnym momencie w opcjach aplikacji.',
    ],
  },
  autoMailSync: {
    title: 'Automatyczne skanowanie poczty przy wejściu do MojejTeczki',
    summary: 'Włączenie tej funkcji oznacza zgodę na automatyczne sprawdzanie skonfigurowanej skrzynki IMAP przy każdym otwarciu aplikacji.',
    details: [
      'Po wejściu do MojejTeczki aplikacja automatycznie połączy się ze skonfigurowaną skrzynką IMAP.',
      'Pobierane są wyłącznie informacje o nowych wiadomościach z załącznikami w celu zaproponowania ich przydziału do kartotek.',
      'W każdej chwili możesz zatrzymać skanowanie lub wyłączyć automatyzację w tym panelu.',
    ],
  },
};

type Props = {
  feature: AutomationConsentFeature;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Requires explicit per-activation consent and acknowledgment before enabling scanning/OCR/automation features. */
export default function AutomationConsentModal({ feature, onConfirm, onCancel }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);
  const copy = CONSENT_COPY[feature];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="automation-consent-title" className="w-full max-w-lg rounded-2xl border border-cyan-500/40 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-wider text-cyan-300">Zgoda na uruchomienie funkcji</p>
        <h2 id="automation-consent-title" className="mt-1 text-lg font-bold text-white">{copy.title}</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">{copy.summary}</p>

        <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3.5 text-xs">
          <p className="font-semibold text-white">Na co wyrażasz zgodę:</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-slate-300">
            {copy.details.map((item, idx) => <li key={idx}>{item}</li>)}
          </ul>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-200">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-500 accent-cyan-500"
          />
          <span>
            Potwierdzam, że zapoznałem(-am) się z powyższymi informacjami oraz wyrażam zgodę na działanie tej funkcji.
          </span>
        </label>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">
            Anuluj
          </button>
          <button
            type="button"
            disabled={!acknowledged}
            onClick={onConfirm}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Potwierdzam i włącz
          </button>
        </div>
      </section>
    </div>
  );
}
