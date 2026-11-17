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

  return (
    <section className="rounded-xl border border-slate-600 bg-slate-950/40 p-4">
      <h3 className="font-semibold text-white">E‑Teczka na Androida</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        Skanuj dokumenty aparatem telefonu i przesyłaj je do E‑Teczki na komputerze przez wspólną sieć Wi‑Fi.
      </p>
      {testApk ? (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-3">
          <div className="rounded-lg bg-white p-2">
            <QRCode value={testApk.url} size={132} />
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
            Aplikacja mobilna jest w przygotowaniu. Link do pobrania pojawi się tutaj po publikacji w Google Play. Możesz już korzystać z aplikacji na komputerze.
          </p>
        </>
      )}
    </section>
  );
}
