import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import PrinterScannerModal, { type InboxScan } from './components/PrinterScannerModal';
import DesktopSidebar from './components/DesktopSidebar';
import DesktopTopBar from './components/DesktopTopBar';
import PromotionBanner from './components/PromotionBanner';
import type { LegalDocId } from './components/LegalDocsModal';
import SettingsDialog from './components/SettingsDialog';
import AppOptionsPage from './components/AppOptionsPage';
import MailInboxView from './components/MailInboxView';
import KsefSyncPanel from './components/KsefSyncPanel';
import ExpiryCalendarView from './components/ExpiryCalendarView';
import CommandPaletteModal from './components/CommandPaletteModal';
import IdCardCopyModal from './components/IdCardCopyModal';
import { getAutoMailSyncEnabled } from './services/sensitiveMasking';
import { useMailSync } from './hooks/useMailSync';
import BackupModal, { type BackupSection } from './components/BackupModal';
import DeveloperPanel, { type DevSection } from './components/DeveloperPanel';
import BackupSecurityModal from './components/BackupSecurityModal';
import SideNotificationsDrawer from './components/SideNotificationsDrawer';
import UploadPanel from './components/UploadPanel';
import EReceiptImportModal from './components/EReceiptImportModal';
import MobileBottomNav from './components/MobileBottomNav';
import { MainScrollIndicator } from './components/ScrollFadeContainer';
import { BulkSelectionBar } from './components/app/BulkSelectionBar';
import { DocumentsWorkspaceSection } from './components/app/DocumentsWorkspaceSection';
import { AppDocumentModals } from './components/app/AppDocumentModals';
import { AppAccountModals } from './components/app/AppAccountModals';
import { useWiaScanner } from './hooks/useWiaScanner';
import { usePairingStatus } from './hooks/usePairingStatus';
import { useBillingFlow } from './hooks/useBillingFlow';
import { useBatchUpload } from './hooks/useBatchUpload';
import { useAppSession } from './hooks/useAppSession';
import { useTesterConsent } from './hooks/useTesterConsent';
import { useAppUpdateCheck } from './hooks/useAppUpdateCheck';
import { useFeedbackNotifications } from './hooks/useFeedbackNotifications';
import { useHoverPreview } from './hooks/useHoverPreview';
import { useRealtimeEvents } from './hooks/useRealtimeEvents';
import { createLocalTesterFetcher, isLocalTesterFetcher, LOCAL_TESTER_FETCH_FLAG } from './services/localTesterStore';
import { useDocumentAndFolderActions } from './hooks/useDocumentAndFolderActions';
import { createApiFetch } from './services/apiFetch';
import { resolveApiBase } from './services/apiBase';
import { getElectronIpc } from './services/electron';
import { getBillingStatus, type BillingPlan } from './services/billing';
import { getRetentionAlerts } from './services/retentionAlerts';
import { buildFolderOptions } from './utils/folderTree';
import type { DocumentRecord, FolderRecord, Tag } from './types/domain';

const API_URL = resolveApiBase(window.location, import.meta.env.VITE_API_URL);
const apiFetch = createApiFetch(API_URL);

