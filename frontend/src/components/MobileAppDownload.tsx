import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { resolveApiBase } from '../services/apiBase';

const configuredUrl = import.meta.env.VITE_MOBILE_APP_URL || '';
function playStoreUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' && Boolean(url.searchParams.get('id')) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const downloadUrl = playStoreUrl(configuredUrl);

export default function MobileAppDownload() {
  const [testApk, setTestApk] = useState<{ url: string; sizeMb?: number } | null>(null);

  useEffect(() => {
    let active = true;
    const apiBase = resolveApiBase(window.location, import.meta.env.VITE_API_URL);
    void fetch(`${apiBase}/api/mobile-app/status`)
      .then(async res => (res.ok ? (await res.json()) as { available?: boolean; path?: string; sizeMb?: number } : null))
      .then(data => {
        if (active && data?.available && data.path) {
          setTestApk({ url: `${apiBase}${data.path}`, sizeMb: data.sizeMb });
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const envWebUrl = (import.meta.env.VITE_PUBLIC_WEB_URL || '').trim();
  const isReachableOrigin = typeof window !== 'undefined'
    && /^https?:\/\//i.test(window.location.origin)
    && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(window.location.origin);
  const webAppUrl = /^https?:\/\//i.test(envWebUrl) ? envWebUrl : isReachableOrigin ? window.location.origin : '';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border border-slate-600 bg-slate-950/40 p-4">
        <h3 className="font-semibold text-white">🤖 MojaTeczka na Androida</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Skanuj dokumenty aparatem telefonu i przesyłaj je do MojejTeczki na komputerze przez wspólną sieć Wi‑Fi.
        </p>
        {testApk ? (
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3">
            <div className="rounded-lg bg-white p-2">
              <QRCode value={testApk.url} size={120} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Wersja testowa Android (APK)</p>
              <p className="mt-1 text-xs leading-5 text-slate-300">
                Zeskanuj kod QR aparatem telefonu z Androidem, aby pobrać i zainstalować aplikację{typeof testApk.sizeMb === 'number' ? ` (${testApk.sizeMb} MB)` : ''}.
              </p>
              <a href={testApk.url} className="mt-3 inline-flex rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-emerald-950 hover:bg-emerald-400">
                Pobierz plik APK ↗
              </a>
            </div>
          </div>
        ) : downloadUrl ? (
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500">
            Pobierz z Google Play ↗
          </a>
        ) : (
          <>
            <button type="button" disabled className="mt-4 rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-400">
              Google Play · wkrótce dostępna
            </button>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Aplikacja natywna jest w przygotowaniu. Możesz już korzystać z pełnej wersji mobilnej w przeglądarce Chrome na Androidzie (Dodaj do ekranu głównego).
            </p>
          </>
        )}
      </section>

      <section className="rounded-xl border border-cyan-500/40 bg-cyan-950/20 p-4">
        <h3 className="font-semibold text-white">🍎 iPhone / iPad (iOS) i macOS</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Pełna aplikacja internetowa (PWA) z ikoną na ekranie, aparatem OCR i dostępem do wspólnych kartotek rodzinnych — bez instalacji ze sklepu.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-xl border border-cyan-500/30 bg-slate-950/50 p-3">
          {webAppUrl && (
            <div className="rounded-lg bg-white p-2">
              <QRCode value={webAppUrl} size={120} />
            </div>
          )}
          <ol className="min-w-0 flex-1 list-decimal space-y-1 pl-4 text-xs leading-5 text-slate-300">
            <li>Zeskanuj kod QR aparatem iPhone’a / iPada i otwórz stronę w <strong className="text-white">Safari</strong>.</li>
            <li>Kliknij ikonę <strong className="text-white">Udostępnij</strong> na dolnym pasku Safari.</li>
            <li>Wybierz <strong className="text-cyan-300">„Do ekranu początkowego”</strong> — MojaTeczka uruchomi się jak natywna aplikacja.</li>
          </ol>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Plan Rodzinny wykupiony na koncie działa jednocześnie na Androidzie, iPhone, Windows i macOS.
        </p>
      </section>
    </div>
  );
}
