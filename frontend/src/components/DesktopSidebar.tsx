import type { DocumentRecord } from '../types/domain';
import { useState } from 'react';
import type { BackupSection } from './BackupModal';
import { useClassicIcons } from './FolderIconPicker';
import { getEnvironmentLabel, isMobileBrowser } from '../services/platform';
import mojateczkaAppIcon from '../assets/mojateczka-folder.png';
import kartotekiIcon from '../assets/sidebar-icons/kartoteki.png';
import dodajDokumentIcon from '../assets/sidebar-icons/dodaj-dokument.png';
import skanujIcon from '../assets/sidebar-icons/skanuj.png';
import polaczTelefonIcon from '../assets/sidebar-icons/polacz-telefon.png';
import archiwumIcon from '../assets/sidebar-icons/archiwum.png';
import koszIcon from '../assets/sidebar-icons/kosz.png';
import kopiaZapasowaIcon from '../assets/sidebar-icons/kopia-zapasowa.png';
import panelDeweloperaIcon from '../assets/sidebar-icons/panel-dewelopera.png';
import ustawieniaIcon from '../assets/sidebar-icons/ustawienia.png';

type Props = {
  activeView: string;
  documents: DocumentRecord[];
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  onViewChange: (view: string) => void;
  onOpenScanner: () => void;
  onOpenPairing: () => void;
  onToggleSettings: () => void;
  onOpenBackup: (section: BackupSection) => void;
  onOpenFeedback: () => void;
  userFeedbackReplyCount?: number;
};