export default function App() {
  const fetchRef = useRef<typeof apiFetch>(apiFetch);
  const fetch: typeof apiFetch = useCallback((input, init) => fetchRef.current(input, init), []);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [foldersUnavailable, setFoldersUnavailable] = useState(false);
  const [scannerFiles, setScannerFiles] = useState<InboxScan[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeView, setActiveView] = useState('dashboard');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [ocrDocumentId, setOcrDocumentId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentRecord | null>(null);
  const [propertiesDoc, setPropertiesDoc] = useState<DocumentRecord | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [selectedDocs, setSelectedDocs] = useState<number[]>([]);
  const [documentMenuId, setDocumentMenuId] = useState<number | null>(null);
  const [renamingDocId, setRenamingDocId] = useState<number | null>(null);
  const [renamingDocTitle, setRenamingDocTitle] = useState('');
  const [moveModalDocId, setMoveModalDocId] = useState<number | null>(null);
  const [isBulkMoveOpen, setIsBulkMoveOpen] = useState(false);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isBillingPlansOpen, setIsBillingPlansOpen] = useState(false);
  const [isPlanUsageOpen, setIsPlanUsageOpen] = useState(false);
  const [isFamilyOpen, setIsFamilyOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [legalDocTab, setLegalDocTab] = useState<LegalDocId | null>(null);
  const [backupSection, setBackupSection] = useState<BackupSection | null>(null);
  const [secureShareId, setSecureShareId] = useState<number | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationsInTopBar, setNotificationsInTopBar] = useState(() => localStorage.getItem('mojateczka_notifications_topbar') === 'true');
  const setNotificationsDockMode = useCallback((inTopBar: boolean) => {
    localStorage.setItem('mojateczka_notifications_topbar', String(inTopBar));
    setNotificationsInTopBar(inTopBar);
    setIsNotificationsOpen(false);
  }, []);
  const [isAccessSettingsOpen, setIsAccessSettingsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [devSection, setDevSection] = useState<DevSection | null>(null);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isBackupSecurityOpen, setIsBackupSecurityOpen] = useState(false);
  const [isSelfHostGuideOpen, setIsSelfHostGuideOpen] = useState(false);
  const [isEReceiptImportOpen, setIsEReceiptImportOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isIdCardCopyOpen, setIsIdCardCopyOpen] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState<{ screenshot: string | null; appVersion?: string; platform?: string } | null>(null);
  const [mailAutoPromptCount, setMailAutoPromptCount] = useState(0);
  const [devPlanNonce, setDevPlanNonce] = useState(0);
  const syncBillingRef = useRef<(plan: BillingPlan, isDev: boolean) => void>(() => { });
  const displayedDocsRef = useRef<DocumentRecord[]>([]);
  const testerBlockedRef = useRef(false);
  const autoMailCheckedRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const feedback = useFeedbackNotifications(API_URL, apiFetch);
  const hover = useHoverPreview();

  useEffect(() => {
    const close = () => setDocumentMenuId(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const showToast = useCallback((message: string, type = 'success', durationMs = 3500) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      toastTimeoutRef.current = null;
      setToast(null);
    }, durationMs);
  }, []);

  const mailSync = useMailSync({
    apiUrl: API_URL,
    fetcher: apiFetch,
    showToast,
    onSyncCompleted: (_added, totalItems) => {
      if (totalItems > 0) setMailAutoPromptCount(totalItems);
    },
  });

  useEffect(() => {
    if (autoMailCheckedRef.current || !getAutoMailSyncEnabled()) return;
    autoMailCheckedRef.current = true;
    void (async () => {
      try {
        const accRes = await apiFetch(`${API_URL}/api/mail-inbox/accounts`);
        if (!accRes.ok) return;
        const accData = await accRes.json() as { accounts?: unknown[] };
        if (Array.isArray(accData.accounts) && accData.accounts.length > 0) {
          await mailSync.startMailSync(undefined, 'incremental');
        }
      } catch { /* ignore startup background mail check errors */ }
    })();
  }, [mailSync]);

  const fetchData = useCallback(async () => {
    if (testerBlockedRef.current) return;
    const sessionAtStart = localStorage.getItem('mojateczka_auth_token');
    try {
      const fetchList = async (path: string): Promise<unknown[] | null> => {
        try {
          const response = await fetch(`${API_URL}${path}`);
          const payload: unknown = await response.json();
          return response.ok && Array.isArray(payload) ? payload : null;
        } catch {
          return null;
        }
      };
      const [resDocs, resFolders, resScanner, resTags, resBilling] = await Promise.all([
        fetchList('/api/documents'),
        fetchList('/api/folders'),
        fetchList('/api/scanner'),
        fetchList('/api/tags'),
        getBillingStatus(API_URL, fetch).catch(() => null),
      ]);
      if (localStorage.getItem('mojateczka_auth_token') !== sessionAtStart) return;
      if (resDocs) setDocuments(resDocs as DocumentRecord[]);
      if (resFolders) setFolders(resFolders as FolderRecord[]);
      setFoldersUnavailable(resFolders === null);
      if (resScanner) setScannerFiles(resScanner as InboxScan[]);
      if (resTags) setTags(resTags as Tag[]);
      if (resBilling) {
        const validPlans: BillingPlan[] = ['free', 'standard', 'premium', 'family', 'business'];
        const plan: BillingPlan = validPlans.includes(resBilling.plan as BillingPlan) ? (resBilling.plan as BillingPlan) : 'free';
        syncBillingRef.current(plan, Boolean(resBilling.developmentOverride));
      }
    } catch { /* ignore */ }
  }, []);

  const resetWorkspace = useCallback(() => {
    setDocuments([]);
    setFolders([]);
    setTags([]);
    setScannerFiles([]);
    setSelectedDocs([]);
    setPreviewDoc(null);
    setSelectedFolderId(null);
    setActiveView('dashboard');
  }, []);

  const session = useAppSession({ apiUrl: API_URL, fetcher: apiFetch, fetchData, onResetWorkspace: resetWorkspace, showToast });
  const testerConsent = useTesterConsent(API_URL, apiFetch, session.currentUser?.email ?? null);
  const appUpdate = useAppUpdateCheck(API_URL);
  const isLocalTesterMode = !getElectronIpc();
  const effectiveFetch = useMemo(
    () => (isLocalTesterMode && session.currentUser?.email ? createLocalTesterFetcher(session.currentUser.email, apiFetch) : apiFetch),
    [isLocalTesterMode, session.currentUser?.email],
  );
  fetchRef.current = effectiveFetch;
  (fetch as typeof apiFetch & { [LOCAL_TESTER_FETCH_FLAG]?: boolean })[LOCAL_TESTER_FETCH_FLAG] = isLocalTesterFetcher(effectiveFetch);
  testerBlockedRef.current = Boolean(session.currentUser && (testerConsent.checking || testerConsent.needsConsent || testerConsent.diskReconnect.needed));

  useEffect(() => {
    if (session.currentUser && !testerConsent.checking && !testerConsent.needsConsent && !testerConsent.diskReconnect.needed) {
      void fetchData();
    }
  }, [session.currentUser, testerConsent.checking, testerConsent.needsConsent, testerConsent.diskReconnect.needed, isLocalTesterMode, fetchData]);

  useRealtimeEvents({
    apiUrl: API_URL,
    enabled: Boolean(session.currentUser && !testerConsent.checking && !testerConsent.needsConsent && !testerConsent.diskReconnect.needed),
    onRefresh: fetchData,
    onToast: showToast,
  });

  const closeUserMenu = useCallback(() => session.setIsUserMenuOpen(false), [session]);
  const billing = useBillingFlow({ apiUrl: API_URL, fetcher: fetch, fetchData, showToast, closeUserMenu });
  syncBillingRef.current = (plan, isDev) => {
    billing.setBillingPlan(plan);
    billing.setBillingIsDev(isDev);
  };

  const pairing = usePairingStatus(API_URL, fetch);
  const scanner = useWiaScanner({ apiUrl: API_URL, fetcher: fetch, activeView, setActiveView, setScannerFiles, fetchData, showToast });
  const batchUpload = useBatchUpload({
    apiUrl: API_URL, fetcher: effectiveFetch, activeView, setActiveView, selectedFolderId,
    folders, foldersUnavailable, billingPlan: billing.billingPlan, documentsCount: documents.length, fetchData, showToast,
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(v => !v);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const items = e.clipboardData?.files;
      if (!items || items.length === 0) return;
      const accepted = Array.from(items).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
      if (accepted.length === 0) return;
      e.preventDefault();
      batchUpload.setFilesToUpload(prev => [
        ...prev,
        ...accepted.map(file => ({ file, enabled: false, value: 5, unit: 'years' as const })),
      ]);
      setActiveView('upload');
      showToast(`📋 Wklejono ze schowka (${accepted.length} plik) — wybierz kartotekę i zapisz.`, 'success');
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [batchUpload, showToast]);
  const actions = useDocumentAndFolderActions({
    apiUrl: API_URL, fetcher: fetch, activeView, setActiveView, setSelectedFolderId,
    selectedDocs, setSelectedDocs, displayedDocs: () => displayedDocsRef.current, billingPlan: billing.billingPlan,
    setPlanLimitMessage: billing.setPlanLimitMessage, searchQuery, fetchData, showToast,
  });

  const displayedDocs = documents.filter(doc => {
    if (activeView === 'trash') return doc.isDeleted;
    if (activeView === 'archive') return doc.isArchived && !doc.isDeleted;
    const query = searchQuery.toLowerCase();
    const matchesSearch = !query || doc.title.toLowerCase().includes(query) || actions.ocrSearchIds.includes(doc.id);
    if (activeView === 'dashboard') return !doc.isDeleted && !doc.isArchived && matchesSearch;
    if (activeView === 'folder') return doc.folderId === selectedFolderId && !doc.isDeleted && !doc.isArchived && matchesSearch;
    return false;
  });
  displayedDocsRef.current = displayedDocs;
  const isPremiumTier = billing.billingPlan === 'premium' || billing.billingPlan === 'family' || billing.billingPlan === 'business';

  const toggleUserMenu = useCallback(async () => {
    const willOpen = !session.isUserMenuOpen;
    session.setIsUserMenuOpen(willOpen);
    if (willOpen) await billing.loadBillingManageDetails();
  }, [billing, session]);

  const folderOptions = buildFolderOptions(folders);
  const mainScrollRef = useRef<HTMLElement>(null);
  const retentionAlerts = getRetentionAlerts(documents);
  const openPreview = (doc: DocumentRecord) => { setPreviewDoc(doc); setPreviewZoom(1); hover.setHoverDocId(null); };

  return (
    <div className="flex h-screen bg-[#111827] font-sans text-sm text-slate-300">
      {session.autoBackupStatus && (
        <div role="status" className={`fixed bottom-5 left-5 z-[9999] flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold shadow-2xl ${session.autoBackupStatus.stage === 'error' ? 'border-red-500/70 bg-red-950/95 text-red-100' : session.autoBackupStatus.stage === 'done' ? 'border-emerald-500/70 bg-emerald-950/95 text-emerald-100' : 'border-blue-500/70 bg-[#0f172a]/95 text-blue-100'}`}>
          <span>{session.autoBackupStatus.stage === 'sending' ? '☁️' : session.autoBackupStatus.stage === 'done' ? '✅' : '⚠️'}</span>
          <span>{session.autoBackupStatus.message}</span>
        </div>
      )}
      {toast && (
        <div role="status" className={`fixed bottom-5 right-5 z-[9999] min-w-80 rounded-md border-l-4 px-5 py-4 font-medium shadow-2xl ${toast.type === 'error' ? 'border-red-400 bg-red-950 text-red-50' : 'border-emerald-400 bg-emerald-950 text-emerald-50'}`}>
          {toast.message}
        </div>
      )}
      {appUpdate.justUpdatedInfo && (
        <div className="fixed bottom-5 left-5 z-[140] max-w-sm rounded-xl border border-emerald-500/60 bg-emerald-950/95 p-4 text-xs text-emerald-100 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-emerald-300">✅ Aplikacja została zaktualizowana</p>
              <p className="mt-1">Wersja: <span className="font-mono font-semibold">{appUpdate.justUpdatedInfo.version}</span></p>
              {appUpdate.justUpdatedInfo.infoUrl && <a href={appUpdate.justUpdatedInfo.infoUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block font-semibold text-blue-300 underline">Historia zmian na konto.arecki.pl ↗</a>}
            </div>
            <button type="button" onClick={appUpdate.dismissJustUpdated} aria-label="Zamknij" className="text-base text-emerald-300 hover:text-white">×</button>
          </div>
        </div>
      )}

      <AppDocumentModals
        apiUrl={API_URL} fetcher={fetch} apiFetch={apiFetch} documents={documents} folders={folders} tags={tags}
        folderOptions={folderOptions} activeView={activeView} selectedDocs={selectedDocs}
        previewDoc={previewDoc} previewZoom={previewZoom} onPreviewZoomChange={setPreviewZoom}
        onClosePreview={() => { setPreviewDoc(null); setPreviewZoom(1); }}
        propertiesDoc={propertiesDoc} onCloseProperties={() => setPropertiesDoc(null)}
        ocrDocumentId={ocrDocumentId} onCloseOcr={() => setOcrDocumentId(null)}
        secureShareId={secureShareId} onCloseSecureShare={() => setSecureShareId(null)}
        hoverDocId={hover.hoverDocId} hoverAnchor={hover.hoverAnchor} onHoverEnter={hover.handleHoverEnter} onHoverLeave={hover.handleHoverLeave}
        isUploading={batchUpload.isUploading} uploadProgress={batchUpload.uploadProgress} onCancelUpload={batchUpload.cancelUpload}
        uploadReport={batchUpload.uploadReport} onCloseUploadReport={() => batchUpload.setUploadReport(null)}
        isTagManagerOpen={isTagManagerOpen} onCloseTagManager={() => setIsTagManagerOpen(false)}
        moveModalDocId={moveModalDocId} onCloseMoveModal={() => setMoveModalDocId(null)}
        isBulkMoveOpen={isBulkMoveOpen} onCloseBulkMove={() => setIsBulkMoveOpen(false)}
        actions={actions}
        onCancelAction={() => { actions.setPendingAction(null); actions.setActionTimer(null); showToast('Anulowano operację', 'success'); }}
        onConfirmAction={() => { if (actions.actionTimer === 0) void actions.executeAction(); }}
      />

      <AppAccountModals
        apiUrl={API_URL} fetcher={fetch} apiFetch={apiFetch} activeView={activeView}
        session={session} billing={billing} testerConsent={testerConsent} appUpdate={appUpdate} pairing={pairing}
        isBillingPlansOpen={isBillingPlansOpen} setIsBillingPlansOpen={setIsBillingPlansOpen}
        isPlanUsageOpen={isPlanUsageOpen} setIsPlanUsageOpen={setIsPlanUsageOpen}
        isFamilyOpen={isFamilyOpen} setIsFamilyOpen={setIsFamilyOpen}
        isDeleteAccountOpen={isDeleteAccountOpen} setIsDeleteAccountOpen={setIsDeleteAccountOpen}
        legalDocTab={legalDocTab} setLegalDocTab={setLegalDocTab}
        isUpdateModalOpen={isUpdateModalOpen} setIsUpdateModalOpen={setIsUpdateModalOpen}
        isSelfHostGuideOpen={isSelfHostGuideOpen} setIsSelfHostGuideOpen={setIsSelfHostGuideOpen}
        onOpenBackupFromGuide={() => setBackupSection('settings')}
        isAccessSettingsOpen={isAccessSettingsOpen} setIsAccessSettingsOpen={setIsAccessSettingsOpen}
        feedbackDraft={feedbackDraft} setFeedbackDraft={setFeedbackDraft}
        userFeedbackReplyCount={feedback.userFeedbackReplyCount} onHistoryViewed={feedback.markUserFeedbackSeen}
        onFetchData={fetchData} showToast={showToast}
      />

      <DesktopSidebar
        activeView={activeView} documents={documents} billingPlan={billing.billingPlan} mobileOpen={mobileSidebarOpen} onCloseMobile={() => setMobileSidebarOpen(false)}
        onViewChange={view => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); if (view === 'developer') setDevSection(null); setActiveView(view); setSearchQuery(''); if (view === 'dashboard') setSelectedFolderId(null); }}
        onOpenScanner={() => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); void scanner.openWiaScanner(); }}
        onOpenIdCardCopy={() => setIsIdCardCopyOpen(true)}
        onOpenPairing={() => pairing.setIsPairingGuideOpen(true)}
        onToggleSettings={() => { setBackupSection(null); setIsBackupSecurityOpen(false); setIsSettingsMenuOpen(true); }}
        onOpenBackup={section => { setIsSettingsMenuOpen(false); setIsBackupSecurityOpen(false); setBackupSection(section); }}
        userFeedbackReplyCount={feedback.userFeedbackReplyCount}
        onOpenFeedback={() => { void (async () => { const ipc = getElectronIpc(); const shot = ipc ? await ipc.invoke('mojateczka-capture-screenshot').catch(() => null) as { dataUrl?: string; appVersion?: string; platform?: string } | null : null; setFeedbackDraft({ screenshot: shot?.dataUrl || null, appVersion: shot?.appVersion, platform: shot?.platform }); })(); }}
      />

      <div className="cyber-dashboard-bg flex flex-1 flex-col overflow-hidden bg-[#0f172a]">
        <DesktopTopBar
          activeView={activeView} scannerFileCount={scannerFiles.length} retentionAlerts={retentionAlerts}
          notificationsOpen={isNotificationsOpen} userMenuOpen={session.isUserMenuOpen} currentUser={session.currentUser}
          billingPlan={billing.billingPlan} billingIsDev={billing.billingIsDev} apiUrl={API_URL} apiFetcher={apiFetch}
          onDevPlanChanged={() => { billing.setBillingDetails(null); setDevPlanNonce(n => n + 1); void fetchData(); }}
          billingDetails={billing.billingDetails} billingDetailsBusy={billing.billingDetailsBusy} billingBusy={billing.billingBusy} billingCancelBusy={billing.billingCancelBusy}
          onBack={() => { setActiveView('dashboard'); setSelectedFolderId(null); setSearchQuery(''); }}
          onToggleNotifications={() => setIsNotificationsOpen(v => !v)}
          onOpenScannerInbox={() => { void scanner.openWiaScanner(); setIsNotificationsOpen(false); }}
          onOpenNotification={docId => { const doc = documents.find(item => item.id === docId); if (doc) { setSelectedFolderId(doc.folderId); setActiveView('folder'); } setIsNotificationsOpen(false); }}
          onToggleUserMenu={() => void toggleUserMenu()}
          onOpenBillingPlans={() => { setIsBillingPlansOpen(true); session.setIsUserMenuOpen(false); }}
          onRequestCancelBilling={() => { void billing.openBillingCancel(); }}
          onOpenPlanUsage={() => { session.setIsUserMenuOpen(false); setIsPlanUsageOpen(true); }}
          onOpenFamily={() => { session.setIsUserMenuOpen(false); setIsFamilyOpen(true); }}
          onOpenLegalDocs={() => { session.setIsUserMenuOpen(false); setLegalDocTab('privacy'); }}
          onOpenBillingHistory={() => { session.setIsUserMenuOpen(false); void billing.openBillingHistory(); }}
          onOpenAuth={() => { session.setIsAuthOpen(true); session.setIsUserMenuOpen(false); }}
          onLogout={() => void session.logoutAccount()}
          onOpenAccessSettings={() => { setIsAccessSettingsOpen(true); session.setIsUserMenuOpen(false); }}
          onOpenSettings={() => { setBackupSection(null); setIsBackupSecurityOpen(false); setIsSettingsMenuOpen(true); session.setIsUserMenuOpen(false); }}
          showNotificationsInTopBar={notificationsInTopBar} onToggleNotificationsInTopBar={setNotificationsDockMode}
          onToggleMobileSidebar={() => setMobileSidebarOpen(v => !v)}
          updateAvailable={Boolean(appUpdate.availableUpdate && !testerConsent.needsConsent)} onOpenUpdatePrompt={() => setIsUpdateModalOpen(true)}
          openBugCount={feedback.openBugCount} adminReplyCount={feedback.adminReplyCount}
          onOpenDeveloperFeedback={() => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); setDevSection('feedback'); setActiveView('developer'); }}
          onOpenDeveloper={() => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); setDevSection(null); setActiveView('developer'); }}
          mailSyncing={mailSync.mailSyncing} mailSyncPaused={mailSync.mailSyncPaused}
          onOpenMailInbox={() => setActiveView('mail-inbox')} onStopMailSync={() => void mailSync.stopMailSync()}
          onResumeMailSync={() => void mailSync.startMailSync(undefined, 'incremental')}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />
        {!isPremiumTier && <PromotionBanner apiUrl={API_URL} fetcher={apiFetch} currentPlan={billing.billingPlan} onOpenPlans={() => setIsBillingPlansOpen(true)} />}
        {mailAutoPromptCount > 0 && activeView !== 'mail-inbox' && (
          <div role="status" className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/40 bg-cyan-950/50 px-4 py-2.5 text-sm text-cyan-100">
            <p>📧 Automatyczne skanowanie poczty: znaleziono <strong>{mailAutoPromptCount}</strong> załączników w poczekalni. Czy chcesz je teraz przydzielić do kartotek?</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { setMailAutoPromptCount(0); setActiveView('mail-inbox'); }} className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400">Przejdź do Poczty i przydziel</button>
              <button type="button" onClick={() => setMailAutoPromptCount(0)} className="rounded-lg border border-cyan-500/40 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-900/40">Później</button>
            </div>
          </div>
        )}

        <main ref={mainScrollRef} className="custom-scrollbar relative flex flex-1 justify-center overflow-y-auto p-3 pb-20 sm:p-6 lg:pb-6">
          <BulkSelectionBar
            activeView={activeView} documents={documents} selectedDocs={selectedDocs}
            onOpenBulkMove={() => setIsBulkMoveOpen(true)}
            onBulkArchive={() => actions.initiateAction('bulk_archive', 0, String(selectedDocs.length))}
            onBulkDelete={() => actions.initiateAction('bulk_delete', 0, String(selectedDocs.length))}
            onBulkTrash={() => actions.initiateAction('bulk_trash', 0, String(selectedDocs.length))}
            onClearSelected={actions.clearSelectedDocs}
          />
          {isSettingsMenuOpen ? (
            <SettingsDialog embedded isPremiumPlan={isPremiumTier} accountEmail={session.currentUser?.email || ''} onClose={() => setIsSettingsMenuOpen(false)} onPair={() => pairing.setIsPairingGuideOpen(true)} onSecurity={() => setIsAccessSettingsOpen(true)} onTags={() => setIsTagManagerOpen(true)} onBackup={() => setBackupSection('settings')} onBackupSecurity={() => setIsBackupSecurityOpen(true)} onSelfHostGuide={() => setIsSelfHostGuideOpen(true)} onDeleteAccount={() => setIsDeleteAccountOpen(true)} onLogout={() => void session.logoutAccount()} />
          ) : backupSection ? (
            <BackupModal embedded key={backupSection} section={backupSection} apiUrl={API_URL} fetcher={apiFetch} isPremiumPlan={isPremiumTier} onClose={() => setBackupSection(null)} onDone={msg => { setBackupSection(null); if (msg) showToast(msg, 'success', 6000); void fetchData(); }} />
          ) : isBackupSecurityOpen ? (
            <BackupSecurityModal embedded apiUrl={API_URL} fetcher={fetch} onClose={() => setIsBackupSecurityOpen(false)} />
          ) : activeView === 'options' ? (
            <AppOptionsPage onClose={() => setActiveView('dashboard')} onOpenSecurity={() => setIsAccessSettingsOpen(true)} onOpenBackup={() => setBackupSection('settings')} onOpenTags={() => setIsTagManagerOpen(true)} onOpenPairing={() => pairing.setIsPairingGuideOpen(true)} />
          ) : activeView === 'mail-inbox' ? (
            <MailInboxView apiUrl={API_URL} fetcher={effectiveFetch} folders={folders} billingPlan={`${billing.billingPlan}:${devPlanNonce}`} onAssigned={fetchData} showToast={showToast} mailSyncing={mailSync.mailSyncing} mailSyncPaused={mailSync.mailSyncPaused} onStartSync={mailSync.startMailSync} onStopSync={mailSync.stopMailSync} onResetSync={mailSync.resetMailSync} />
          ) : activeView === 'ksef-sync' && billing.billingPlan === 'business' ? (
            <KsefSyncPanel apiUrl={API_URL} fetcher={fetch} folders={folders} billingPlan={billing.billingPlan} onSynced={fetchData} showToast={showToast} />
          ) : activeView === 'expiry-calendar' ? (
            <ExpiryCalendarView apiUrl={API_URL} fetcher={fetch} documents={documents} onOpenDocument={openPreview} onRefreshData={fetchData} showToast={showToast} />
          ) : activeView === 'developer' ? (
            <DeveloperPanel embedded initialSection={devSection} currentUser={session.currentUser} onPlanChanged={() => { billing.setBillingDetails(null); setDevPlanNonce(n => n + 1); void fetchData(); }} openBugCount={feedback.openBugCount} adminReplyCount={feedback.adminReplyCount} onOpenBugCountChange={feedback.updateOpenBugCount} onAdminReplyCountChange={feedback.setAdminReplyCount} onClose={() => setActiveView('dashboard')} />
          ) : activeView === 'scanner' ? (
            <PrinterScannerModal
              devices={scanner.wiaDevices} loadingDevices={scanner.isWiaLoadingDevices} deviceId={scanner.wiaDeviceId} folderId={scanner.wiaFolderId}
              folderOptions={folderOptions} pages={scanner.wiaPages} title={scanner.wiaTitle}
              retentionValue={scanner.wiaRetentionValue} retentionUnit={scanner.wiaRetentionUnit} retentionEnabled={scanner.wiaRetentionEnabled}
              stage={scanner.wiaStage} busy={scanner.isWiaScanning} pendingScan={Boolean(scanner.wiaPendingScanPath)}
              onDeviceChange={id => { scanner.setWiaDeviceId(id); localStorage.setItem('mojateczka_default_scanner', id); }}
              onFolderChange={scanner.setWiaFolderId} onTitleChange={scanner.setWiaTitle}
              onRetentionValueChange={scanner.setWiaRetentionValue} onRetentionUnitChange={scanner.setWiaRetentionUnit} onRetentionEnabledChange={scanner.setWiaRetentionEnabled}
              onScan={() => void scanner.scanFromPrinter()} onAddCameraPage={scanner.addCameraPage}
              onRemovePage={index => scanner.setWiaPages(prev => prev.filter((_, pageIndex) => pageIndex !== index))}
              inbox={scannerFiles} onSave={() => void scanner.savePrinterDocument()} onMove={id => void scanner.moveInboxScan(id)}
              onRename={scanner.renameInboxScan} onClose={() => setActiveView('dashboard')}
            />
          ) : activeView === 'upload' ? (
            <UploadPanel
              uploadUsage={batchUpload.uploadUsage} uploadDocsExceeded={batchUpload.uploadDocsExceeded} uploadMergeExceeded={batchUpload.uploadMergeExceeded}
              uploadDocsRemaining={batchUpload.uploadDocsRemaining} uploadMergeRemaining={batchUpload.uploadMergeRemaining} neededUploadDocs={batchUpload.neededUploadDocs}
              folderId={batchUpload.folderId} setFolderId={batchUpload.setFolderId} folderOptions={folderOptions}
              physicalLocation={batchUpload.physicalLocation} setPhysicalLocation={batchUpload.setPhysicalLocation} foldersUnavailable={foldersUnavailable}
              filesToUpload={batchUpload.filesToUpload} setFilesToUpload={batchUpload.setFilesToUpload}
              isMergeMode={batchUpload.isMergeMode} setIsMergeMode={batchUpload.setIsMergeMode} isUploading={batchUpload.isUploading}
              mergedTitle={batchUpload.mergedTitle} setMergedTitle={batchUpload.setMergedTitle}
              mergedRetentionVal={batchUpload.mergedRetentionVal} setMergedRetentionVal={batchUpload.setMergedRetentionVal}
              mergedRetentionUnit={batchUpload.mergedRetentionUnit} setMergedRetentionUnit={batchUpload.setMergedRetentionUnit}
              mergedRetentionEnabled={batchUpload.mergedRetentionEnabled} setMergedRetentionEnabled={batchUpload.setMergedRetentionEnabled}
              onFileSelect={batchUpload.handleFileSelect} onSubmit={batchUpload.handleBatchUpload}
              onOpenPlans={() => setIsBillingPlansOpen(true)} onRetryFetch={() => void fetchData()}
              onOpenEReceiptImport={() => setIsEReceiptImportOpen(true)}
              onOpenIdCardCopy={() => setIsIdCardCopyOpen(true)}
              onPasteFromClipboard={() => {
                void (async () => {
                  if (!navigator.clipboard?.read) {
                    showToast('Naciśnij Ctrl+V na klawiaturze, aby wkleić obraz ze schowka.', 'success');
                    return;
                  }
                  try {
                    const items = await navigator.clipboard.read();
                    const files: File[] = [];
                    for (const item of items) {
                      const imgType = item.types.find(t => t.startsWith('image/'));
                      if (!imgType) continue;
                      const blob = await item.getType(imgType);
                      const ext = imgType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
                      files.push(new File([blob], `schowek-${Date.now()}.${ext}`, { type: imgType }));
                    }
                    if (!files.length) {
                      showToast('W schowku nie znaleziono obrazu. Skopiuj zrzut ekranu i kliknij ponownie lub użyj Ctrl+V.', 'error');
                      return;
                    }
                    batchUpload.setFilesToUpload(prev => [
                      ...prev,
                      ...files.map(file => ({ file, enabled: false, value: 5, unit: 'years' as const })),
                    ]);
                    showToast(`📋 Wklejono ze schowka (${files.length} plik) — wybierz kartotekę i zapisz.`, 'success');
                  } catch {
                    showToast('Naciśnij Ctrl+V na klawiaturze, aby wkleić plik ze schowka.', 'success');
                  }
                })();
              }}
            />
          ) : (
            <DocumentsWorkspaceSection
              apiUrl={API_URL} fetcher={fetch} apiFetch={apiFetch} activeView={activeView} setActiveView={setActiveView}
              selectedFolderId={selectedFolderId} setSelectedFolderId={setSelectedFolderId} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              documents={documents} displayedDocs={displayedDocs} folders={folders} tags={tags} selectedDocs={selectedDocs} setSelectedDocs={setSelectedDocs}
              scannerFileCount={scannerFiles.length} billingPlan={billing.billingPlan} accountEmail={session.currentUser?.email || ''}
              documentMenuId={documentMenuId} setDocumentMenuId={setDocumentMenuId}
              renamingDocId={renamingDocId} setRenamingDocId={setRenamingDocId} renamingDocTitle={renamingDocTitle} setRenamingDocTitle={setRenamingDocTitle}
              needsDiskReconnect={testerConsent.storageMode === 'local_disk' && testerConsent.diskReconnect.needed && !testerConsent.needsConsent}
              diskFolderName={testerConsent.diskReconnect.folderName ?? undefined} diskBusy={testerConsent.busy}
              onReconnectDisk={() => void testerConsent.reconnectDisk().then(ok => { if (ok) { testerBlockedRef.current = false; void fetchData(); } })}
              onOpenScanner={() => void scanner.openWiaScanner()}
              onOpenUploadToFolder={targetId => { batchUpload.setFolderId(String(targetId)); setActiveView('upload'); }}
              onOpenPreview={openPreview}
              onHoverEnter={(doc, anchor) => { hover.setHoverAnchor(anchor); hover.handleHoverEnter(doc.id); }}
              onHoverLeave={hover.handleHoverLeave}
              onOpenBulkMove={() => setIsBulkMoveOpen(true)} onOpenMoveModal={setMoveModalDocId}
              onOpenSecureShare={setSecureShareId} onOpenOcr={setOcrDocumentId} onPropertiesDoc={setPropertiesDoc}
              onFetchData={fetchData} showToast={showToast} actions={actions}
            />
          )}
          <MainScrollIndicator containerRef={mainScrollRef} />
        </main>
        <MobileBottomNav
          activeView={activeView}
          onViewChange={view => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); setActiveView(view); if (view !== 'folder') setSelectedFolderId(null); }}
          onOpenScanner={() => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); void scanner.openWiaScanner(); }}
        />
      </div>

      {isEReceiptImportOpen && (
        <EReceiptImportModal
          apiUrl={API_URL}
          fetcher={apiFetch}
          initialFolderId={batchUpload.folderId}
          folderOptions={folderOptions}
          onImported={fetchData}
          onClose={() => setIsEReceiptImportOpen(false)}
          showToast={showToast}
        />
      )}
      <CommandPaletteModal
        open={isCommandPaletteOpen}
        documents={documents}
        folders={folders}
        billingPlan={billing.billingPlan}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenDocument={openPreview}
        onOpenFolder={id => { setSelectedFolderId(id); setActiveView('folder'); }}
        onNavigate={view => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); setActiveView(view); }}
        onOpenScanner={() => void scanner.openWiaScanner()}
        onOpenIdCardCopy={() => setIsIdCardCopyOpen(true)}
      />
      {isIdCardCopyOpen && (
        <IdCardCopyModal apiUrl={API_URL} fetcher={fetch} onClose={() => setIsIdCardCopyOpen(false)} />
      )}
      {!notificationsInTopBar && (
        <SideNotificationsDrawer
          open={isNotificationsOpen} scannerFileCount={scannerFiles.length} retentionAlerts={retentionAlerts}
          onToggleOpen={() => setIsNotificationsOpen(v => !v)}
          onOpenScannerInbox={() => { void scanner.openWiaScanner(); setIsNotificationsOpen(false); }}
          onOpenNotification={docId => { const doc = documents.find(item => item.id === docId); if (doc) { setSelectedFolderId(doc.folderId); setActiveView('folder'); } setIsNotificationsOpen(false); }}
          onRestoreToTopBar={() => setNotificationsDockMode(true)}
        />
      )}
    </div>
  );
}
