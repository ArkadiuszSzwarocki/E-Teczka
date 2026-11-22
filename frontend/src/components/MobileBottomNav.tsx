type Props = {
  activeView: string;
  onViewChange: (view: string) => void;
  onOpenScanner: () => void;
};

/** Fixed bottom navigation bar for Android and mobile screens below the lg breakpoint. */
export default function MobileBottomNav({ activeView, onViewChange, onOpenScanner }: Props) {
  const itemClass = (active: boolean) =>
    `flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-semibold transition-colors ${
      active ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-400 active:bg-slate-800 hover:text-white'
    }`;

  return (
    <nav
      aria-label="Nawigacja mobilna"
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-slate-700 bg-[#111827]/95 px-2 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur lg:hidden"
    >
      <button type="button" onClick={() => onViewChange('analytics')} className={itemClass(activeView === 'analytics')}>
        <span aria-hidden="true" className="text-base leading-none">📊</span>
        <span className="truncate">Analizy</span>
      </button>
      <button type="button" onClick={() => onViewChange('dashboard')} className={itemClass(activeView === 'dashboard' || activeView === 'folder')}>
        <span aria-hidden="true" className="text-base leading-none">📁</span>
        <span className="truncate">Kartoteki</span>
      </button>
      <button type="button" onClick={() => onViewChange('upload')} className={itemClass(activeView === 'upload')}>
        <span aria-hidden="true" className="text-base leading-none">⬆️</span>
        <span className="truncate">Dodaj</span>
      </button>
      <button type="button" onClick={onOpenScanner} className={itemClass(activeView === 'scanner')}>
        <span aria-hidden="true" className="text-base leading-none">📷</span>
        <span className="truncate">Aparat</span>
      </button>
      <button type="button" onClick={() => onViewChange('mail-inbox')} className={itemClass(activeView === 'mail-inbox')}>
        <span aria-hidden="true" className="text-base leading-none">📧</span>
        <span className="truncate">Poczta</span>
      </button>
    </nav>
  );
}
