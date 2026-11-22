import { useEffect, useState } from 'react';
import MobileAppDownload from './MobileAppDownload';
type Choice = 'new' | 'later' | 'dismissed' | 'paired';
type Props = { email: string; phoneConnected: boolean; onPair: () => void };
export default function MobileOnboarding({ email, phoneConnected, onPair }: Props) {
  const storageKey = `mojateczka_mobile_onboarding_v1:${email.trim().toLowerCase()}`;
  const [choice, setChoice] = useState<Choice>(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === 'later' || stored === 'dismissed' || stored === 'paired' ? stored : 'new';
  });
  const [open, setOpen] = useState(choice === 'new');
  function remember(value: Choice) { localStorage.setItem(storageKey, value); setChoice(value); setOpen(false); }
  useEffect(() => {
    if (phoneConnected) localStorage.setItem(storageKey, 'paired');
  }, [phoneConnected, storageKey]);
  if (phoneConnected || choice === 'paired' || localStorage.getItem(storageKey) === 'paired' || choice === 'dismissed') return null;
  return <>
    {!open && <aside aria-label="Aplikacja mobilna MojaTeczka" className="fixed bottom-5 right-5 z-40 w-[calc(100%-2.5rem)] max-w-sm rounded-2xl border border-blue-500/40 bg-slate-900 p-5 text-slate-200 shadow-2xl"><p className="font-semibold text-white">MojaTeczka także na telefonie</p><p className="mt-2 text-sm leading-6 text-slate-400">Skanowanie telefonem i przesyłanie do komputera. Sprawdź dostępność w Google Play i sposób połączenia.</p><button onClick={() => setOpen(true)} className="mt-3 text-sm font-semibold text-blue-300 hover:text-blue-200">Zobacz aplikację mobilną →</button><button onClick={() => remember('dismissed')} className="mt-3 block text-xs text-slate-400 hover:text-white">Nie przypominaj więcej</button></aside>}
    {open && (
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="mobile-intro-title" className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-600/80 bg-[#0f172a] p-5 text-slate-200 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-blue-400">Komputer + telefon</p>
              <h2 id="mobile-intro-title" className="mt-1 text-xl font-bold text-white sm:text-2xl">Twoje dokumenty zaczynają się także w telefonie</h2>
              <p className="mt-1.5 text-xs leading-5 text-slate-300 sm:text-sm">
                Połączenie telefonu jest opcjonalne. Po zeskanowaniu kodu QR zaufany telefon prześle skany, paragony i zdjęcia prosto do Twojego archiwum.
              </p>
            </div>
            <button aria-label="Przypomnij o aplikacji mobilnej później" onClick={() => remember('later')} className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
          </div>

          <div className="mt-4">
            <MobileAppDownload />
          </div>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2.5 text-xs text-slate-300">
              <span className="font-bold text-blue-300">1. Zainstaluj</span> — pobierz APK na Androida lub dodaj PWA w Safari na iPhone.
            </div>
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2.5 text-xs text-slate-300">
              <span className="font-bold text-blue-300">2. Wspólne Wi‑Fi</span> — połącz telefon i komputer z tą samą siecią lokalną.
            </div>
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-2.5 text-xs text-slate-300">
              <span className="font-bold text-blue-300">3. Zeskanuj QR</span> — w aplikacji wybierz „Połączenie z komputerem”.
            </div>
          </div>

          <div className="mt-4 flex flex-col items-stretch justify-between gap-3 border-t border-slate-800 pt-4 sm:flex-row sm:items-center">
            <p className="text-[11px] leading-4 text-slate-400 sm:max-w-md">
              Instrukcję znajdziesz zawsze pod przyciskiem <strong className="text-slate-300">„Telefon”</strong> na górnym pasku. Plany Rodzinny i Firmowy obsługują wiele urządzeń jednocześnie.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
              <button onClick={() => remember('later')} className="rounded-xl border border-slate-600 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">
                Pomiń na razie
              </button>
              <button onClick={() => { remember('later'); onPair(); }} className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-blue-500">
                Mam aplikację — połącz telefon →
              </button>
            </div>
          </div>
        </section>
      </div>
    )}
  </>;
}