/** Persistent desktop navigation. Kept independent from document-table rendering. */
export default function DesktopSidebar({
  activeView, documents, mobileOpen = false, onCloseMobile, onViewChange, onOpenScanner, onOpenPairing,
  onToggleSettings, onOpenBackup, onOpenFeedback, userFeedbackReplyCount = 0,
}: Props) {
  const closeIfMobile = (action: () => void) => () => { onCloseMobile?.(); action(); };
  const [backupMenuOpen, setBackupMenuOpen] = useState(false);
  const classicIcons = useClassicIcons();
  const isMobile = isMobileBrowser();
  const isDev = import.meta.env.DEV;
  const envLabel = getEnvironmentLabel(isDev);
  const navClass = (view: string) => `w-full px-2 py-2 text-left flex items-center gap-2 rounded transition-colors ${activeView === view ? 'cyber-nav-active text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`;
  const icon = (src: string, emoji: string) => classicIcons
    ? <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">{emoji}</span>
    : <img src={src} alt="" aria-hidden="true" className="cyber-icon-glow h-5 w-5 shrink-0 object-contain" />;
  return <>
    {mobileOpen && <div onClick={onCloseMobile} className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-[1px] lg:hidden" aria-hidden="true" />}
    <aside className={`cyber-pane fixed inset-y-0 left-0 z-[125] flex w-72 shrink-0 flex-col border-r border-slate-700 bg-[#1f2937] shadow-xl transition-transform duration-200 lg:static lg:z-10 lg:w-64 lg:translate-x-0 xl:w-72 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
    <div className="flex h-16 items-center gap-3 border-b border-slate-700 bg-[#111827]/50 px-4">
      {classicIcons
        ? <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-2xl">📁</span>
        : <img src={mojateczkaAppIcon} alt="MojaTeczka" className="cyber-icon-glow h-9 w-9 shrink-0 object-contain" />}
      <div className="min-w-0 flex-1 leading-tight">
        <h1 className="text-lg font-bold tracking-wide text-white">MOJATECZKA</h1>
        <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${isDev ? 'border-amber-500/40 bg-amber-500/15 text-amber-300' : 'border-sky-500/40 bg-sky-500/15 text-sky-300'}`}>
          {envLabel}
        </span>
      </div>
      {onCloseMobile && <button type="button" onClick={onCloseMobile} aria-label="Zamknij menu" className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-700 hover:text-white lg:hidden">×</button>}
    </div>
    <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
      <p className="mb-3 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Dokumenty</p>
      <div className="space-y-1 text-sm">
        <button onClick={closeIfMobile(() => onViewChange('analytics'))} className={navClass('analytics')}>{icon(kartotekiIcon, '📊')}<span>Podsumowanie i analizy</span></button>
        <button onClick={closeIfMobile(() => onViewChange('expiry-calendar'))} className={navClass('expiry-calendar')}><span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">🗓️</span><span>Kalendarz ważności</span></button>
        <button onClick={closeIfMobile(() => onViewChange('dashboard'))} className={navClass('dashboard')}>{icon(kartotekiIcon, '📁')}<span>Kartoteki</span></button>
        <button onClick={closeIfMobile(() => onViewChange('upload'))} className={navClass('upload')}>{icon(dodajDokumentIcon, '⬆️')}<span>Dodaj dokument</span></button>
        <button onClick={closeIfMobile(() => onViewChange('mail-inbox'))} className={navClass('mail-inbox')}><span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">📧</span><span>Poczta (Załączniki)</span></button>
        <button onClick={closeIfMobile(() => onViewChange('ksef-sync'))} className={navClass('ksef-sync')}><span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">🏛️</span><span>KSeF (API MF)</span></button>
        <button onClick={closeIfMobile(onOpenScanner)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-slate-400 hover:bg-white/5 hover:text-white">{icon(skanujIcon, isMobile ? '📷' : '🖨️')}<span>{isMobile ? 'Skanuj aparatem telefonu' : 'Skanuj z drukarki'}</span></button>
      </div>
      <p className="mb-3 mt-7 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Urządzenia</p>
      <button onClick={closeIfMobile(onOpenPairing)} aria-haspopup="dialog" className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white">{icon(polaczTelefonIcon, '📱')}<span>{isMobile ? 'Połącz inne urządzenie / QR' : 'Połącz z urządzeniem mobilnym'}</span></button>
      <p className="mb-3 mt-7 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Zapisane</p>
      <div className="space-y-1 text-sm">
        <button onClick={closeIfMobile(() => onViewChange('archive'))} className={`w-full px-2 py-2 text-left flex items-center justify-between rounded transition-colors ${activeView === 'archive' ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}><span className="flex items-center gap-2">{icon(archiwumIcon, '📦')}<span>Archiwum</span></span><span className="text-xs">{documents.filter((doc) => doc.isArchived && !doc.isDeleted).length}</span></button>
        <button onClick={closeIfMobile(() => onViewChange('trash'))} className={`w-full px-2 py-2 text-left flex items-center justify-between rounded transition-colors ${activeView === 'trash' ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}><span className="flex items-center gap-2">{icon(koszIcon, '🗑️')}<span>Kosz</span></span><span className="text-xs">{documents.filter((doc) => doc.isDeleted).length}</span></button>
        <button onClick={() => setBackupMenuOpen(value => !value)} aria-expanded={backupMenuOpen} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-slate-400 hover:bg-white/5 hover:text-white">{icon(kopiaZapasowaIcon, '☁️')}<span>Kopia zapasowa</span><span className="ml-auto">{backupMenuOpen ? '⌃' : '›'}</span></button>
        {backupMenuOpen && <div className="ml-4 border-l border-slate-600 pl-2">
          <button onClick={closeIfMobile(() => onOpenBackup('settings'))} className="w-full rounded px-2 py-2 text-left text-slate-400 hover:bg-white/5 hover:text-white">Ustawienia kopii</button>
          <button onClick={closeIfMobile(() => onOpenBackup('send'))} className="w-full rounded px-2 py-2 text-left text-slate-400 hover:bg-white/5 hover:text-white">Wyślij kopię</button>
          <button onClick={closeIfMobile(() => onOpenBackup('restore'))} className="w-full rounded px-2 py-2 text-left text-slate-400 hover:bg-white/5 hover:text-white">Przywróć kopię</button>
        </div>}
      </div>
    </div>
    <div className="border-t border-slate-700 p-4 space-y-1">
      {import.meta.env.DEV && (
        <button type="button" onClick={closeIfMobile(() => onViewChange('developer'))} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm transition-colors ${activeView === 'developer' ? 'bg-amber-950/50 text-amber-200' : 'text-amber-300 hover:bg-amber-950/40 hover:text-amber-200'}`}>
          {icon(panelDeweloperaIcon, '🛠️')}<span>Panel dewelopera</span><span className="ml-auto">→</span>
        </button>
      )}
      <button onClick={closeIfMobile(onOpenFeedback)} aria-haspopup="dialog" className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-slate-400 hover:bg-white/5 hover:text-white"><span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">🐞</span><span>Zgłoś błąd / uwagę</span>{userFeedbackReplyCount > 0 && <span title="Nowe odpowiedzi zespołu na Twoje zgłoszenia" className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">💬 {userFeedbackReplyCount}</span>}</button>
      <button onClick={closeIfMobile(() => onViewChange('options'))} className={navClass('options')}><span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">🎛️</span><span>Opcje aplikacji</span></button>
      <button onClick={closeIfMobile(onToggleSettings)} aria-haspopup="dialog" className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm text-slate-400 hover:text-white">{icon(ustawieniaIcon, '⚙️')}<span>Ustawienia</span><span className="ml-auto">↗</span></button>
    </div>
  </aside>
  </>;
}
