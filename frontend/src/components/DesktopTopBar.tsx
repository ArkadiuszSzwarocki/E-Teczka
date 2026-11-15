import DevPlanSwitch from './DevPlanSwitch';
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
  searchQuery: string;
  localAddress: string;
  pairingCode: string;
  phoneConnected: boolean;
  scannerFileCount: number;
  retentionAlerts: AlertItem[];
  notificationsOpen: boolean;
  userMenuOpen: boolean;
  currentUser: { email: string; name?: string | null } | null;
  billingPlan: 'free' | 'standard' | 'premium';
  billingIsDev: boolean;
  onDevPlanChanged: () => void;
  apiUrl: string;
  apiFetcher: typeof fetch;
  billingDetails: BillingDetails | null;
  billingDetailsBusy: boolean;
  billingBusy: boolean;
  billingCancelBusy: boolean;
  onSearchChange: (value: string) => void;
  onBack: () => void;
  onToggleNotifications: () => void;
  onOpenScannerInbox: () => void;
  onOpenNotification: (documentId: number) => void;
  onToggleUserMenu: () => void;
  onOpenBillingPlans: () => void;
  onRequestCancelBilling: () => void;
  onOpenBillingHistory: () => void;
  onOpenPlanUsage: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onOpenAccessSettings: () => void;
  onOpenSettings: () => void;
  onOpenPairing: () => void;
};

