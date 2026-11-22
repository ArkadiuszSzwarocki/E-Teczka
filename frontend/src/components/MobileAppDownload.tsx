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
    <div className="grid gap-3.5 md:grid-cols-2">
      <section className="flex flex-col justify-between rounded-xl border border-slate-700 bg-slate-950/50 p-4">
        <div>
          <h3 className="text-sm font-bold text-white">🤖 MojaTeczka na Androida</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Skanuj dokumenty aparatem telefonu i przesyłaj je do MojejTeczki na komputerze przez Wi‑Fi.
          </p>
        </div>
        {testApk ? (
          <div className="mt-3 flex items-center gap-3.5 rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3">
            <div className="shrink-0 rounded-lg bg-white p-1.5">
              <QRCode value={testApk.url} size={96} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">Wersja testowa Android (APK)</p>
              <p className="mt-1 text-xs leading-4 text-slate-300">
                Zeskanuj kod QR telefonem z Androidem, aby pobrać aplikację{typeof testApk.sizeMb === 'number' ? ` (${testApk.sizeMb} MB)` : ''}.
              </p>
              <a href={testApk.url} className="mt-2.5 inline-flex rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-950 hover:bg-emerald-400">
                Pobierz plik APK ↗
              </a>
            </div>
          </div>
        ) : downloadUrl ? (
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex self-start rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-500">
            Pobierz z Google Play ↗
          </a>
        ) : (
          <div className="mt-3">
            <button type="button" disabled className="rounded-lg border border-slate-600 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-400">
              Google Play · wkrótce dostępna
            </button>
            <p className="mt-2 text-xs leading-4 text-slate-400">
              Możesz też korzystać z wersji PWA w Chrome na Androidzie (Dodaj do ekranu głównego).
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col justify-between rounded-xl border border-cyan-500/40 bg-cyan-950/20 p-4">
        <div>
          <h3 className="text-sm font-bold text-white">🍎 iPhone / iPad (iOS) i macOS</h3>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            Pełna aplikacja internetowa (PWA) z ikoną na ekranie, aparatem OCR i wspólnymi kartotekami — bez instalacji ze sklepu.
          </p>
        </div>
        <div className="mt-3 flex items-center gap-3.5 rounded-xl border border-cyan-500/30 bg-slate-950/50 p-3">
          {webAppUrl && (
            <div className="shrink-0 rounded-lg bg-white p-1.5">
              <QRCode value={webAppUrl} size={96} />
            </div>
          )}
          <ol className="min-w-0 flex-1 list-decimal space-y-1 pl-4 text-xs leading-4 text-slate-300">
            <li>Otwórz stronę w <strong className="text-white">Safari</strong> na iPhone / iPadzie.</li>
            <li>Kliknij <strong className="text-white">Udostępnij</strong> na dolnym pasku Safari.</li>
            <li>Wybierz <strong className="text-cyan-300">„Do ekranu początkowego”</strong>.</li>
          </ol>
        </div>
      </section>
    </div>
  );
}
