import { useState } from 'react';
import SessionCountdown from './SessionCountdown';
import DevPlanSwitch from './DevPlanSwitch';
import { useClassicIcons } from './FolderIconPicker';
import bellIdleIcon from '../assets/sidebar-icons/bell-idle.png';
import bellAlertIcon from '../assets/sidebar-icons/bell-alert.png';
import { devReloadApp } from '../services/electron';
import { getThemePreference, setThemePreference, type ThemePreference } from '../services/theme';
import { useMailSyncProgress } from '../hooks/useMailSync';
type AlertItem = { id: number; title: string; text: string; type: 'warning' | 'danger' };
type BillingDetails = {
  interval?: 'month' | 'year' | null;
  intervalCount?: number;
  amount?: number;
  currency?: string;
  renewalAt?: string | null;
  cancellationPolicy?: string;
  cancellationScheduled?: boolean;
};

type Props = {
  activeView: string;
  scannerFileCount: number;
  retentionAlerts: AlertItem[];
  notificationsOpen: boolean;
  userMenuOpen: boolean;
  currentUser: { email: string; name?: string | null } | null;
  billingPlan: 'free' | 'standard' | 'premium' | 'family' | 'business';
  billingIsDev: boolean;
  onDevPlanChanged: () => void;
  apiUrl: string;
  apiFetcher: typeof fetch;
  billingDetails: BillingDetails | null;
  billingDetailsBusy: boolean;
  billingBusy: boolean;
  billingCancelBusy: boolean;
  onBack: () => void;
  onToggleNotifications: () => void;
  onOpenScannerInbox: () => void;
  onOpenNotification: (documentId: number) => void;
  onToggleUserMenu: () => void;
  onOpenBillingPlans: () => void;
  onRequestCancelBilling: () => void;
  onOpenBillingHistory: () => void;
  onOpenPlanUsage: () => void;
  onOpenFamily: () => void;
  onOpenLegalDocs: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onOpenAccessSettings: () => void;
  onOpenSettings: () => void;
  showNotificationsInTopBar: boolean;
  onToggleNotificationsInTopBar: (inTopBar: boolean) => void;
  onToggleMobileSidebar?: () => void;
  updateAvailable?: boolean;
  onOpenUpdatePrompt?: () => void;
  openBugCount?: number;
  adminReplyCount?: number;
  onOpenDeveloperFeedback?: () => void;
  onOpenDeveloper?: () => void;
  mailSyncing?: boolean;
  mailSyncPaused?: boolean;
  onOpenMailInbox?: () => void;
  onStopMailSync?: () => void;
  onResumeMailSync?: () => void;
};

