const configuredUrl = import.meta.env.VITE_MOBILE_APP_URL || '';
function playStoreUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' && Boolean(url.searchParams.get('id')) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const downloadUrl = playStoreUrl(configuredUrl);
export default function MobileAppDownload() {
  return <section className="rounded-xl border border-slate-600 bg-slate-950/40 p-4"><h3 className="font-semibold text-white">E‑Teczka na Androida</h3><p className="mt-2 text-sm leading-6 text-slate-400">Skanuj dokumenty aparatem telefonu i przesyłaj je do E‑Teczki na komputerze przez wspólną sieć Wi‑Fi.</p>{downloadUrl ? <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500">Pobierz z Google Play ↗</a> : <><button type="button" disabled className="mt-4 rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-400">Google Play · wkrótce dostępna</button><p className="mt-2 text-xs leading-5 text-slate-400">Aplikacja mobilna jest w przygotowaniu. Link do pobrania pojawi się tutaj po publikacji w Google Play. Możesz już korzystać z aplikacji na komputerze.</p></>}</section>;
}
