type AlertItem = { id: number; title: string; text: string; type: 'warning' | 'danger' };
type BillingDetails = {
  interval?: 'month' | 'year' | null;
  intervalCount?: number;
  amount?: number;
  currency?: string;
  renewalAt?: string | null;
  cancellationPolicy?: string;
};

type Props = {
  activeView: string;
  searchQuery: string;
  localAddress: string;
  pairingCode: string;
  scannerFileCount: number;
  retentionAlerts: AlertItem[];
  notificationsOpen: boolean;
  userMenuOpen: boolean;
  billingPlan: 'free' | 'premium';
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
  onOpenAuth: () => void;
  onOpenAccessSettings: () => void;
  onOpenSettings: () => void;
};

/** Search, connection status, notifications and current-user menu. */
export default function DesktopTopBar({
  activeView, searchQuery, localAddress, pairingCode, scannerFileCount, retentionAlerts,
  notificationsOpen, userMenuOpen, onSearchChange, onBack, onToggleNotifications,
  onOpenScannerInbox, onOpenNotification, onToggleUserMenu, onOpenAccessSettings, onOpenSettings,
  billingPlan, billingBusy, billingCancelBusy, onOpenBillingPlans, onRequestCancelBilling, onOpenBillingHistory,
  billingDetails, billingDetailsBusy,
  onOpenAuth,
}: Props) {
  const notificationCount = retentionAlerts.length + scannerFileCount;
  return <header className="flex h-16 items-center justify-between gap-4 border-b border-slate-700 bg-[#1f2937] px-6">
    <div className="flex min-w-0 items-center gap-3">
      {activeView === 'folder' && <button onClick={onBack} className="shrink-0 rounded-md border border-slate-600 bg-[#111827] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 hover:text-white">← Cofnij</button>}
      <input type="text" placeholder="Szukaj dokumentów…" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} className="w-52 rounded-md border border-slate-600 bg-[#111827] px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none lg:w-72" />
      <div className="hidden items-center gap-2 rounded-md border border-emerald-700/60 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-100 md:flex">
        <span>📱 Adres:</span><span className="font-mono font-bold">{localAddress || 'brak sieci'}</span><span className="h-4 border-l border-emerald-700/60" /><span>Kod:</span><span className="font-mono font-bold tracking-[0.16em]">{pairingCode || '—'}</span>
      </div>
    </div>
    <div className="flex items-center gap-3">
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
        <button onClick={onToggleUserMenu} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 font-bold text-white">A</span><span className="hidden lg:block">Arkadiusz</span><span>⌄</span></button>
        {userMenuOpen && <div className="absolute right-0 top-11 z-50 w-72 rounded-lg border border-slate-600 bg-[#1e293b] p-2 shadow-xl"><div className="border-b border-slate-700 px-3 py-2"><p className="font-semibold text-white">Arkadiusz Szwarocki</p><p className="text-xs text-slate-400">Arkadiusz.szwarocki@wp.pl</p><span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${billingPlan === 'premium' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{billingPlan === 'premium' ? 'Premium aktywne' : 'Plan darmowy'}</span></div>{billingPlan === 'premium' ? <div className="border-b border-slate-700 px-2 py-2"><p className="px-1 text-xs text-emerald-300">Pełny dostęp do funkcji aplikacji.</p>{billingDetailsBusy ? <p className="mt-2 px-1 text-xs text-slate-400">Pobieranie szczegółów planu…</p> : billingDetails && <div className="mt-2 rounded border border-emerald-800/50 bg-emerald-950/20 p-2 text-xs text-slate-300"><p><strong>Plan:</strong> {billingDetails.interval === 'year' ? 'roczny' : 'miesięczny'}</p>{typeof billingDetails.amount === 'number' && <p><strong>Cena:</strong> {(billingDetails.amount / 100).toFixed(2)} {billingDetails.currency?.toUpperCase() || 'PLN'}</p>}{billingDetails.renewalAt && <p><strong>Odnowienie:</strong> {new Date(billingDetails.renewalAt).toLocaleDateString('pl-PL')}</p>}<p className="mt-1 text-slate-400">{billingDetails.cancellationPolicy}</p></div>}<button disabled={billingCancelBusy} onClick={onRequestCancelBilling} className="mt-2 w-full rounded px-2 py-2 text-left text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Anuluj Premium i rozlicz zwrot</button></div> : <div className="space-y-2 border-b border-slate-700 p-2"><p className="text-xs text-slate-400">Odblokuj pełny dostęp.</p><button disabled={billingBusy} onClick={onOpenBillingPlans} className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50">Zobacz plany Premium</button></div>}<button onClick={onOpenBillingHistory} className="mt-1 w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">🧾 Historia transakcji</button><button onClick={onOpenAuth} className="w-full rounded px-3 py-2 text-left text-sm text-blue-300 hover:bg-slate-700">👤 Zaloguj / utwórz konto</button><button onClick={onOpenAccessSettings} className="w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">🔐 Zmień PIN lub hasło</button><button onClick={onOpenSettings} className="w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">⚙️ Ustawienia aplikacji</button><button onClick={() => window.location.reload()} className="w-full rounded px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700">⇥ Zablokuj aplikację</button></div>}
      </div>
    </div>
  </header>;
}
