import { useEffect, useRef, useState } from 'react';
import { getUseClassicIcons, setUseClassicIcons } from './FolderIconPicker';
import { APP_ZOOM_PRESETS, getAppZoom, setAppZoom } from '../services/appZoom';
type Props = { embedded?: boolean; isPremiumPlan?: boolean; onClose: () => void; onPair: () => void; onSecurity: () => void; onTags: () => void; onBackup: () => void; onBackupSecurity: () => void; onSelfHostGuide?: () => void; onDeleteAccount: () => void; onLogout: () => void };
export default function SettingsDialog({ embedded = false, isPremiumPlan = false, onClose, onPair, onSecurity, onTags, onBackup, onBackupSecurity, onSelfHostGuide, onDeleteAccount, onLogout }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [classicIcons, setClassicIcons] = useState(getUseClassicIcons);
  const [appZoom, setAppZoomState] = useState(getAppZoom);
  const changeZoom = (next: number) => setAppZoomState(setAppZoom(next));
  useEffect(() => {
    if (embedded) return;
    const window = dialog.current;
    window?.showModal();
    return () => window?.close();
  }, [embedded]);
  const items = [
    { icon: '📱', title: 'Telefon i urządzenia', description: 'Aplikacja mobilna, pobieranie i połączenie z komputerem.', action: onPair },
    { icon: '🔐', title: 'Zabezpieczenia dostępu', description: 'Ustaw lub zmień lokalny PIN, hasło i odzyskiwanie dostępu.', action: onSecurity },
    { icon: '🏷️', title: 'Tagi dokumentów', description: 'Zarządzaj nazwami i kolorami oznaczeń dokumentów.', action: onTags },
    { icon: '☁️', title: 'Kopia zapasowa', description: 'Skonfiguruj miejsce zapisu, folder docelowy i harmonogram kopii.', action: onBackup },
    { icon: '🛡️', title: 'Zabezpieczenia kopii', description: 'Microsoft Authenticator (MFA) oraz klucz odzyskiwania zaszyfrowanej kopii.', action: onBackupSecurity },
    ...(isPremiumPlan && onSelfHostGuide ? [{ icon: '🖥️', title: 'Własny serwer i migracja bazy', description: 'Instrukcja szybkiej konfiguracji własnego serwera oraz przeniesienia bazy danych i plików (Premium / Firmowy).', action: onSelfHostGuide }] : []),
  ];
  function choose(action: () => void) { onClose(); action(); }
  const content = (
    <>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-700 px-6 py-5 sm:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">E‑Teczka</p>
          <h2 id="settings-window-title" className="mt-1.5 text-2xl font-bold text-white">Ustawienia aplikacji</h2>
          <p className="mt-1 text-sm text-slate-400">Wybierz, co chcesz skonfigurować.</p>
        </div>
        <button autoFocus type="button" aria-label="Zamknij ustawienia" onClick={onClose} className="rounded-lg px-3 py-1 text-3xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
      </header>
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        <div className="mx-auto grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map(item => <button key={item.title} type="button" onClick={() => choose(item.action)} className="rounded-2xl border border-slate-700 bg-slate-800/40 p-6 text-left transition-colors hover:border-blue-400 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><span aria-hidden="true" className="text-3xl">{item.icon}</span><h3 className="mt-4 text-lg font-semibold text-white">{item.title} <span className="float-right text-slate-500">→</span></h3><p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p></button>)}</div>
        <div className="mx-auto mt-6 flex max-w-6xl flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-700 bg-slate-800/40 px-6 py-4"><div><h3 className="text-sm font-semibold text-white">🔍 Wielkość aplikacji (skala interfejsu)</h3><p className="mt-0.5 text-xs text-slate-400">Zmniejsza lub powiększa wszystkie elementy aplikacji tak jak powiększenie w przeglądarce.</p></div><div className="flex flex-wrap items-center gap-1.5"><button type="button" aria-label="Zmniejsz skalę aplikacji" onClick={() => changeZoom(appZoom - 5)} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700">−</button>{APP_ZOOM_PRESETS.map(preset => <button key={preset} type="button" onClick={() => changeZoom(preset)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${appZoom === preset ? 'bg-blue-600 text-white' : 'border border-slate-600 bg-slate-900/60 text-slate-300 hover:bg-slate-700'}`}>{preset}%</button>)}<button type="button" aria-label="Zwiększ skalę aplikacji" onClick={() => changeZoom(appZoom + 5)} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700">+</button>{!APP_ZOOM_PRESETS.includes(appZoom as (typeof APP_ZOOM_PRESETS)[number]) && <span className="ml-1 text-xs font-semibold text-blue-300">{appZoom}%</span>}</div></div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-slate-700 px-6 py-5 sm:px-8"><label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-200"><input type="checkbox" checked={classicIcons} onChange={e => { setClassicIcons(e.target.checked); setUseClassicIcons(e.target.checked); }} className="h-4 w-4 accent-blue-500" /><span>Klasyczne ikony w całej aplikacji</span></label><p className="text-xs text-slate-500">Sesja wygasa po 20 minutach od zalogowania.</p><div className="flex items-center gap-3"><button type="button" onClick={() => choose(onDeleteAccount)} className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">🗑️ Usuń konto trwale</button><button type="button" onClick={() => choose(onLogout)} className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"><span aria-hidden="true">⇥</span>Wyloguj</button></div></footer>
    </>
  );
  if (embedded) {
    return <section aria-labelledby="settings-window-title" className="flex w-full flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0f172a] text-slate-200 shadow-xl">{content}</section>;
  }
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="settings-window-title" className="m-0 flex h-[100dvh] max-h-none w-screen max-w-none flex-col overflow-hidden border-0 bg-[#0f172a] p-0 text-slate-200 backdrop:bg-black/80">{content}</dialog>;
}