/** Search, connection status, notifications and current-user menu. */
export default function DesktopTopBar({
  activeView, searchQuery, localAddress, pairingCode, phoneConnected, scannerFileCount, retentionAlerts,
  notificationsOpen, userMenuOpen, currentUser, onLogout, onSearchChange, onBack, onToggleNotifications,
  onOpenScannerInbox, onOpenNotification, onToggleUserMenu, onOpenAccessSettings, onOpenSettings,
  billingPlan, billingIsDev, onDevPlanChanged, apiUrl, apiFetcher, billingBusy, billingCancelBusy, onOpenBillingPlans, onRequestCancelBilling, onOpenBillingHistory,
  billingDetails, billingDetailsBusy,
  onOpenPlanUsage,
  onOpenPairing,
}: Props) {
  const notificationCount = retentionAlerts.length + scannerFileCount;
  return <header className="flex h-16 items-center justify-between gap-4 border-b border-slate-700 bg-[#1f2937] px-6">
    <div className="flex min-w-0 items-center gap-3">
      {activeView === 'folder' && <button onClick={onBack} className="shrink-0 rounded-md border border-slate-600 bg-[#111827] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 hover:text-white">← Cofnij</button>}
      <input type="text" placeholder="Szukaj nazwy lub tekstu dokumentu…" title="Wpisz słowo z nazwy lub treści dokumentu po rozpoznaniu OCR" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} className="w-52 rounded-md border border-slate-600 bg-[#111827] px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none lg:w-72" />
      <button onClick={onOpenPairing} title="Pokaż duże okno parowania i kod QR" className="hidden items-center gap-2 rounded-md border border-emerald-700/60 bg-emerald-950/30 px-3 py-1.5 text-left text-xs text-emerald-100 hover:border-emerald-400 md:flex">
        <span>🖥️ Komputer:</span><span className="font-mono font-bold">{localAddress || 'brak sieci'}</span><span className="h-4 border-l border-emerald-700/60" /><span>Kod:</span><span className="font-mono font-bold tracking-[0.16em]">{pairingCode || '—'}</span><span className={`border-l border-emerald-700/60 pl-2 ${phoneConnected ? 'text-emerald-300' : 'text-slate-500'}`}>📱 Telefon {phoneConnected ? '●' : '×'}</span>
      </button>
    </div>
    <div className="flex items-center gap-3">
      {import.meta.env.DEV && <DevPlanSwitch key={`${billingIsDev}:${billingPlan}`} apiUrl={apiUrl} fetcher={apiFetcher} onChanged={onDevPlanChanged} />}
      {import.meta.env.DEV && <button type="button" onClick={() => window.location.reload()} title="Odśwież aplikację deweloperską" className="rounded-md border border-amber-500/60 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10">↻ Odśwież DEV</button>}
      <div className="relative">
        <button onClick={onToggleNotifications} className="relative p-2 text-slate-300 hover:text-white" aria-label="Powiadomienia">🔔{notificationCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-[10px] text-white">{notificationCount}</span>}</button>
        {notificationsOpen && <div className="absolute right-0 top-11 z-50 w-96 rounded-lg border border-slate-600 bg-[#1e293b] p-3 shadow-xl">
          <p className="mb-2 font-bold text-white">Powiadomienia o terminie życia</p>
          {scannerFileCount > 0 && <button onClick={onOpenScannerInbox} className="mb-2 w-full rounded bg-blue-500/10 p-2 text-left text-sm text-blue-300 hover:bg-blue-500/20">Skrzynka skanera: {scannerFileCount} plików.</button>}
          {retentionAlerts.map((alert) => <button key={alert.id} onClick={() => onOpenNotification(alert.id)} className={`mb-1 w-full rounded p-2 text-left text-xs hover:bg-white/10 ${alert.type === 'danger' ? 'text-red-300' : 'text-amber-300'}`}><strong>{alert.title}</strong><br />{alert.text} Kliknij, aby otworzyć dokument.</button>)}
          {retentionAlerts.length === 0 && scannerFileCount === 0 && <p className="text-sm text-slate-500">Brak powiadomień.</p>}
        </div>}
      </div>
      <div className="relative">
        <button onClick={onToggleUserMenu} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 font-bold text-white">{(currentUser?.name || currentUser?.email || "U").charAt(0).toUpperCase()}</span><span className="hidden lg:block">{currentUser?.name || currentUser?.email || "Konto lokalne"}</span><span>⌄</span></button>
        {userMenuOpen && <div className="absolute right-0 top-11 z-50 w-72 rounded-lg border border-slate-600 bg-[#1e293b] p-2 shadow-xl"><div className="border-b border-slate-700 px-3 py-2"><p className="font-semibold text-white">{currentUser?.name || "Konto lokalne"}</p><p className="text-xs text-slate-400">{currentUser?.email || "Bez logowania na konto"}</p><span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${billingPlan !== 'free' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{billingIsDev ? `TEST: ${billingPlan === 'free' ? 'Darmowy' : billingPlan === 'standard' ? 'Standard' : 'Premium'}` : billingPlan === 'premium' ? 'Premium aktywne' : billingPlan === 'standard' ? 'Standard aktywny' : 'Plan darmowy'}</span></div>{billingPlan !== 'free' ? <div className="border-b border-slate-700 px-2 py-2"><p className="px-1 text-xs text-emerald-300">{billingDetails?.cancellationScheduled ? 'Odnowienie wyłączone. Dostęp trwa do wskazanej daty.' : billingPlan === 'premium' ? 'Pełny dostęp do funkcji aplikacji.' : 'Plan Standard jest aktywny.'}</p>{billingDetailsBusy ? <p className="mt-2 px-1 text-xs text-slate-400">Pobieranie szczegółów planu…</p> : billingDetails && <div className="mt-2 rounded border border-emerald-800/50 bg-emerald-950/20 p-2 text-xs text-slate-300"><p><strong>Plan:</strong> {billingDetails.interval === 'year' ? 'roczny' : 'miesięczny'}</p>{typeof billingDetails.amount === 'number' && <p><strong>Cena:</strong> {(billingDetails.amount / 100).toFixed(2)} {billingDetails.currency?.toUpperCase() || 'PLN'}</p>}{billingDetails.renewalAt && <p><strong>{billingDetails.cancellationScheduled ? 'Dostęp do:' : 'Odnowienie:'}</strong> {new Date(billingDetails.renewalAt).toLocaleDateString('pl-PL')}</p>}<p className="mt-1 text-slate-400">{billingDetails.cancellationPolicy}</p></div>}<button disabled={billingBusy} onClick={onOpenBillingPlans} className="mt-2 w-full rounded-lg border border-blue-400 px-2 py-2 text-left text-xs font-semibold text-blue-200 hover:bg-blue-500/10 disabled:opacity-50">Zobacz i wybierz plan</button>{!billingIsDev && !billingDetails?.cancellationScheduled && <button disabled={billingCancelBusy} onClick={onRequestCancelBilling} className="mt-2 w-full rounded px-2 py-2 text-left text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Anuluj subskrypcję</button>}</div> : <div className="space-y-2 border-b border-slate-700 p-2"><p className="text-xs text-slate-400">Odblokuj pełny dostęp.</p><button disabled={billingBusy} onClick={onOpenBillingPlans} className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50">Zobacz plany Premium</button></div>}<button onClick={onOpenPlanUsage} className="mt-1 w-full rounded px-3 py-2 text-left text-sm font-semibold text-blue-200 hover:bg-slate-700">📊 Mój plan i limity</button><button onClick={onOpenBillingHistory} className="mt-1 w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">🧾 Historia transakcji</button><button onClick={onOpenAccessSettings} className="w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">🔐 Zmień PIN lub hasło</button><button onClick={onOpenSettings} className="w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">⚙️ Ustawienia aplikacji</button><button onClick={onLogout} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 5H5v14h4M13 8l4 4-4 4M8 12h13" /></svg>Wyloguj</button></div>}
      </div>
    </div>
  </header>;
}