/** Search, connection status, notifications and current-user menu. */
export default function DesktopTopBar({
  activeView, scannerFileCount, retentionAlerts,
  notificationsOpen, userMenuOpen, currentUser, onLogout, onBack, onToggleNotifications,
  onOpenScannerInbox, onOpenNotification, onToggleUserMenu, onOpenAccessSettings, onOpenSettings,
  billingPlan, billingIsDev, onDevPlanChanged, apiUrl, apiFetcher, billingBusy, billingCancelBusy, onOpenBillingPlans, onRequestCancelBilling, onOpenBillingHistory,
  billingDetails, billingDetailsBusy,
  onOpenPlanUsage,
  onOpenFamily,
  onOpenLegalDocs,
  showNotificationsInTopBar,
  onToggleNotificationsInTopBar,
  onToggleMobileSidebar,
  updateAvailable = false,
  onOpenUpdatePrompt,
  openBugCount = 0,
  adminReplyCount = 0,
  onOpenDeveloperFeedback,
  onOpenDeveloper,
  mailSyncing = false,
  mailSyncPaused = false,
  onOpenMailInbox,
  onStopMailSync,
  onResumeMailSync,
}: Props) {
  const [reloadingDev, setReloadingDev] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const classicIcons = useClassicIcons();
  const mailSyncProgress = useMailSyncProgress(apiUrl, apiFetcher, mailSyncing);
  const notificationCount = retentionAlerts.length + scannerFileCount;
  const changeTheme = (next: ThemePreference) => { setTheme(next); setThemePreference(next); };
  const handleDevReload = async () => {
    setReloadingDev(true);
    try { await devReloadApp(); } finally { setReloadingDev(false); }
  };
  return <header className="cyber-pane relative z-40 flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-[#1f2937] px-3 py-2 sm:gap-4 sm:px-6">
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      {onToggleMobileSidebar && <button type="button" onClick={onToggleMobileSidebar} aria-label="Otwórz menu" className="shrink-0 rounded-md border border-slate-600 bg-[#111827] px-2.5 py-1.5 text-base font-bold text-slate-200 hover:bg-slate-700 hover:text-white lg:hidden">☰</button>}
      {activeView === 'folder' && <button onClick={onBack} className="cyber-btn-secondary shrink-0 whitespace-nowrap rounded-md border border-slate-600 bg-[#111827] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white sm:px-3 sm:py-2 sm:text-sm">← Cofnij</button>}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      {!mailSyncing && mailSyncPaused && (
        <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200">
          <button type="button" onClick={onOpenMailInbox} className="font-semibold hover:text-white">
            ⏸ Skan wstrzymany
          </button>
          {onResumeMailSync && (
            <button type="button" onClick={onResumeMailSync} className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-emerald-500">
              ▶ Wznów
            </button>
          )}
        </div>
      )}
      {(mailSyncing || mailSyncProgress?.active) && (() => {
        const isDownloading = mailSyncProgress?.phase === 'downloading';
        const current = isDownloading ? (mailSyncProgress?.processedCandidates ?? 0) : (mailSyncProgress?.scannedMessages ?? 0);
        const total = isDownloading ? (mailSyncProgress?.candidateMessages ?? 0) : (mailSyncProgress?.totalMessages ?? 0);
        const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 20;
        return (
          <div className="flex items-center gap-1 rounded-lg border border-cyan-500/50 bg-cyan-950/50 px-2.5 py-1 text-xs text-cyan-200">
            <button
              type="button"
              onClick={onOpenMailInbox}
              title={mailSyncProgress?.message || 'Kliknij, aby przejść do Poczty'}
              className="flex items-center gap-2 text-left hover:text-white"
            >
              <span className="font-semibold">
                {isDownloading ? '⬇️ Załączniki' : '🔍 Skan maili'}
                {total > 0 ? `: ${current}/${total}` : '…'}
              </span>
              <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-800 sm:inline-block">
                <span className="block h-full rounded-full bg-cyan-400 transition-all duration-300" style={{ width: `${pct}%` }} />
              </span>
            </button>
            {onStopMailSync && (
              <button
                type="button"
                onClick={onStopMailSync}
                title="Zatrzymaj skanowanie poczty"
                className="ml-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[11px] font-bold text-rose-200 hover:bg-rose-500/40"
              >
                ⏸
              </button>
            )}
          </div>
        );
      })()}
      <SessionCountdown/>
      <div className="hidden xl:block">
        <DevPlanSwitch key={`${billingIsDev}:${billingPlan}`} apiUrl={apiUrl} fetcher={apiFetcher} onChanged={onDevPlanChanged} onOpenDeveloper={onOpenDeveloper} />
      </div>
      {import.meta.env.DEV && onOpenDeveloperFeedback && (
        <button
          type="button"
          onClick={onOpenDeveloperFeedback}
          title={`Zgłoszenia błędów (otwarte: ${openBugCount}, odpowiedzi użytkowników: ${adminReplyCount})`}
          aria-label={`Zgłoszenia błędów: ${openBugCount}, odpowiedzi użytkowników: ${adminReplyCount}`}
          className="relative flex items-center justify-center rounded-md border border-slate-600 bg-[#111827] px-2.5 py-1.5 text-base hover:bg-slate-700"
        >
          <span aria-hidden="true">🐛</span>
          <span className={`ml-1.5 min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${openBugCount > 0 ? 'bg-red-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
            {openBugCount}
          </span>
          {adminReplyCount > 0 && (
            <span className="ml-1 rounded-full bg-amber-400 px-1.5 py-0.5 text-center text-[10px] font-bold text-slate-950">
              💬 {adminReplyCount}
            </span>
          )}
        </button>
      )}
      {updateAvailable && onOpenUpdatePrompt && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-950/40 px-2.5 py-1">
          <span className="whitespace-nowrap text-xs font-semibold text-emerald-200">Nowa aktualizacja</span>
          <button
            type="button"
            onClick={onOpenUpdatePrompt}
            title="Dostępna jest nowa wersja aplikacji — kliknij, aby zaktualizować lub wybrać czas"
            className="whitespace-nowrap rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-emerald-400"
          >
            🔄 Aktualizuj
          </button>
        </div>
      )}
      {import.meta.env.DEV && <button type="button" disabled={reloadingDev} onClick={handleDevReload} title="Zrestartuj backend i odśwież aplikację deweloperską" className="whitespace-nowrap rounded-md border border-amber-500/60 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/10 disabled:opacity-50 sm:px-3 sm:py-2 sm:text-sm">{reloadingDev ? '↻ Odświeżanie…' : '↻ Odśwież DEV'}</button>}
      {showNotificationsInTopBar && (
        <div className="relative">
          <button onClick={onToggleNotifications} className="relative flex items-center justify-center p-1.5 text-slate-300 hover:text-white" aria-label="Powiadomienia">
            {classicIcons ? '🔔' : <img src={notificationCount > 0 ? bellAlertIcon : bellIdleIcon} alt="" aria-hidden="true" className="cyber-icon-glow h-6 w-6 object-contain" />}
            {notificationCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{notificationCount}</span>}
          </button>
          {notificationsOpen && <div className="absolute right-0 top-11 z-[110] w-96 rounded-lg border border-slate-600 bg-[#1e293b] p-3 shadow-xl">
            <p className="mb-2 font-bold text-white">Powiadomienia o terminie życia</p>
            {scannerFileCount > 0 && <button onClick={onOpenScannerInbox} className="mb-2 w-full rounded bg-blue-500/10 p-2 text-left text-sm text-blue-300 hover:bg-blue-500/20">Skrzynka skanera: {scannerFileCount} plików.</button>}
            {retentionAlerts.map((alert) => <button key={alert.id} onClick={() => onOpenNotification(alert.id)} className={`mb-1 w-full rounded p-2 text-left text-xs hover:bg-white/10 ${alert.type === 'danger' ? 'text-red-300' : 'text-amber-300'}`}><strong>{alert.title}</strong><br />{alert.text} Kliknij, aby otworzyć dokument.</button>)}
            {retentionAlerts.length === 0 && scannerFileCount === 0 && <p className="text-sm text-slate-500">Brak powiadomień.</p>}
            <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-slate-700 pt-2 text-xs text-slate-300">
              <input type="checkbox" checked={showNotificationsInTopBar} onChange={e => onToggleNotificationsInTopBar(e.target.checked)} className="h-4 w-4 accent-blue-500" />
              <span>Pokazuj powiadomienia w górnym pasku (standardowo)</span>
            </label>
          </div>}
        </div>
      )}
      <div className="relative">
        <button onClick={onToggleUserMenu} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 font-bold text-white">{(currentUser?.name || currentUser?.email || "U").charAt(0).toUpperCase()}</span><span className="hidden lg:block">{currentUser?.name || currentUser?.email || "Konto lokalne"}</span><span>⌄</span></button>
        {userMenuOpen && <div className="absolute right-0 top-11 z-[110] w-72 rounded-lg border border-slate-600 bg-[#1e293b] p-2 shadow-xl"><div className="border-b border-slate-700 px-3 py-2"><p className="font-semibold text-white">{currentUser?.name || "Konto lokalne"}</p><p className="text-xs text-slate-400">{currentUser?.email || "Bez logowania na konto"}</p><span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${billingPlan !== 'free' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{billingIsDev ? `TEST: ${billingPlan === 'free' ? 'Darmowy' : billingPlan === 'standard' ? 'Standard' : 'Premium'}` : billingPlan === 'premium' ? 'Premium aktywne' : billingPlan === 'standard' ? 'Standard aktywny' : 'Plan darmowy'}</span></div><div className="border-b border-slate-700 px-2 py-2"><p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Motyw aplikacji</p><div className="grid grid-cols-3 gap-1">{([['dark', '🌙 Ciemny'], ['light', '☀️ Jasny'], ['system', '💻 System']] as const).map(([mode, label]) => <button key={mode} type="button" onClick={() => changeTheme(mode)} className={`rounded px-2 py-1.5 text-xs font-semibold transition ${theme === mode ? 'bg-blue-600 text-white' : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700'}`}>{label}</button>)}</div></div>{billingPlan !== 'free' ? <div className="border-b border-slate-700 px-2 py-2"><p className="px-1 text-xs text-emerald-300">{billingDetails?.cancellationScheduled ? 'Odnowienie wyłączone. Dostęp trwa do wskazanej daty.' : billingPlan === 'premium' ? 'Pełny dostęp do funkcji aplikacji.' : 'Plan Standard jest aktywny.'}</p>{billingDetailsBusy ? <p className="mt-2 px-1 text-xs text-slate-400">Pobieranie szczegółów planu…</p> : billingDetails && <div className="mt-2 rounded border border-emerald-800/50 bg-emerald-950/20 p-2 text-xs text-slate-300"><p><strong>Plan:</strong> {billingDetails.interval === 'year' ? 'roczny' : 'miesięczny'}</p>{typeof billingDetails.amount === 'number' && <p><strong>Cena:</strong> {(billingDetails.amount / 100).toFixed(2)} {billingDetails.currency?.toUpperCase() || 'PLN'}</p>}{billingDetails.renewalAt && <p><strong>{billingDetails.cancellationScheduled ? 'Dostęp do:' : 'Odnowienie:'}</strong> {new Date(billingDetails.renewalAt).toLocaleDateString('pl-PL')}</p>}<p className="mt-1 text-slate-400">{billingDetails.cancellationPolicy}</p></div>}<button disabled={billingBusy} onClick={onOpenBillingPlans} className="mt-2 w-full rounded-lg border border-blue-400 px-2 py-2 text-left text-xs font-semibold text-blue-200 hover:bg-blue-500/10 disabled:opacity-50">Zobacz i wybierz plan</button>{!billingIsDev && !billingDetails?.cancellationScheduled && <button disabled={billingCancelBusy} onClick={onRequestCancelBilling} className="mt-2 w-full rounded px-2 py-2 text-left text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Anuluj subskrypcję</button>}</div> : <div className="space-y-2 border-b border-slate-700 p-2"><p className="text-xs text-slate-400">Odblokuj pełny dostęp.</p><button disabled={billingBusy} onClick={onOpenBillingPlans} className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50">Zobacz plany Premium</button></div>}<button onClick={onOpenPlanUsage} className="mt-1 w-full rounded px-3 py-2 text-left text-sm font-semibold text-blue-200 hover:bg-slate-700">📊 Mój plan i limity</button><button onClick={onOpenFamily} className="w-full rounded px-3 py-2 text-left text-sm font-semibold text-emerald-200 hover:bg-slate-700">👨‍👩‍👧‍👦 Rodzina i zaproszenia</button><button onClick={onOpenBillingHistory} className="mt-1 w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">🧾 Historia transakcji</button><button onClick={onOpenAccessSettings} className="w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">🔐 Zmień PIN lub hasło</button><button onClick={onOpenSettings} className="w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">⚙️ Ustawienia aplikacji</button><button onClick={onOpenLegalDocs} className="w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">📜 Polityka, regulamin i bazy</button><button onClick={onLogout} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 5H5v14h4M13 8l4 4-4 4M8 12h13" /></svg>Wyloguj</button></div>}
      </div>
    </div>
  </header>;
}
