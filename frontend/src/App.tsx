import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DesktopAccessSettings from './DesktopAccessSettings';
import DocumentPreviewModal from './components/DocumentPreviewModal';
import HoverDocumentPreview from './components/HoverDocumentPreview';
import PrinterScannerModal, { type InboxScan } from './components/PrinterScannerModal';
import DesktopSidebar from './components/DesktopSidebar';
import DesktopTopBar from './components/DesktopTopBar';
import PromotionBanner from './components/PromotionBanner';
import BillingHistoryModal from './components/BillingHistoryModal';
import PlanUsageModal from './components/PlanUsageModal';
import FamilySettingsModal from './components/FamilySettingsModal';
import TesterConsentModal from './components/TesterConsentModal';
import DeleteAccountModal from './components/DeleteAccountModal';
import AppUpdatePromptModal from './components/AppUpdatePromptModal';
import LegalDocsModal, { type LegalDocId } from './components/LegalDocsModal';
import SecureShareModal from './components/SecureShareModal';
import PlanLimitModal from './components/PlanLimitModal';
import AuthModal from './components/AuthModal';
import SettingsDialog from './components/SettingsDialog';
import MobileOnboarding from './components/MobileOnboarding';
import PairingGuideModal from './components/PairingGuideModal';
import BillingCancelModal from './components/BillingCancelModal';
import DocumentTableView from './components/DocumentTableView';
import WelcomeScreen from './components/WelcomeScreen';
import BillingPlansModal from './components/BillingPlansModalV2';
import BackupModal, { type BackupSection } from './components/BackupModal';
import FeedbackModal from './components/FeedbackModal';
import DeveloperPanel, { type DevSection } from './components/DeveloperPanel';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import BackupSecurityModal from './components/BackupSecurityModal';
import CloseAppModal from './components/CloseAppModal';
import { AppFolderIcon } from './components/FolderIconPicker';
import OcrPanel from './components/OcrPanel';
import DocumentPropertiesModal from './components/DocumentPropertiesModal';
import SelfHostServerGuideModal from './components/SelfHostServerGuideModal';
import TagManagerModal from './components/TagManagerModal';
import RetentionModal from './components/RetentionModal';
import MoveDocumentModal from './components/MoveDocumentModal';
import DestructiveActionModal from './components/DestructiveActionModal';
import BulkMoveModal from './components/BulkMoveModal';
import SideNotificationsDrawer from './components/SideNotificationsDrawer';
import FolderDeletePreviewModal from './components/FolderDeletePreviewModal';
import UploadTransferProgress from './components/UploadTransferProgress';
import ArchiveDesktop from './components/ArchiveDesktop';
import FoldersDesktop from './components/FoldersDesktop';
import TrashDesktop from './components/TrashDesktop';
import UploadPanel from './components/UploadPanel';
import { useWiaScanner } from './hooks/useWiaScanner';
import { usePairingStatus } from './hooks/usePairingStatus';
import { useBillingFlow } from './hooks/useBillingFlow';
import { useBatchUpload } from './hooks/useBatchUpload';
import { useAppSession } from './hooks/useAppSession';
import { useTesterConsent } from './hooks/useTesterConsent';
import { useAppUpdateCheck } from './hooks/useAppUpdateCheck';
import { createLocalTesterFetcher } from './services/localTesterStore';
import { useDocumentAndFolderActions } from './hooks/useDocumentAndFolderActions';
import { createApiFetch } from './services/apiFetch';
import { resolveApiBase } from './services/apiBase';
import { getElectronIpc } from './services/electron';
import { getBillingStatus } from './services/billing';
import { shareDocumentClassic } from './services/classicShare';
import { createFolder, moveFolderToParent, renameFolder, reorderFolders } from './services/folderApi';
import { getRetentionAlerts } from './services/retentionAlerts';
import { buildFolderOptions } from './utils/folderTree';
import { errorMessage } from './utils/errors';
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
  const [hoverDocId, setHoverDocId] = useState<number | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
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
  const [notificationsInTopBar, setNotificationsInTopBar] = useState(() => localStorage.getItem('eteczka_notifications_topbar') === 'true');
  const setNotificationsDockMode = useCallback((inTopBar: boolean) => {
    localStorage.setItem('eteczka_notifications_topbar', String(inTopBar));
    setNotificationsInTopBar(inTopBar);
    setIsNotificationsOpen(false);
  }, []);
  const [isAccessSettingsOpen, setIsAccessSettingsOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [devSection, setDevSection] = useState<DevSection | null>(null);
  const [openBugCount, setOpenBugCount] = useState<number>(() => {
    const saved = Number(localStorage.getItem('eteczka_dev_open_bugs'));
    return Number.isFinite(saved) && saved >= 0 ? saved : 0;
  });
  const [adminReplyCount, setAdminReplyCount] = useState<number>(0);
  const [userFeedbackReplyCount, setUserFeedbackReplyCount] = useState<number>(0);

  const updateOpenBugCount = useCallback((count: number) => {
    setOpenBugCount(count);
    localStorage.setItem('eteczka_dev_open_bugs', String(count));
  }, []);

  const markUserFeedbackSeen = useCallback(() => {
    localStorage.setItem('eteczka_feedback_user_seen_at', new Date().toISOString());
    setUserFeedbackReplyCount(0);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let active = true;
    const loadBugCount = async () => {
      try {
        const res = await fetch(`${API_URL}/api/dev/feedback`);
        if (!res.ok) return;
        const payload = await res.json().catch(() => ({})) as { items?: Array<{ status?: string; messages?: Array<{ author?: string }> }> };
        if (active && Array.isArray(payload.items)) {
          updateOpenBugCount(payload.items.filter(item => item.status !== 'closed').length);
          setAdminReplyCount(payload.items.filter(item => item.status !== 'closed' && item.messages?.at(-1)?.author === 'user').length);
        }
      } catch { /* keep last known count when rate-limited or starting */ }
    };
    void loadBugCount();
    const timer = window.setInterval(() => void loadBugCount(), 300_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [updateOpenBugCount]);

  useEffect(() => {
    let active = true;
    const loadUserReplies = async () => {
      try {
        const res = await apiFetch(`${API_URL}/api/feedback/history`);
        if (!res.ok) return;
        const payload = await res.json().catch(() => ({})) as { items?: Array<{ messages?: Array<{ author?: string; createdAt?: string }> }> };
        if (!active || !Array.isArray(payload.items)) return;
        const seenAt = Date.parse(localStorage.getItem('eteczka_feedback_user_seen_at') || '') || 0;
        const unread = payload.items.filter(item => {
          const last = item.messages?.at(-1);
          if (!last || last.author !== 'admin') return false;
          const msgTime = Date.parse(last.createdAt || '') || 0;
          return msgTime > seenAt;
        }).length;
        setUserFeedbackReplyCount(unread);
      } catch { /* ignore transient feedback history check failures */ }
    };
    void loadUserReplies();
    const timer = window.setInterval(() => void loadUserReplies(), 300_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isBackupSecurityOpen, setIsBackupSecurityOpen] = useState(false);
  const [isSelfHostGuideOpen, setIsSelfHostGuideOpen] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState<{ screenshot: string | null; appVersion?: string; platform?: string } | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const hoverOpenTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const syncBillingRef = useRef<(plan: 'free' | 'standard' | 'premium', isDev: boolean) => void>(() => { });

  useEffect(() => {
    const close = () => setDocumentMenuId(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const toastTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const showToast = useCallback((message: string, type = 'success', durationMs = 3500) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      toastTimeoutRef.current = null;
      setToast(null);
    }, durationMs);
  }, []);

  const fetchData = useCallback(async () => {
    const sessionAtStart = localStorage.getItem('eteczka_auth_token');
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
      if (localStorage.getItem('eteczka_auth_token') !== sessionAtStart) return;
      if (resDocs) setDocuments(resDocs as DocumentRecord[]);
      if (resFolders) setFolders(resFolders as FolderRecord[]);
      setFoldersUnavailable(resFolders === null);
      if (resScanner) setScannerFiles(resScanner as InboxScan[]);
      if (resTags) setTags(resTags as Tag[]);
      if (resBilling) syncBillingRef.current(resBilling.plan === 'premium' || resBilling.plan === 'standard' ? resBilling.plan : 'free', Boolean(resBilling.developmentOverride));
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
  const isLocalTesterMode = testerConsent.storageMode === 'local_disk' || testerConsent.storageMode === 'local_browser';
  const effectiveFetch = useMemo(
    () => (isLocalTesterMode && session.currentUser?.email
      ? createLocalTesterFetcher(session.currentUser.email, apiFetch)
      : apiFetch),
    [isLocalTesterMode, session.currentUser?.email],
  );
  fetchRef.current = effectiveFetch;

  useEffect(() => {
    if (session.currentUser && !testerConsent.checking && !testerConsent.needsConsent && !testerConsent.diskReconnect.needed) {
      void fetchData();
    }
  }, [session.currentUser, testerConsent.checking, testerConsent.needsConsent, testerConsent.diskReconnect.needed, fetchData]);

  const closeUserMenu = useCallback(() => session.setIsUserMenuOpen(false), [session]);
  const billing = useBillingFlow({ apiUrl: API_URL, fetcher: fetch, fetchData, showToast, closeUserMenu });
  syncBillingRef.current = (plan, isDev) => {
    billing.setBillingPlan(plan);
    billing.setBillingIsDev(isDev);
  };

  const pairing = usePairingStatus(API_URL, fetch);
  const scanner = useWiaScanner({ apiUrl: API_URL, fetcher: fetch, activeView, setActiveView, setScannerFiles, fetchData, showToast });
  const batchUpload = useBatchUpload({
    apiUrl: API_URL, fetcher: fetch, activeView, setActiveView, selectedFolderId,
    folders, foldersUnavailable, billingPlan: billing.billingPlan, documentsCount: documents.length, fetchData, showToast,
  });

  const actions = useDocumentAndFolderActions({
    apiUrl: API_URL, fetcher: fetch, activeView, setActiveView, setSelectedFolderId,
    selectedDocs, setSelectedDocs, displayedDocs: [], billingPlan: billing.billingPlan,
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

  const toggleUserMenu = useCallback(async () => {
    const willOpen = !session.isUserMenuOpen;
    session.setIsUserMenuOpen(willOpen);
    if (willOpen) await billing.loadBillingManageDetails();
  }, [billing, session]);

  const handleHoverEnter = (id: number) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (hoverOpenTimeoutRef.current) clearTimeout(hoverOpenTimeoutRef.current);
    if (hoverDocId === id) return;
    hoverOpenTimeoutRef.current = setTimeout(() => {
      hoverOpenTimeoutRef.current = null;
      setHoverDocId(id);
    }, 500);
  };
  const handleHoverLeave = () => {
    if (hoverOpenTimeoutRef.current) {
      clearTimeout(hoverOpenTimeoutRef.current);
      hoverOpenTimeoutRef.current = null;
    }
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => { setHoverDocId(null); }, 300);
  };

  const renderSelectOptions = () => buildFolderOptions(folders);
  const retentionAlerts = getRetentionAlerts(documents);

  return (
    <div className="flex h-screen bg-[#111827] font-sans text-sm text-slate-300">
      {session.showWelcome && !session.currentUser && (
        <WelcomeScreen onContinue={() => session.setShowWelcome(false)} onAuthenticated={user => { session.setShowWelcome(false); session.handleAuthenticated(user); }} />
      )}
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

      {previewDoc && <DocumentPreviewModal fetcher={fetch} apiUrl={API_URL} document={previewDoc} zoom={previewZoom} onZoomChange={setPreviewZoom} onClose={() => { setPreviewDoc(null); setPreviewZoom(1); }} />}
      {batchUpload.isUploading && batchUpload.uploadProgress && <UploadTransferProgress progress={batchUpload.uploadProgress} onCancel={batchUpload.cancelUpload} />}
      {batchUpload.uploadReport && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="upload-report-title" className="w-full max-w-lg rounded-xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
            <h2 id="upload-report-title" className="text-xl font-bold text-white">Wynik wgrywania</h2>
            <p className="mt-3 text-sm">Podkartoteka: <strong>{batchUpload.uploadReport.folder}</strong>. Wgrano plików: <strong>{batchUpload.uploadReport.saved}</strong>.</p>
            <p className="mt-3 text-sm text-amber-200">Pominięto {batchUpload.uploadReport.skipped.length} identycznych plików — były już w tej podkartotece lub pojawiły się wcześniej w wybranej paczce.</p>
            <ul className="mt-3 max-h-48 list-disc overflow-auto pl-5 text-sm text-slate-300">{batchUpload.uploadReport.skipped.map((item, index) => <li key={index} className="break-words">{item.name} — identyczny jak „{item.existingTitle}”</li>)}</ul>
            <button onClick={() => batchUpload.setUploadReport(null)} className="mt-5 rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white">Rozumiem</button>
          </section>
        </div>
      )}
      {billing.isBillingCancelOpen && <BillingCancelModal previewBusy={billing.billingCancelPreviewBusy} previewError={billing.billingCancelPreviewError} preview={billing.billingCancelPreview} cancelBusy={billing.billingCancelBusy} onClose={() => billing.setIsBillingCancelOpen(false)} onConfirm={() => void billing.cancelBilling()} />}
      {billing.planLimitMessage && <PlanLimitModal message={billing.planLimitMessage} plan={billing.billingPlan} busy={billing.billingBusy} onClose={() => billing.setPlanLimitMessage('')} onSelect={(plan, interval) => { billing.setPlanLimitMessage(''); void billing.openBillingCheckout(plan, interval, false, true); }} />}
      {secureShareId !== null && <SecureShareModal apiUrl={API_URL} fetcher={apiFetch} documentId={secureShareId} title={documents.find(doc => doc.id === secureShareId)?.title || 'Dokument'} onClose={() => setSecureShareId(null)} />}
      {isPlanUsageOpen && <PlanUsageModal apiUrl={API_URL} fetcher={apiFetch} onClose={() => setIsPlanUsageOpen(false)} />}
      {isFamilyOpen && <FamilySettingsModal apiUrl={API_URL} fetcher={fetch} currentUserEmail={session.currentUser?.email ?? null} onChanged={() => { void fetchData(); }} onClose={() => setIsFamilyOpen(false)} />}
      {testerConsent.needsConsent && session.currentUser && (
        <TesterConsentModal
          userEmail={session.currentUser.email}
          busy={testerConsent.busy}
          error={testerConsent.error}
          onAccept={mode => void testerConsent.submitConsent(true, mode).then(ok => { if (ok) void fetchData(); })}
          onDecline={() => void testerConsent.submitConsent(false, 'local_browser').finally(() => void session.logoutAccount())}
          onOpenLegalDoc={setLegalDocTab}
        />
      )}
      {legalDocTab && <LegalDocsModal apiUrl={API_URL} initialTab={legalDocTab} onClose={() => setLegalDocTab(null)} />}
      {isUpdateModalOpen && appUpdate.availableUpdate && !testerConsent.needsConsent && (
        <AppUpdatePromptModal
          update={appUpdate.availableUpdate}
          updatingProgress={appUpdate.updatingProgress}
          onUpdateNow={() => void appUpdate.applyUpdateNow()}
          onPostpone={delay => { setIsUpdateModalOpen(false); appUpdate.postponeUpdate(delay); }}
        />
      )}
      {appUpdate.justUpdatedInfo && (
        <div className="fixed bottom-5 left-5 z-[140] max-w-sm rounded-xl border border-emerald-500/60 bg-emerald-950/95 p-4 text-xs text-emerald-100 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-emerald-300">✅ Aplikacja została zaktualizowana</p>
              <p className="mt-1">Wersja: <span className="font-mono font-semibold">{appUpdate.justUpdatedInfo.version}</span></p>
              {appUpdate.justUpdatedInfo.infoUrl && (
                <a href={appUpdate.justUpdatedInfo.infoUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block font-semibold text-blue-300 underline">
                  Historia zmian na konto.arecki.pl ↗
                </a>
              )}
            </div>
            <button type="button" onClick={appUpdate.dismissJustUpdated} aria-label="Zamknij" className="text-base text-emerald-300 hover:text-white">×</button>
          </div>
        </div>
      )}
      {billing.isBillingHistoryOpen && <BillingHistoryModal transactions={billing.billingHistory} loading={billing.billingHistoryBusy} onClose={() => billing.setIsBillingHistoryOpen(false)} />}
      {backupSection && null}
      {feedbackDraft && <FeedbackModal apiUrl={API_URL} fetcher={apiFetch} activeView={activeView} initialScreenshot={feedbackDraft.screenshot} initialAppVersion={feedbackDraft.appVersion} initialPlatform={feedbackDraft.platform} unreadReplyCount={userFeedbackReplyCount} onHistoryViewed={markUserFeedbackSeen} onClose={() => setFeedbackDraft(null)} />}
      {ocrDocumentId !== null && <OcrPanel apiUrl={API_URL} documentId={ocrDocumentId} title={documents.find(document => document.id === ocrDocumentId)?.title || 'Dokument'} fetcher={fetch} onClose={() => setOcrDocumentId(null)} />}
      {propertiesDoc && <DocumentPropertiesModal document={propertiesDoc} folders={folders} onClose={() => setPropertiesDoc(null)} />}
      {isSelfHostGuideOpen && <SelfHostServerGuideModal onClose={() => setIsSelfHostGuideOpen(false)} onOpenBackup={() => { setIsSelfHostGuideOpen(false); setBackupSection('settings'); }} />}
      {hoverDocId !== null && hoverAnchor && (() => { const hovered = documents.find(d => d.id === hoverDocId); return hovered ? <HoverDocumentPreview document={hovered} anchor={hoverAnchor} apiUrl={API_URL} fetcher={fetch} onEnter={() => handleHoverEnter(hovered.id)} onLeave={handleHoverLeave} /> : null; })()}

      <TagManagerModal isOpen={isTagManagerOpen} tags={tags} name={actions.newTagName} color={actions.newTagColor} onNameChange={actions.setNewTagName} onColorChange={actions.setNewTagColor} onCreate={() => void actions.createTag()} onDelete={tagId => void actions.deleteTag(tagId)} onClose={() => setIsTagManagerOpen(false)} />
      <MoveDocumentModal documentId={moveModalDocId} folderOptions={renderSelectOptions()} onMove={fid => actions.updateDocument(moveModalDocId!, { folderId: fid })} onClose={() => setMoveModalDocId(null)} />
      <BulkMoveModal isOpen={isBulkMoveOpen} documentCount={selectedDocs.length} restoring={activeView === 'trash' || activeView === 'archive'} folderOptions={renderSelectOptions()} onMove={actions.moveSelectedDocs} onClose={() => setIsBulkMoveOpen(false)} />
      {actions.folderDeletePreview && (
        <FolderDeletePreviewModal
          preview={actions.folderDeletePreview}
          transferFolderId={actions.transferFolderId}
          onTransferFolderChange={actions.setTransferFolderId}
          folderOptions={renderSelectOptions()}
          onConfirmTransfer={() => { const p = actions.folderDeletePreview!; actions.setFolderDeletePreview(null); actions.initiateAction('delete_folder', p.id, p.name, Number(actions.transferFolderId), p.archivedCount, p.trashedCount, { deleteMode: 'transfer' }); }}
          onConfirmTrash={() => { const p = actions.folderDeletePreview!; actions.setFolderDeletePreview(null); actions.initiateAction('delete_folder', p.id, p.name, null, p.archivedCount, p.trashedCount, { deleteMode: 'trash' }); }}
          onCancel={() => actions.setFolderDeletePreview(null)}
        />
      )}
      <DestructiveActionModal action={actions.pendingAction} seconds={actions.actionTimer} onCancel={() => { actions.setPendingAction(null); actions.setActionTimer(null); showToast('Anulowano operację', 'success'); }} onConfirm={() => { if (actions.actionTimer === 0) void actions.executeAction(); }} />
      <RetentionModal state={actions.retentionModal} folderOptions={renderSelectOptions()} onStateChange={actions.setRetentionModal} onSubmit={actions.handleRetentionUpdate} onClose={() => actions.setRetentionModal({ ...actions.retentionModal, isOpen: false })} />

      <DesktopSidebar activeView={activeView} documents={documents} mobileOpen={mobileSidebarOpen} onCloseMobile={() => setMobileSidebarOpen(false)} onViewChange={view => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); if (view === 'developer') setDevSection(null); setActiveView(view); setSearchQuery(''); if (view === 'dashboard') setSelectedFolderId(null); }} onOpenScanner={() => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); void scanner.openWiaScanner(); }} onOpenPairing={() => pairing.setIsPairingGuideOpen(true)} onToggleSettings={() => { setBackupSection(null); setIsBackupSecurityOpen(false); setIsSettingsMenuOpen(true); }} onOpenBackup={section => { setIsSettingsMenuOpen(false); setIsBackupSecurityOpen(false); setBackupSection(section); }} userFeedbackReplyCount={userFeedbackReplyCount} onOpenFeedback={() => { void (async () => { const ipc = getElectronIpc(); const shot = ipc ? await ipc.invoke('eteczka-capture-screenshot').catch(() => null) as { dataUrl?: string; appVersion?: string; platform?: string } | null : null; setFeedbackDraft({ screenshot: shot?.dataUrl || null, appVersion: shot?.appVersion, platform: shot?.platform }); })(); }} />
      {isDeleteAccountOpen && session.currentUser && (
        <DeleteAccountModal
          apiUrl={API_URL}
          fetcher={apiFetch}
          userEmail={session.currentUser.email}
          onClose={() => setIsDeleteAccountOpen(false)}
          onErased={notice => {
            setIsDeleteAccountOpen(false);
            if (notice) showToast(notice, 'success', 7000);
            void session.logoutAccount();
          }}
        />
      )}
      {session.isCloseModalOpen && <CloseAppModal onMinimize={() => { session.setIsCloseModalOpen(false); void getElectronIpc()?.invoke('eteczka-minimize-to-tray'); }} onQuit={() => { session.setIsCloseModalOpen(false); void getElectronIpc()?.invoke('eteczka-quit-app'); }} onCancel={() => session.setIsCloseModalOpen(false)} />}
      {isAccessSettingsOpen && <DesktopAccessSettings onClose={() => setIsAccessSettingsOpen(false)} />}

      <div className="cyber-dashboard-bg flex flex-1 flex-col overflow-hidden bg-[#0f172a]">
        <DesktopTopBar
          activeView={activeView} scannerFileCount={scannerFiles.length} retentionAlerts={retentionAlerts}
          notificationsOpen={isNotificationsOpen} userMenuOpen={session.isUserMenuOpen} currentUser={session.currentUser}
          billingPlan={billing.billingPlan} billingIsDev={billing.billingIsDev} apiUrl={API_URL} apiFetcher={apiFetch}
          onDevPlanChanged={() => { billing.setBillingDetails(null); void fetchData(); }}
          billingDetails={billing.billingDetails} billingDetailsBusy={billing.billingDetailsBusy} billingBusy={billing.billingBusy} billingCancelBusy={billing.billingCancelBusy}
          onBack={() => { setActiveView('dashboard'); setSelectedFolderId(null); setSearchQuery(''); }}
          onToggleNotifications={() => setIsNotificationsOpen(v => !v)}
          onOpenScannerInbox={() => { void scanner.openWiaScanner(); setIsNotificationsOpen(false); }}
          onOpenNotification={documentId => { const doc = documents.find(item => item.id === documentId); if (doc) { setSelectedFolderId(doc.folderId); setActiveView('folder'); } setIsNotificationsOpen(false); }}
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
          showNotificationsInTopBar={notificationsInTopBar}
          onToggleNotificationsInTopBar={setNotificationsDockMode}
          onToggleMobileSidebar={() => setMobileSidebarOpen(v => !v)}
          updateAvailable={Boolean(appUpdate.availableUpdate && !testerConsent.needsConsent)}
          onOpenUpdatePrompt={() => setIsUpdateModalOpen(true)}
          openBugCount={openBugCount}
          adminReplyCount={adminReplyCount}
          onOpenDeveloperFeedback={() => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); setDevSection('feedback'); setActiveView('developer'); }}
          onOpenDeveloper={() => { setIsSettingsMenuOpen(false); setBackupSection(null); setIsBackupSecurityOpen(false); setDevSection(null); setActiveView('developer'); }}
        />
        {billing.billingPlan !== 'premium' && <PromotionBanner apiUrl={API_URL} fetcher={apiFetch} currentPlan={billing.billingPlan} onOpenPlans={() => setIsBillingPlansOpen(true)} />}
        {testerConsent.storageMode === 'local_disk' && testerConsent.diskReconnect.needed && !testerConsent.needsConsent && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-950/40 px-6 py-2.5 text-xs text-amber-100">
            <span>
              Twoja baza jest zapisana lokalnie na dysku{testerConsent.diskReconnect.folderName ? ` (folder: ${testerConsent.diskReconnect.folderName})` : ''}. Przeglądarka wymaga potwierdzenia dostępu w nowej sesji.
            </span>
            <button type="button" disabled={testerConsent.busy} onClick={() => void testerConsent.reconnectDisk()} className="rounded-lg bg-amber-400 px-3 py-1.5 font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50">
              {testerConsent.diskReconnect.folderName ? `Otwórz bazę (${testerConsent.diskReconnect.folderName})` : 'Wybierz folder bazy na dysku'}
            </button>
          </div>
        )}
        <main className="custom-scrollbar relative flex flex-1 justify-center overflow-y-auto p-3 sm:p-6">
          {selectedDocs.length > 0 && (() => {
            const hasReadOnlySelected = documents.some(d => selectedDocs.includes(d.id) && d.readOnly);
            return (
              <div className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100vw-1.5rem)] max-w-3xl -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-slate-600 bg-[#0f172a]/95 px-3 py-2 shadow-2xl backdrop-blur sm:w-auto sm:gap-2 sm:px-4 sm:py-2.5">
                <span className="mr-1 text-xs font-bold text-slate-300">Zaznaczono: {selectedDocs.length}</span>
                <button type="button" disabled={hasReadOnlySelected && (activeView === 'trash' || activeView === 'archive')} onClick={() => setIsBulkMoveOpen(true)} className="rounded-lg border border-indigo-500/70 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40">{activeView === 'trash' || activeView === 'archive' ? 'Przywróć do kartoteki' : 'Przenieś'}</button>
                {activeView !== 'trash' && activeView !== 'archive' && <button type="button" onClick={() => actions.initiateAction('bulk_archive', 0, String(selectedDocs.length))} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500">Archiwizuj</button>}
                {activeView === 'trash'
                  ? <button type="button" onClick={() => actions.initiateAction('bulk_delete', 0, String(selectedDocs.length))} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500">Usuń trwale</button>
                  : <button type="button" onClick={() => actions.initiateAction('bulk_trash', 0, String(selectedDocs.length))} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500">Do kosza</button>}
                <button type="button" onClick={actions.clearSelectedDocs} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Odznacz</button>
              </div>
            );
          })()}
          {isSettingsMenuOpen ? (
            <SettingsDialog embedded isPremiumPlan={billing.billingPlan === 'premium'} onClose={() => setIsSettingsMenuOpen(false)} onPair={() => pairing.setIsPairingGuideOpen(true)} onSecurity={() => setIsAccessSettingsOpen(true)} onTags={() => setIsTagManagerOpen(true)} onBackup={() => setBackupSection('settings')} onBackupSecurity={() => setIsBackupSecurityOpen(true)} onSelfHostGuide={() => setIsSelfHostGuideOpen(true)} onDeleteAccount={() => setIsDeleteAccountOpen(true)} onLogout={() => void session.logoutAccount()} />
          ) : backupSection ? (
            <BackupModal embedded key={backupSection} section={backupSection} apiUrl={API_URL} fetcher={apiFetch} onClose={() => setBackupSection(null)} onDone={msg => { setBackupSection(null); if (msg) showToast(msg, 'success', 6000); void fetchData(); }} />
          ) : isBackupSecurityOpen ? (
            <BackupSecurityModal embedded apiUrl={API_URL} fetcher={fetch} onClose={() => setIsBackupSecurityOpen(false)} />
          ) : activeView === 'developer' ? (
            <DeveloperPanel embedded initialSection={devSection} openBugCount={openBugCount} adminReplyCount={adminReplyCount} onOpenBugCountChange={updateOpenBugCount} onAdminReplyCountChange={setAdminReplyCount} onClose={() => setActiveView('dashboard')} />
          ) : activeView === 'scanner' ? (
            <PrinterScannerModal
              devices={scanner.wiaDevices} loadingDevices={scanner.isWiaLoadingDevices} deviceId={scanner.wiaDeviceId} folderId={scanner.wiaFolderId}
              folderOptions={renderSelectOptions()} pages={scanner.wiaPages} title={scanner.wiaTitle}
              retentionValue={scanner.wiaRetentionValue} retentionUnit={scanner.wiaRetentionUnit} retentionEnabled={scanner.wiaRetentionEnabled}
              stage={scanner.wiaStage} busy={scanner.isWiaScanning} pendingScan={Boolean(scanner.wiaPendingScanPath)}
              onDeviceChange={id => { scanner.setWiaDeviceId(id); localStorage.setItem('eteczka_default_scanner', id); }}
              onFolderChange={scanner.setWiaFolderId} onTitleChange={scanner.setWiaTitle}
              onRetentionValueChange={scanner.setWiaRetentionValue} onRetentionUnitChange={scanner.setWiaRetentionUnit} onRetentionEnabledChange={scanner.setWiaRetentionEnabled}
              onScan={() => void scanner.scanFromPrinter()}
              onRemovePage={index => scanner.setWiaPages(prev => prev.filter((_, pageIndex) => pageIndex !== index))}
              inbox={scannerFiles} onSave={() => void scanner.savePrinterDocument()} onMove={id => void scanner.moveInboxScan(id)}
              onRename={scanner.renameInboxScan} onClose={() => setActiveView('dashboard')}
            />
          ) : activeView === 'upload' ? (
            <UploadPanel
              uploadUsage={batchUpload.uploadUsage} uploadDocsExceeded={batchUpload.uploadDocsExceeded} uploadMergeExceeded={batchUpload.uploadMergeExceeded}
              uploadDocsRemaining={batchUpload.uploadDocsRemaining} uploadMergeRemaining={batchUpload.uploadMergeRemaining} neededUploadDocs={batchUpload.neededUploadDocs}
              folderId={batchUpload.folderId} setFolderId={batchUpload.setFolderId} folderOptions={renderSelectOptions()}
              physicalLocation={batchUpload.physicalLocation} setPhysicalLocation={batchUpload.setPhysicalLocation} foldersUnavailable={foldersUnavailable}
              filesToUpload={batchUpload.filesToUpload} setFilesToUpload={batchUpload.setFilesToUpload}
              isMergeMode={batchUpload.isMergeMode} setIsMergeMode={batchUpload.setIsMergeMode} isUploading={batchUpload.isUploading}
              mergedTitle={batchUpload.mergedTitle} setMergedTitle={batchUpload.setMergedTitle}
              mergedRetentionVal={batchUpload.mergedRetentionVal} setMergedRetentionVal={batchUpload.setMergedRetentionVal}
              mergedRetentionUnit={batchUpload.mergedRetentionUnit} setMergedRetentionUnit={batchUpload.setMergedRetentionUnit}
              mergedRetentionEnabled={batchUpload.mergedRetentionEnabled} setMergedRetentionEnabled={batchUpload.setMergedRetentionEnabled}
              onFileSelect={batchUpload.handleFileSelect} onSubmit={batchUpload.handleBatchUpload}
              onOpenPlans={() => setIsBillingPlansOpen(true)} onRetryFetch={() => void fetchData()}
            />
          ) : (
            <div className="w-full">
              {activeView !== 'analytics' && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <span className="flex shrink-0 items-center text-2xl sm:text-3xl">{activeView === 'trash' ? '🗑️' : activeView === 'archive' ? '📦' : <AppFolderIcon size="md" />}</span>
                    <h2 className="truncate text-xl font-bold tracking-wide text-white sm:text-2xl">
                      {activeView === 'dashboard' ? 'Kartoteki' : activeView === 'trash' ? 'Kosz' : activeView === 'archive' ? 'Archiwum Systemowe' : (folders.find(f => f.id === selectedFolderId)?.name || 'Kartoteka')}
                    </h2>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    {['dashboard', 'folder', 'trash', 'archive'].includes(activeView) && (
                      <div className="relative flex-1 sm:flex-initial">
                        <input
                          type="text"
                          placeholder="Szukaj nazwy lub tekstu dokumentu…"
                          title="Wpisz słowo z nazwy lub treści dokumentu po rozpoznaniu OCR"
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          className="cyber-input w-full rounded-md border border-slate-600 bg-[#111827] px-3 py-2 pr-7 text-sm text-slate-200 focus:border-blue-500 focus:outline-none sm:w-72"
                        />
                        {searchQuery && (
                          <button type="button" onClick={() => setSearchQuery('')} aria-label="Wyczyść wyszukiwanie" className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white">
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                    {activeView === 'trash' && displayedDocs.length > 0 && <button onClick={() => actions.initiateAction('empty_trash', 0, String(displayedDocs.length))} className="rounded-md border border-red-500 px-4 py-2 text-sm font-bold text-red-300 hover:bg-red-900/40">Opróżnij kosz</button>}
                    {activeView === 'folder' && selectedFolderId && folders.some(folder => folder.id === selectedFolderId) && <button onClick={() => { batchUpload.setFolderId(String(selectedFolderId)); setActiveView('upload'); }} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">＋ Dodaj dokument</button>}
                  </div>
                </div>
              )}
              {activeView === 'analytics' && !searchQuery.trim() ? (
                <AnalyticsDashboard
                  apiUrl={API_URL}
                  fetcher={fetch}
                  scannerFileCount={scannerFiles.length}
                  onOpenScanner={() => void scanner.openWiaScanner()}
                  onOpenDocument={docId => {
                    const doc = documents.find(item => item.id === docId);
                    if (doc) { setPreviewDoc(doc); setPreviewZoom(1); }
                  }}
                />
              ) : activeView === 'dashboard' && !searchQuery.trim() ? (
                <FoldersDesktop
                  apiUrl={API_URL} fetcher={fetch} plan={billing.billingPlan} folders={folders} documents={documents}
                  accountEmail={session.currentUser?.email || ''} selectedDocs={selectedDocs}
                  onToggleSelect={actions.toggleDocSelection} onSelectAllVisible={setSelectedDocs} onClearSelected={actions.clearSelectedDocs}
                  onOpenFolder={id => { setSelectedFolderId(id); setActiveView('folder'); }}
                  onOpenPreview={doc => { setPreviewDoc(doc); setPreviewZoom(1); setHoverDocId(null); }}
                  onHoverEnter={(doc, anchor) => { setHoverAnchor(anchor); handleHoverEnter(doc.id); }} onHoverLeave={handleHoverLeave}
                  onCreateFolder={async (name, parentId) => { const res = await createFolder(API_URL, fetch, name, parentId); if (res.ok) { const created = await res.json().catch(() => null) as { id?: number } | null; await fetchData(); showToast('Utworzono kartotekę.', 'success'); return typeof created?.id === 'number' ? created.id : null; } showToast('Nie udało się utworzyć kartoteki.', 'error'); return null; }}
                  onDiscardEmptyFolder={async id => { await fetch(`${API_URL}/api/folders/${id}/delete-safely`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'trash' }) }); await fetchData(); }}
                  onRenameFolder={async (id, name) => { const res = await renameFolder(API_URL, fetch, id, name); if (res.ok) { await fetchData(); showToast('Zmieniono nazwę.', 'success'); } else showToast('Błąd zmiany nazwy.', 'error'); }}
                  onDeleteFolder={(id, name) => { void actions.requestFolderDelete(id, name); }}
                  onReorderFolders={async orderedIds => { const res = await reorderFolders(API_URL, fetch, orderedIds); if (res.ok) await fetchData(); }}
                  onMoveFolderParent={async (id, parentId) => { const res = await moveFolderToParent(API_URL, fetch, id, parentId); if (res.ok) { await fetchData(); showToast('Przeniesiono kartotekę.', 'success'); } else showToast('Nie można przenieść kartoteki.', 'error'); }}
                  onMoveDocument={async (docId, targetFolderId) => { await actions.updateDocument(docId, { folderId: targetFolderId }); }}
                  onUploadToFolder={targetId => { batchUpload.setFolderId(String(targetId)); setActiveView('upload'); }}
                  onTrashDoc={doc => actions.initiateAction('trash_doc', doc.id, doc.title)}
                  onShareLink={doc => setSecureShareId(doc.id)}
                  onShareClassic={doc => { void shareDocumentClassic(API_URL, apiFetch, doc).then(mode => showToast(mode === 'shared' ? 'Udostępniono dokument.' : 'Pobrano dokument na dysk do wysłania.', 'success')).catch(error => { if ((error as { name?: string })?.name !== 'AbortError') showToast(errorMessage(error, 'Nie udało się udostępnić dokumentu.'), 'error'); }); }}
                  onOpenOcr={doc => setOcrDocumentId(doc.id)}
                  onExportPdf={(doc, watermark) => void actions.exportDocumentPdf(doc, watermark)}
                  onPropertiesDoc={setPropertiesDoc}
                  onEditRetention={doc => actions.setRetentionModal({ isOpen: true, docId: doc.id, value: doc.retentionValue || 5, unit: doc.retentionUnit || 'years', enabled: doc.retentionEnabled !== false })}
                />
              ) : activeView === 'archive' && !searchQuery.trim() ? (
                <ArchiveDesktop
                  apiUrl={API_URL} fetcher={fetch} plan={billing.billingPlan} documents={displayedDocs} selectedDocs={selectedDocs}
                  onToggleSelect={actions.toggleDocSelection} onSelectAllVisible={setSelectedDocs} onClearSelected={actions.clearSelectedDocs}
                  onOpenPreview={doc => { setPreviewDoc(doc); setPreviewZoom(1); setHoverDocId(null); }}
                  onHoverEnter={(doc, anchor) => { setHoverAnchor(anchor); handleHoverEnter(doc.id); }} onHoverLeave={handleHoverLeave}
                  onRestore={doc => actions.beginRestore(doc, 'archive')}
                  onTrashDocs={(docIds, onConfirmed) => actions.initiateAction('bulk_trash', 0, String(docIds.length), null, 0, 0, { docIds, onAfter: onConfirmed })}
                  onShareLink={doc => setSecureShareId(doc.id)}
                  onShareClassic={doc => { void shareDocumentClassic(API_URL, apiFetch, doc).then(mode => showToast(mode === 'shared' ? 'Udostępniono dokument.' : 'Pobrano dokument na dysk do wysłania.', 'success')).catch(error => { if ((error as { name?: string })?.name !== 'AbortError') showToast(errorMessage(error, 'Nie udało się udostępnić dokumentu.'), 'error'); }); }}
                  onOpenOcr={doc => setOcrDocumentId(doc.id)}
                  onExportPdf={(doc, watermark) => void actions.exportDocumentPdf(doc, watermark)}
                  onPropertiesDoc={setPropertiesDoc}
                />
              ) : activeView === 'trash' && !searchQuery.trim() ? (
                <TrashDesktop
                  apiUrl={API_URL} fetcher={fetch} documents={displayedDocs} selectedDocs={selectedDocs}
                  onToggleSelect={actions.toggleDocSelection} onSelectAllVisible={setSelectedDocs} onClearSelected={actions.clearSelectedDocs}
                  onOpenPreview={doc => { setPreviewDoc(doc); setPreviewZoom(1); setHoverDocId(null); }}
                  onHoverEnter={(doc, anchor) => { setHoverAnchor(anchor); handleHoverEnter(doc.id); }} onHoverLeave={handleHoverLeave}
                  onRestore={doc => actions.beginRestore(doc, 'trash')} onDeletePermanently={doc => actions.initiateAction('delete_doc', doc.id, doc.title)}
                />
              ) : (
                <DocumentTableView
                  apiUrl={API_URL} fetcher={fetch} activeView={activeView} documents={documents} displayedDocs={displayedDocs}
                  selectedDocs={selectedDocs} tags={tags} documentMenuId={documentMenuId} setDocumentMenuId={setDocumentMenuId}
                  renamingDocId={renamingDocId} setRenamingDocId={setRenamingDocId} renamingDocTitle={renamingDocTitle} setRenamingDocTitle={setRenamingDocTitle}
                  onToggleSelect={actions.toggleDocSelection} onSelectAllVisible={() => setSelectedDocs(displayedDocs.map(d => d.id))}
                  onClearSelected={actions.clearSelectedDocs}
                  onOpenBulkMove={() => setIsBulkMoveOpen(true)} onInitiateAction={(type, id, name) => actions.initiateAction(type, id, name)}
                  onOpenPreview={doc => { setPreviewDoc(doc); setPreviewZoom(1); setHoverDocId(null); }}
                  onHoverEnter={(doc, anchor) => { setHoverAnchor(anchor); handleHoverEnter(doc.id); }} onHoverLeave={handleHoverLeave}
                  onUpdateDocument={actions.updateDocument} onOpenMoveModal={setMoveModalDocId} onBeginRestore={actions.beginRestore}
                  onEditRetention={doc => actions.setRetentionModal({ isOpen: true, docId: doc.id, value: doc.retentionValue || 5, unit: doc.retentionUnit || 'years', enabled: doc.retentionEnabled !== false })}
                  onOpenSecureShare={setSecureShareId} onOpenOcr={setOcrDocumentId} onExportPdf={(doc, watermark) => void actions.exportDocumentPdf(doc, watermark)} onPropertiesDoc={setPropertiesDoc} showToast={showToast}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {!notificationsInTopBar && (
        <SideNotificationsDrawer
          open={isNotificationsOpen}
          scannerFileCount={scannerFiles.length}
          retentionAlerts={retentionAlerts}
          onToggleOpen={() => setIsNotificationsOpen(v => !v)}
          onOpenScannerInbox={() => { void scanner.openWiaScanner(); setIsNotificationsOpen(false); }}
          onOpenNotification={documentId => { const doc = documents.find(item => item.id === documentId); if (doc) { setSelectedFolderId(doc.folderId); setActiveView('folder'); } setIsNotificationsOpen(false); }}
          onRestoreToTopBar={() => setNotificationsDockMode(true)}
        />
      )}
      {session.isAuthOpen && <AuthModal onClose={() => session.setIsAuthOpen(false)} onAuthenticated={session.handleAuthenticated} />}
      {isBillingPlansOpen && (
        <BillingPlansModal
          apiUrl={API_URL} fetcher={apiFetch} busy={billing.billingBusy} currentPlan={billing.billingPlan} developmentOverride={billing.billingIsDev}
          cancellationScheduled={billing.billingDetails?.cancellationScheduled === true}
          onSelectFree={() => {
            if (billing.billingIsDev) {
              void (async () => {
                try {
                  const response = await apiFetch(`${API_URL}/api/dev/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'free' }) });
                  if (!response.ok) throw new Error('Nie udało się zmienić planu testowego.');
                  setIsBillingPlansOpen(false); billing.setBillingDetails(null); await fetchData(); showToast('Wybrano testowy plan Darmowy.');
                } catch (error) { showToast(errorMessage(error), 'error'); }
              })();
            } else { setIsBillingPlansOpen(false); void billing.openBillingCancel(); }
          }}
          onClose={() => setIsBillingPlansOpen(false)}
          onSelect={(plan, interval) => {
            if (billing.billingDetails?.cancellationScheduled) {
              const amount = plan === 'standard' ? (interval === 'yearly' ? '49,90 zł za rok' : '4,99 zł miesięcznie') : (interval === 'yearly' ? '99,90 zł za rok' : '9,99 zł miesięcznie');
              const end = billing.billingDetails.renewalAt ? new Date(billing.billingDetails.renewalAt).toLocaleDateString('pl-PL') : 'końca opłaconego okresu';
              if (!window.confirm(`Obecny plan pozostaje opłacony do ${end}. Nowy plan zacznie działać od razu, a nowa płatność (${amount}) zostanie pobrana po jej zatwierdzeniu w Stripe. Niewykorzystana część bieżącego miesiąca nie zostanie ponownie rozliczona. Czy chcesz kontynuować?`)) return;
            }
            setIsBillingPlansOpen(false);
            void billing.openBillingCheckout(plan, interval, billing.billingDetails?.cancellationScheduled === true);
          }}
        />
      )}
      {session.currentUser && <MobileOnboarding key={session.currentUser.email} email={session.currentUser.email} phoneConnected={pairing.phoneConnected} onPair={() => pairing.setIsPairingGuideOpen(true)} />}
      {pairing.isPairingGuideOpen && (
        <PairingGuideModal
          localAddresses={pairing.localAddresses} pairingCode={pairing.pairingCode} phoneConnected={pairing.phoneConnected}
          pairingLimit={pairing.pairingLimit} pairedPhones={pairing.pairedPhones} replacementBusy={pairing.replacementBusy}
          replacementNotice={pairing.replacementNotice} localCaFingerprint={pairing.localCaFingerprint}
          onReplacePhone={id => void pairing.replacePhone(id)} onClose={() => pairing.setIsPairingGuideOpen(false)}
        />
      )}
    </div>
  );
}
