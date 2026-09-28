import type { DocumentRecord } from '../types/domain';

type Props = {
  activeView: string;
  documents: DocumentRecord[];
  isSettingsMenuOpen: boolean;
  onViewChange: (view: string) => void;
  onOpenScanner: () => void;
  onToggleSettings: () => void;
  onOpenPairing: () => void;
  onOpenAccessSettings: () => void;
  onOpenTags: () => void;
};

/** Persistent desktop navigation. Kept independent from document-table rendering. */
export default function DesktopSidebar({
  activeView, documents, isSettingsMenuOpen, onViewChange, onOpenScanner,
  onToggleSettings, onOpenPairing, onOpenAccessSettings, onOpenTags,
}: Props) {
  const navClass = (view: string) => `w-full px-2 py-2 text-left flex items-center gap-2 rounded transition-colors ${activeView === view ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`;
  return <aside className="z-10 flex w-72 flex-col border-r border-slate-700 bg-[#1f2937] shadow-xl">
    <div className="flex h-16 items-center gap-3 border-b border-slate-700 bg-[#111827]/50 px-4">
      <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-600 font-bold text-white shadow-lg">E</div>
      <h1 className="text-lg font-bold tracking-wide text-white">E-TECZKA</h1>
    </div>
    <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
      <p className="mb-3 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Dokumenty</p>
      <div className="space-y-1 text-sm">
        <button onClick={() => onViewChange('dashboard')} className={navClass('dashboard')}>📁 Kartoteki</button>
        <button onClick={() => onViewChange('upload')} className={navClass('upload')}>⬆️ Dodaj dokument</button>
        <button onClick={onOpenScanner} className="w-full rounded px-2 py-2 text-left text-slate-400 hover:bg-white/5 hover:text-white">🖨️ Skanuj z drukarki</button>
      </div>
      <p className="mb-3 mt-7 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Zapisane</p>
      <div className="space-y-1 text-sm">
        <button onClick={() => onViewChange('archive')} className={`w-full px-2 py-2 text-left flex items-center justify-between rounded transition-colors ${activeView === 'archive' ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}><span>📦 Archiwum</span><span className="text-xs">{documents.filter((doc) => doc.isArchived && !doc.isDeleted).length}</span></button>
        <button onClick={() => onViewChange('trash')} className={`w-full px-2 py-2 text-left flex items-center justify-between rounded transition-colors ${activeView === 'trash' ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}><span>🗑️ Kosz</span><span className="text-xs">{documents.filter((doc) => doc.isDeleted).length}</span></button>
      </div>
    </div>
    <div className="border-t border-slate-700 p-4">
      <button onClick={onToggleSettings} className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm text-slate-400 hover:text-white">⚙️ Ustawienia <span className="ml-auto">{isSettingsMenuOpen ? '⌃' : '›'}</span></button>
      {isSettingsMenuOpen && <div className="ml-3 mt-2 space-y-1 text-sm">
        <button onClick={onOpenPairing} className="w-full px-2 py-2 text-left text-slate-400 hover:text-white">📱 Połącz telefon</button>
        <button onClick={onOpenAccessSettings} className="w-full px-2 py-2 text-left text-slate-400 hover:text-white">🔐 Zabezpieczenia</button>
        <button onClick={onOpenTags} className="w-full px-2 py-2 text-left text-slate-400 hover:text-white">🏷️ Tagi dokumentów</button>
        <button onClick={() => window.location.reload()} className="w-full px-2 py-2 text-left text-slate-400 hover:text-white">⇥ Zablokuj aplikację</button>
      </div>}
    </div>
  </aside>;
}
