import { useEffect, useState } from 'react';
import MobileAppDownload from './MobileAppDownload';
type Choice = 'new' | 'later' | 'dismissed' | 'paired';
type Props = { email: string; phoneConnected: boolean; onPair: () => void };
export default function MobileOnboarding({ email, phoneConnected, onPair }: Props) {
  const storageKey = `eteczka_mobile_onboarding_v1:${email.trim().toLowerCase()}`;
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
    {open && <div className="fixed inset-0 z-[130] flex items-center justify-center overflow-y-auto bg-black/75 p-5 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="mobile-intro-title" className="my-auto w-full max-w-lg rounded-3xl border border-slate-600 bg-slate-900 p-7 text-slate-200 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-400">Komputer + telefon</p><h2 id="mobile-intro-title" className="text-2xl font-semibold text-white">Twoje dokumenty zaczynają się także w telefonie</h2></div><button aria-label="Przypomnij o aplikacji mobilnej później" onClick={() => remember('later')} className="text-2xl text-slate-400 hover:text-white">×</button></div><p className="mb-5 mt-4 text-sm leading-6 text-slate-300">MojaTeczka ma również aplikację mobilną. Połączenie telefonu jest opcjonalne. Po zeskanowaniu QR lub podaniu kodu połączysz telefon z tym komputerem jako zaufanym urządzeniem. Zeskanowane dokumenty prześlesz prosto do swojego archiwum.</p><MobileAppDownload /><ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-300"><li>Zainstaluj aplikację mobilną, gdy będzie dostępna.</li><li>Połącz telefon i komputer z tą samą siecią Wi‑Fi.</li><li>Na telefonie wybierz „Połączenie z komputerem” i zeskanuj kod QR z MojejTeczki lub podaj kod parowania.</li></ol><p className="mt-4 rounded-lg bg-blue-950/40 p-3 text-xs leading-5 text-blue-200">Konto indywidualne pozwala połączyć jeden zaufany telefon. Kolejny telefon zostanie zablokowany. Plany Rodzinny i Firmowy z obsługą wielu telefonów są w przygotowaniu.</p><button onClick={() => { remember('later'); onPair(); }} className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-500">Mam aplikację — połącz telefon</button><button onClick={() => remember('later')} className="mt-3 w-full rounded-xl border border-slate-600 py-3 text-sm text-slate-200 hover:bg-slate-800">Pomiń na razie, przejdź do dokumentów</button><p className="mt-4 text-xs leading-5 text-slate-400">Instrukcję i pobieranie znajdziesz zawsze pod przyciskiem „Telefon” na górnym pasku aplikacji.</p></section></div>}
  </>;
}
