import type { ReactNode } from 'react';

export type MailToolTab = 'sync' | 'accounts' | 'senders' | 'watch';

type Props = {
  activeTab: MailToolTab | null;
  onSelectTab: (tab: MailToolTab | null) => void;
  syncing?: boolean;
  accountsCount: number;
  sendersCount: number;
  watchCount: number;
  watchActive: boolean;
  children: ReactNode;
};

const TAB_META: Array<{ id: MailToolTab; icon: string; label: string }> = [
  { id: 'sync', icon: '🔄', label: 'Pobieranie' },
  { id: 'accounts', icon: '📬', label: 'Skrzynki' },
  { id: 'senders', icon: '👥', label: 'Nadawcy i reguły' },
  { id: 'watch', icon: '📂', label: 'Folder obserwowany' },
];

/** Floating left-edge side tabs + slide-out drawer for Sync, Mailboxes, Senders, and Watched Folder. */
export function MailToolsSideDrawer({
  activeTab, onSelectTab, syncing = false, accountsCount, sendersCount, watchCount, watchActive, children,
}: Props) {
  const badgeFor = (id: MailToolTab) => {
    if (id === 'sync') return syncing ? '•••' : null;
    if (id === 'accounts') return accountsCount > 0 ? String(accountsCount) : null;
    if (id === 'senders') return sendersCount > 0 ? String(sendersCount) : null;
    if (watchCount > 0) return String(watchCount);
    return watchActive ? '✓' : null;
  };

  const activeTitle = TAB_META.find(t => t.id === activeTab)?.label || 'Narzędzia poczty';

  return (
    <>
      <div className="fixed left-0 top-[42vh] z-[105] flex -translate-y-1/2 flex-col items-start gap-1.5 lg:left-64 xl:left-72">
        {TAB_META.map(tab => {
          const isActive = activeTab === tab.id;
          const badge = badgeFor(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(isActive ? null : tab.id)}
              aria-label={tab.label}
              aria-expanded={isActive}
              title={tab.label}
              className={`flex items-center gap-1.5 rounded-r-xl border border-l-0 px-2.5 py-2.5 text-xs font-semibold shadow-2xl backdrop-blur transition ${
                isActive
                  ? 'border-cyan-400 bg-cyan-950/95 text-cyan-100'
                  : 'border-slate-600 bg-[#1e293b]/95 text-slate-200 hover:bg-slate-700'
              }`}
            >
              <span className="text-base leading-none">{tab.icon}</span>
              {badge && (
                <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${
                  tab.id === 'watch' && watchCount > 0
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-cyan-500/25 text-cyan-200'
                }`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <aside
        aria-label={activeTitle}
        className={`fixed left-0 top-16 bottom-4 z-[110] flex w-[480px] max-w-[94vw] flex-col rounded-r-2xl border border-l-0 border-slate-600 bg-[#0f172a]/95 p-4 text-slate-200 shadow-2xl backdrop-blur transition-all duration-200 lg:left-64 xl:left-72 ${
          activeTab ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-6 opacity-0'
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-700 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {TAB_META.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  activeTab === tab.id
                    ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/50'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onSelectTab(null)}
            aria-label="Zamknij panel"
            className="shrink-0 rounded px-2 py-0.5 text-lg text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto pr-1">
          {children}
        </div>
      </aside>
    </>
  );
}
