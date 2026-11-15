import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'react-qr-code';
import DesktopAccessSettings from './DesktopAccessSettings';
import DocumentPreviewModal from './components/DocumentPreviewModal';
import DocumentThumbnail from './components/DocumentThumbnail';
import HoverDocumentPreview from './components/HoverDocumentPreview';
import PrinterScannerModal, { type InboxScan } from './components/PrinterScannerModal';
import DesktopSidebar from './components/DesktopSidebar';
import DesktopTopBar from './components/DesktopTopBar';
import BillingHistoryModal from './components/BillingHistoryModal';
import PlanUsageModal from './components/PlanUsageModal';
import SecureShareModal from './components/SecureShareModal';
import PlanLimitModal from './components/PlanLimitModal';
import AuthModal from './components/AuthModal';
import SettingsDialog from './components/SettingsDialog';
import MobileOnboarding from './components/MobileOnboarding';
import MobileAppDownload from './components/MobileAppDownload';
import WelcomeScreen from './components/WelcomeScreen';
import BillingPlansModal from './components/BillingPlansModalV2';
import BackupModal, { type BackupSection } from './components/BackupModal';
import OcrPanel from './components/OcrPanel';
import TagManagerModal from './components/TagManagerModal';
import RetentionModal, { type RetentionModalState } from './components/RetentionModal';
import MoveDocumentModal from './components/MoveDocumentModal';
import DestructiveActionModal, { type PendingAction } from './components/DestructiveActionModal';
import BulkMoveModal, { type BulkRetention } from './components/BulkMoveModal';
import { formatFileSize, getExpiryDate } from './utils/documentLifecycle';
import { errorMessage } from './utils/errors';
import type { DocumentPatch, DocumentRecord, FolderRecord, RetentionUnit, Tag } from './types/domain';
import { getElectronIpc, isWiaDeviceList, isWiaScanResult, readScanFileBase64, removeTemporaryScan, type WiaDevice } from './services/electron';
import { confirmCheckout, getBillingStatus, startCheckout, type BillingDetails, type BillingTransaction } from './services/billing';
import { generatePdfThumbnail, prepareUploadFiles, uploadDocuments, type UploadItem } from './services/documentUpload';
import { buildFolderOptions, sortedChildren } from './utils/folderTree';
import { getRetentionAlerts } from './services/retentionAlerts';
import { deleteDocument, exportDocuments, patchDocument } from './services/documentApi';
import { createFolder, moveFolderRequest, renameFolder } from './services/folderApi';
import { preparePrinterPage, uploadPrinterDocument, type PrinterPage } from './services/scannerApi';
import { createTag as createTagRequest, deleteTag as deleteTagRequest } from './services/tagApi';
import { deleteFolderSafely, getFolderDeletePreview } from './services/folderActions';
import { resolveApiBase } from './services/apiBase';

const API_URL = resolveApiBase(window.location, import.meta.env.VITE_API_URL);
const defaultPrinterScanTitle = () => `Skan drukarki ${new Date().toLocaleString('pl-PL')}`;
const apiFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const requestUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, window.location.href);
  const token = localStorage.getItem('eteczka_auth_token');
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  if (token && requestUrl.origin === new URL(API_URL).origin) headers.set('Authorization', `Bearer ${token}`);
  const response = await window.fetch(input, { ...init, headers });
  if (token && response.status === 401 && requestUrl.origin === new URL(API_URL).origin) { localStorage.removeItem('eteczka_auth_token'); window.dispatchEvent(new Event('eteczka-auth-changed')); }
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (requestUrl.origin === new URL(API_URL).origin && (method !== 'GET' || /\/api\/backup\/oauth\/[^/]+\/start$/.test(requestUrl.pathname)) && (response.status === 403 || response.status === 402)) {
    const data = await response.clone().json().catch(() => ({})) as { code?: string; error?: string; resetsAt?: string };
    if (['PLAN_LIMIT_REACHED', 'OCR_UNAVAILABLE', 'PREMIUM_REQUIRED', 'DEVICE_LIMIT_REACHED'].includes(data.code || '')) {
      const renewal = data.resetsAt ? ` Najbliższe zwolnienie limitu: ${new Date(data.resetsAt).toLocaleString('pl-PL')}.` : '';
      window.dispatchEvent(new CustomEvent('eteczka-plan-limit', { detail: (data.error || 'Limit Twojego planu został wykorzystany.') + renewal }));
    }
  }
  return response;
};
type ActionType = 'trash_doc' | 'delete_doc' | 'delete_folder' | 'empty_trash';
export default function App() {
  const fetch = apiFetch;
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [foldersUnavailable, setFoldersUnavailable] = useState(false);
  const [scannerFiles, setScannerFiles] = useState<InboxScan[]>([]);
  
  const [filesToUpload, setFilesToUpload] = useState<UploadItem[]>([]);
  const [uploadReport, setUploadReport] = useState<{ saved: number; folder: string; skipped: Array<{ name: string; existingTitle: string }> } | null>(null);
  const [folderId, setFolderId] = useState<string>('');
  const [physicalLocation, setPhysicalLocation] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isMergeMode, setIsMergeMode] = useState<boolean>(false);
  const [mergedTitle, setMergedTitle] = useState<string>('');
  const [mergedRetentionEnabled, setMergedRetentionEnabled] = useState<boolean>(true);
  const [mergedRetentionVal, setMergedRetentionVal] = useState<number>(5);
  const [mergedRetentionUnit, setMergedRetentionUnit] = useState<RetentionUnit>('years');
  
  const [activeView, setActiveView] = useState<string>('dashboard');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [ocrSearchIds, setOcrSearchIds] = useState<number[]>([]);
  const [ocrDocumentId, setOcrDocumentId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  
  const [previewDoc, setPreviewDoc] = useState<DocumentRecord | null>(null);
  const [previewZoom, setPreviewZoom] = useState<number>(1);
  const [hoverDocId, setHoverDocId] = useState<number | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<number[]>([]);
  const [documentMenuId, setDocumentMenuId] = useState<number | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#2563eb');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ name?: string | null; email: string } | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('eteczka_auth_token'));
  const [isBillingPlansOpen, setIsBillingPlansOpen] = useState(false);
  const [isPlanUsageOpen, setIsPlanUsageOpen] = useState(false);
  const [secureShareId, setSecureShareId] = useState<number | null>(null);
  const [planLimitMessage, setPlanLimitMessage] = useState('');
  useEffect(() => { const handler = (event: Event) => setPlanLimitMessage(String((event as CustomEvent<string>).detail)); window.addEventListener('eteczka-plan-limit', handler); return () => window.removeEventListener('eteczka-plan-limit', handler); }, []);
  const [billingIsDev, setBillingIsDev] = useState(false);
  const [billingPlan, setBillingPlan] = useState<'free' | 'standard' | 'premium'>('free');
  const [billingDetails, setBillingDetails] = useState<BillingDetails | null>(null);
  const [billingDetailsBusy, setBillingDetailsBusy] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingCancelBusy, setBillingCancelBusy] = useState(false);
  const [isBillingCancelOpen, setIsBillingCancelOpen] = useState(false);
  const [billingCancelPreview, setBillingCancelPreview] = useState<{ accessUntil: string; refundedAmount: number; refundedMonths: number; currency: string; alreadyScheduled: boolean; restrictedDocuments: number; inactiveTags: number } | null>(null);
  const [billingCancelPreviewError, setBillingCancelPreviewError] = useState('');
  const [billingCancelPreviewBusy, setBillingCancelPreviewBusy] = useState(false);
  const [isBillingHistoryOpen, setIsBillingHistoryOpen] = useState(false);
  const [backupSection, setBackupSection] = useState<BackupSection | null>(null);
  const [billingHistory, setBillingHistory] = useState<BillingTransaction[]>([]);
  const [billingHistoryBusy, setBillingHistoryBusy] = useState(false);
  
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [pairingCode, setPairingCode] = useState<string>('');
  const [localAddresses, setLocalAddresses] = useState<string[]>([]);
  const [localCaFingerprint, setLocalCaFingerprint] = useState('');
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [isPairingGuideOpen, setIsPairingGuideOpen] = useState<boolean>(false);
  
  const [renamingDocId, setRenamingDocId] = useState<number | null>(null);
  const [renamingDocTitle, setRenamingDocTitle] = useState<string>('');
  const [moveModalDocId, setMoveModalDocId] = useState<number | null>(null);
  const [isBulkMoveOpen, setIsBulkMoveOpen] = useState(false);
  const [retentionModal, setRetentionModal] = useState<RetentionModalState>({ isOpen: false, docId: null, value: 5, unit: 'years', enabled: true });

  const [isEditingFolders, setIsEditingFolders] = useState<boolean>(false);
  const [expandedFolders, setExpandedFolders] = useState<number[]>([]);
  const [addingSubfolderTo, setAddingSubfolderTo] = useState<number | 'root' | null>(null);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState<string>('');
  
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionTimer, setActionTimer] = useState<number | null>(null);
  const [folderDeletePreview, setFolderDeletePreview] = useState<{ id: number; name: string; documentCount: number; archivedCount: number; trashedCount: number } | null>(null);
  const [transferFolderId, setTransferFolderId] = useState('');
  const [isAccessSettingsOpen, setIsAccessSettingsOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [wiaFolderId, setWiaFolderId] = useState('');
  const [wiaDevices, setWiaDevices] = useState<WiaDevice[]>([]);
  const [wiaDeviceId, setWiaDeviceId] = useState('');
  const [isWiaLoadingDevices, setIsWiaLoadingDevices] = useState(false);
  const [isWiaScanning, setIsWiaScanning] = useState(false);
  const [wiaStage, setWiaStage] = useState('');
  const [wiaPendingScanPath, setWiaPendingScanPath] = useState<string | null>(null);
  const [wiaPages, setWiaPages] = useState<PrinterPage[]>([]);
  const [wiaTitle, setWiaTitle] = useState('');
  const [wiaRetentionEnabled, setWiaRetentionEnabled] = useState(true);
  const [wiaRetentionValue, setWiaRetentionValue] = useState(5);
  const [wiaRetentionUnit, setWiaRetentionUnit] = useState<'years' | 'months' | 'days'>('years');

  const hoverTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: string = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); }, []);

  const fetchData = useCallback(async () => {
    const sessionAtStart = localStorage.getItem('eteczka_auth_token');
    try {
      const fetchList = async (path: string): Promise<unknown[] | null> => {
        try {
          const response = await fetch(`${API_URL}${path}`);
          const payload: unknown = await response.json();
          return response.ok && Array.isArray(payload) ? payload : null;
        } catch { return null; }
      };
      const [resDocs, resFolders, resScanner, resTags, resBilling] = await Promise.all([
        fetchList('/api/documents'),
        fetchList('/api/folders'),
        fetchList('/api/scanner'),
        fetchList('/api/tags'),
        getBillingStatus(API_URL, fetch).catch(() => null)
      ]);
      if (localStorage.getItem('eteczka_auth_token') !== sessionAtStart) return;
      if (resDocs) setDocuments(resDocs as DocumentRecord[]);
      if (resFolders) setFolders(resFolders as FolderRecord[]);
      setFoldersUnavailable(resFolders === null);
      if (resScanner) setScannerFiles(resScanner as InboxScan[]);
      if (resTags) setTags(resTags as Tag[]);
      if (resBilling) { setBillingPlan(resBilling.plan === 'premium' || resBilling.plan === 'standard' ? resBilling.plan : 'free'); setBillingIsDev(Boolean(resBilling.developmentOverride)); }
    } catch {}
  }, []);

  const handleAuthenticated = useCallback((user: { name?: string | null; email: string }) => {
    setDocuments([]); setFolders([]); setTags([]); setScannerFiles([]); setSelectedDocs([]); setPreviewDoc(null); setSelectedFolderId(null); setActiveView('dashboard');
    setCurrentUser(user); setIsAuthOpen(false); setIsUserMenuOpen(false); showToast(`Zalogowano jako ${user.email}.`, 'success'); void fetchData();
  }, [fetchData, showToast]);

  useEffect(() => {
    const token = localStorage.getItem('eteczka_auth_token'); if (!token) return;
    let active = true;
    void fetch(`${API_URL}/api/auth/me`).then(async response => {
      if (response.status === 401) { if (localStorage.getItem('eteczka_auth_token') === token) localStorage.removeItem('eteczka_auth_token'); return null; }
      return response.ok ? response.json() : null;
    }).then(user => { if (active && localStorage.getItem('eteczka_auth_token') === token && user && typeof user.email === 'string') setCurrentUser(user); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const logoutAccount = useCallback(async () => {
    try { await fetch(`${API_URL}/api/auth/logout`, { method: 'POST' }); }
    catch { /* Local sign-out remains possible when the server is unavailable. */ }
    finally {
      localStorage.removeItem('eteczka_auth_token'); window.dispatchEvent(new Event('eteczka-auth-changed'));
      setCurrentUser(null); setIsUserMenuOpen(false);
      setDocuments([]); setFolders([]); setTags([]); setScannerFiles([]); setSelectedDocs([]); setPreviewDoc(null); setSelectedFolderId(null); setActiveView('dashboard');
    }
  }, []);

  const openBillingCheckout = useCallback(async (plan: 'standard' | 'premium', interval: 'monthly' | 'yearly', acceptReplacement = false, fromLimit = false) => {
    setBillingBusy(true);
    try {
      const checkout = await startCheckout(API_URL, fetch, plan, interval, acceptReplacement);
      if (checkout.kind === 'upgrade') localStorage.setItem('eteczka_pending_upgrade', String(Date.now()));
      else localStorage.setItem('eteczka_pending_checkout', JSON.stringify({ sessionId: checkout.sessionId, startedAt: Date.now() }));
      window.open(checkout.url, '_blank', 'noopener,noreferrer');
      setIsUserMenuOpen(false);
      showToast('Otworzono bezpieczną stronę płatności Stripe.', 'success');
    } catch (error: unknown) {
      const message = errorMessage(error, 'Nie udało się uruchomić płatności Stripe.');
      if (fromLimit) setPlanLimitMessage(message); else showToast(message, 'error');
    } finally {
      setBillingBusy(false);
    }
  }, [showToast]);

  useEffect(() => {
    let active = true; let busy = false;
    const sync = async () => {
      const started = Number(localStorage.getItem('eteczka_pending_upgrade') || 0);
      if (!started || busy) return;
      if (Date.now() - started > 30 * 60 * 1000) { localStorage.removeItem('eteczka_pending_upgrade'); return; }
      busy = true;
      try { const response = await apiFetch(`${API_URL}/api/billing/sync-upgrade`, { method: 'POST' }); const result = await response.json(); if (active && result.upgraded) { localStorage.removeItem('eteczka_pending_upgrade'); await fetchData(); showToast('Plan Premium jest aktywny.', 'success'); } } catch { /* Spróbuj przy kolejnym odświeżeniu. */ } finally { busy = false; }
    };
    void sync(); const timer = window.setInterval(() => void sync(), 10000); window.addEventListener('focus', sync);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', sync); };
  }, [fetchData, showToast]);

  const toggleUserMenu = useCallback(async () => {
    const willOpen = !isUserMenuOpen;
    setIsUserMenuOpen(willOpen);
    if (!willOpen || billingPlan === 'free') return;
    setBillingDetailsBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/manage`);
      const payload = await response.json().catch(() => null);
      if (response.ok && payload) setBillingDetails(payload as BillingDetails);
    } finally {
      setBillingDetailsBusy(false);
    }
  }, [billingPlan, isUserMenuOpen]);

  const openBillingCancel = useCallback(async () => {
    setIsUserMenuOpen(false);
    setIsBillingCancelOpen(true);
    setBillingCancelPreview(null);
    setBillingCancelPreviewError('');
    setBillingCancelPreviewBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/cancel-preview`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nie udało się obliczyć zwrotu.');
      setBillingCancelPreview(payload);
    } catch (error: unknown) {
      setBillingCancelPreviewError(errorMessage(error, 'Nie udało się obliczyć zwrotu.'));
    } finally {
      setBillingCancelPreviewBusy(false);
    }
  }, []);

  const cancelBilling = useCallback(async () => {
    setBillingCancelBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/cancel-subscription`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nie udało się anulować planu.');
      setBillingDetails(null);
      setIsBillingCancelOpen(false);
      const amount = typeof payload.refundedAmount === 'number' ? (payload.refundedAmount / 100).toFixed(2) : '0.00';
      const months = typeof payload.refundedMonths === 'number' ? payload.refundedMonths : 0;
      const until = payload.accessUntil ? new Date(payload.accessUntil).toLocaleDateString('pl-PL') : 'końca opłaconego miesiąca';
      showToast(months > 0 ? `Odnowienie wyłączone. Dostęp do ${until}. Zwrot ${amount} zł w toku.` : `Odnowienie wyłączone. Dostęp do ${until}.`, 'success');
      await fetchData();
    } catch (error: unknown) {
      showToast(errorMessage(error, 'Nie udało się anulować Premium.'), 'error');
    } finally {
      setBillingCancelBusy(false);
    }
  }, [fetchData, showToast]);

  const openBillingHistory = useCallback(async () => {
    setBillingHistoryBusy(true);
    setIsBillingHistoryOpen(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/history`);
      const payload = await response.json().catch(() => []);
      if (!response.ok) throw new Error(payload.error || 'Nie udało się pobrać historii transakcji.');
      setBillingHistory(Array.isArray(payload) ? payload : []);
    } catch (error: unknown) {
      setBillingHistory([]);
      showToast(errorMessage(error, 'Nie udało się pobrać historii transakcji.'), 'error');
    } finally {
      setBillingHistoryBusy(false);
    }
  }, [showToast]);

  useEffect(() => {
    let confirmingPending = false;
    const confirmPendingCheckout = async () => {
      if (confirmingPending) return;
      const raw = localStorage.getItem('eteczka_pending_checkout');
      if (!raw) return;
      let pending: { sessionId: string; startedAt: number };
      try { pending = JSON.parse(raw); } catch { localStorage.removeItem('eteczka_pending_checkout'); return; }
      if (typeof pending.sessionId !== 'string' || typeof pending.startedAt !== 'number' || Date.now() - pending.startedAt > 60 * 60_000) {
        localStorage.removeItem('eteczka_pending_checkout');
        return;
      }
      confirmingPending = true;
      try {
        await confirmCheckout(API_URL, fetch, pending.sessionId);
        localStorage.removeItem('eteczka_pending_checkout');
        showToast('Płatność potwierdzona. Plan został aktywowany.', 'success');
        await fetchData();
      } catch { /* Payment may still be in progress; retry while the session is recent. */ }
      finally { confirmingPending = false; }
    };
    const params = new URLSearchParams(window.location.search);
    const billingSuccess = params.get('billing') === 'success';
    const sessionId = params.get('session_id');
    if (billingSuccess && sessionId) {
      void (async () => {
        try {
          await confirmCheckout(API_URL, fetch, sessionId);
          window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
          showToast('Płatność potwierdzona. Plan został aktywowany.', 'success');
        } catch (error: unknown) {
          showToast(errorMessage(error, 'Płatność została wykonana, ale potwierdzenie jeszcze trwa.'), 'error');
        } finally {
          await fetchData();
        }
      })();
    }
    const initialFetch = window.setTimeout(() => { void fetchData(); void confirmPendingCheckout(); }, 0);
    const interval = window.setInterval(() => { void fetchData(); }, 5000);
    const pendingInterval = window.setInterval(() => { void confirmPendingCheckout(); }, 10_000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(interval);
      window.clearInterval(pendingInterval);
    };
  }, [fetchData, showToast]);

  useEffect(() => {
    const ipc = getElectronIpc();
    if (!ipc) return;
    const handleStage = (_event: unknown, stage: unknown) => {
      if (typeof stage === 'string') setWiaStage(stage);
    };
    ipc.on('eteczka-wia-status', handleStage);
    return () => ipc.removeListener('eteczka-wia-status', handleStage);
  }, []);

  useEffect(() => {
    const fetchPairingCode = async () => {
      try {
        const response = await fetch(`${API_URL}/api/pairing-code`);
        const data = await response.json();
        setPairingCode(data.code || '');
      } catch { setPairingCode(''); }
    };
    const fetchPairingStatus = async () => { try { const response = await fetch(`${API_URL}/api/pairing-status`); const data = await response.json(); setPhoneConnected(Boolean(data.phoneConnected)); } catch { setPhoneConnected(false); } };
    fetchPairingCode();
    fetchPairingStatus();
    const interval = setInterval(fetchPairingCode, 30000);
    const statusInterval = setInterval(fetchPairingStatus, 5000);
    return () => { clearInterval(interval); clearInterval(statusInterval); };
  }, []);

  useEffect(() => {
    const fetchNetworkInfo = async () => {
      try { const result = await fetch(`${API_URL}/api/local-ca-info`); const info = await result.json(); if (result.ok && typeof info.fingerprint === 'string') setLocalCaFingerprint(info.fingerprint); } catch { setLocalCaFingerprint(''); }
      try {
        const response = await fetch(`${API_URL}/api/network-info`);
        const data = await response.json();
        const port = data.port || 3443;
        setLocalAddresses((data.addresses || []).map((address: string) => `${address}:${port}`));
      } catch { setLocalAddresses([]); }
    };
    fetchNetworkInfo();
    const interval = setInterval(fetchNetworkInfo, 30000);
    return () => clearInterval(interval);
  }, []);

  const retentionAlerts = getRetentionAlerts(documents);
  const createTag = async () => {
    const name = newTagName.trim(); if (!name) return;
    const response = await createTagRequest(API_URL, fetch, name, newTagColor);
    if (!response.ok) { const details = await response.json().catch(() => ({})); if (details.code !== 'PLAN_LIMIT_REACHED') showToast(details.error || 'Nie udało się dodać tagu.', 'error'); return; }
    setNewTagName(''); await fetchData(); showToast('Dodano tag.', 'success');
  };

  const initiateAction = (type: ActionType, id: number, name: string, transferId?: number | null, archivedCount = 0, trashedCount = 0) => { setPendingAction({type, id, name, transferFolderId: transferId, archivedCount, trashedCount}); setActionTimer(5); };

  const requestFolderDelete = async (id: number, name: string) => {
    try {
      const preview = await getFolderDeletePreview(API_URL, fetch, id);
      if (preview.documentCount + preview.archivedCount + preview.trashedCount > 0) {
        setTransferFolderId('');
        setFolderDeletePreview({ id, name, documentCount: preview.documentCount, archivedCount: preview.archivedCount || 0, trashedCount: preview.trashedCount || 0 });
      } else initiateAction('delete_folder', id, name, null, preview.archivedCount || 0, preview.trashedCount || 0);
    } catch (error: unknown) { showToast(errorMessage(error, 'Nie udało się sprawdzić kartoteki.'), 'error'); }
  };

  const executeAction = useCallback(async () => {
    if(!pendingAction) return;
    const {type, id} = pendingAction;
    setPendingAction(null); setActionTimer(null);
    try {
      if (type === 'trash_doc') { const response = await patchDocument(API_URL, fetch, id, { isDeleted: true }); if (!response.ok) throw new Error('Nie udało się przenieść dokumentu do kosza.'); showToast("Przeniesiono do kosza", "success"); }
      else if (type === 'delete_doc') { const response = await deleteDocument(API_URL, fetch, id); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Nie udało się usunąć dokumentu.'); showToast(result.failedFiles ? 'Usunięto dokument z bazy, ale nie udało się usunąć pliku z dysku.' : 'Usunięto trwale', result.failedFiles ? 'error' : 'success'); }
      else if (type === 'empty_trash') { const response = await fetch(`${API_URL}/api/documents/empty-trash`, { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Nie udało się opróżnić kosza.'); clearSelectedDocs(); showToast(result.failedFiles ? `Usunięto ${result.deleted} dokumentów, ale ${result.failedFiles} plików nie udało się usunąć z dysku.` : `Kosz opróżniony: usunięto ${result.deleted} dokumentów.`, result.failedFiles ? 'error' : 'success'); }
      else if (type === 'delete_folder') {
        await deleteFolderSafely(API_URL, fetch, id, pendingAction.transferFolderId);
        showToast(pendingAction.transferFolderId ? 'Dokumenty przeniesiono, a kartotekę usunięto.' : 'Kartoteka usunięta.', 'success');
        setActiveView('dashboard'); setSelectedFolderId(null);
      }
      await fetchData();
    } catch(error: unknown) { showToast(errorMessage(error), "error"); }
  }, [fetchData, pendingAction, showToast]);

  useEffect(() => {
    if (actionTimer === null || actionTimer <= 0) return;
    const timer = window.setTimeout(() => setActionTimer(value => value === null ? null : Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [actionTimer]);

  const updateDocument = async (id: number, data: DocumentPatch) => {
    try {
      const res = await patchDocument(API_URL, fetch, id, data);
      if (!res.ok) throw new Error('Serwer odrzucił zmianę dokumentu.');
      showToast("Wykonano!", "success"); await fetchData();
    } catch { showToast("Błąd zapisu.", "error"); }
  };

  const handleRetentionUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retentionModal.docId) return;
    if (!Number.isSafeInteger(retentionModal.value) || retentionModal.value < 1) { showToast('Podaj dodatnią liczbę całkowitą dla terminu życia.', 'error'); return; }
    if (retentionModal.restoreFrom && !retentionModal.targetFolderId) { showToast('Wybierz podkartotekę docelową.', 'error'); return; }
    try {
      const restoreData = retentionModal.restoreFrom ? { isArchived: false, isDeleted: false, deletedAt: null, folderId: Number(retentionModal.targetFolderId), createdAt: new Date().toISOString() } : {};
      const response = await patchDocument(API_URL, fetch, retentionModal.docId, { ...restoreData, retentionEnabled: retentionModal.enabled, retentionValue: retentionModal.value, retentionUnit: retentionModal.unit });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'Nie udało się zapisać dokumentu.'); }
      setRetentionModal({ ...retentionModal, isOpen: false }); showToast(retentionModal.restoreFrom ? 'Dokument przywrócono.' : 'Zapisano zmianę.', 'success'); await fetchData();
    } catch (error: unknown) { showToast(errorMessage(error, 'Nie udało się zapisać dokumentu.'), 'error'); }
  };

  const beginRestore = (doc: Pick<DocumentRecord, 'id'>, restoreFrom: 'archive' | 'trash') => {
    setRetentionModal({
      isOpen: true,
      docId: doc.id,
      value: 5,
      unit: 'years',
      enabled: true,
      restoreFrom,
      targetFolderId: '',
    });
  };

  const handleBatchUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (filesToUpload.length === 0 || !folderId) return showToast("Wybierz pliki i kartotekę!", "error");
    if (foldersUnavailable) return showToast('Brak połączenia z serwerem. Odśwież kartoteki i spróbuj ponownie.', 'error');
    if (isMergeMode && !mergedTitle) return showToast("Podaj tytuł PDF!", "error");
    setIsUploading(true);
    try {
      const convertedFiles = await prepareUploadFiles(filesToUpload, generatePdfThumbnail);
      const result = await uploadDocuments(API_URL, fetch, convertedFiles, filesToUpload, Number(folderId), { physicalLocation: physicalLocation || null, isMerge: isMergeMode, mergedTitle, mergedRetention: { enabled: mergedRetentionEnabled, value: mergedRetentionVal, unit: mergedRetentionUnit } });
      if (result.skippedDuplicates?.length) setUploadReport({ saved: result.savedDocs?.length || 0, folder: folders.find(folder => folder.id === Number(folderId))?.name || 'wybranej podkartotece', skipped: result.skippedDuplicates });
      else showToast("Wgrano dokumenty.", "success");
      setFilesToUpload([]); setPhysicalLocation(''); setMergedTitle(''); setActiveView('dashboard'); await fetchData();
    } catch (error: unknown) { showToast(errorMessage(error, "Nie udało się wgrać plików."), "error"); }
    finally { setIsUploading(false); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = '';
  };
  const addFiles = useCallback((files: File[]) => {
    const supported = files.filter(file => /\.(pdf|png|jpe?g)$/i.test(file.name));
    if (supported.length) setFilesToUpload(prev => [...prev, ...supported.map(file => ({ file, enabled: true, value: 5, unit: 'years' as RetentionUnit }))]);
    if (supported.length !== files.length) showToast('Pominięto nieobsługiwane pliki. Wybierz PDF, JPG lub PNG.', 'error');
  }, [showToast]);
  useEffect(() => {
    const isFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const over = (event: DragEvent) => { if (isFiles(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } };
    const drop = (event: DragEvent) => {
      if (!isFiles(event)) return;
      if (event.target instanceof HTMLInputElement && event.target.type === 'file') return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.length) return;
      addFiles(files);
      if (activeView === 'folder' && selectedFolderId && folders.some(folder => folder.id === selectedFolderId && folder.parentId !== null)) setFolderId(String(selectedFolderId));
      setActiveView('upload');
    };
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [activeView, selectedFolderId, folders, addFiles]);
  const openWiaScanner = async () => {
    const ipc = getElectronIpc();
    if (!ipc) return showToast('Skanowanie WIA działa w zainstalowanej aplikacji desktopowej.', 'error');
    if (activeView === 'scanner') return;
    setActiveView('scanner'); setWiaStage('Wyszukiwanie skanerów…'); setIsWiaLoadingDevices(true); setWiaDevices([]); setWiaDeviceId('');
    if (!wiaPages.length && !wiaPendingScanPath) setWiaTitle(defaultPrinterScanTitle());
    try {
      const response = await ipc.invoke('eteczka-wia-devices');
      const devices = isWiaDeviceList(response) ? response : [];
      setWiaDevices(devices);
      const remembered = localStorage.getItem('eteczka_default_scanner');
      const defaultPrinter = await ipc.invoke('eteczka-default-printer');
      const printerName = typeof defaultPrinter === 'string' ? defaultPrinter.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(series|lan|network|usb)$/g, '') : '';
      const match = devices.find(device => device.id === remembered) || (printerName ? devices.find(device => { const name = device.name.toLowerCase().replace(/\s*\[.*$/, '').replace(/[^a-z0-9]/g, '').replace(/(series|lan|network|usb)$/g, ''); return name.length > 5 && (printerName.includes(name) || name.includes(printerName)); }) : undefined) || (devices.length === 1 ? devices[0] : undefined);
      if (match) setWiaDeviceId(match.id);
      setWiaStage(devices.length ? 'Wybierz skaner i kartotekę docelową.' : 'Nie znaleziono skanera WIA.');
    } catch (error: unknown) { setWiaStage(errorMessage(error, 'Nie udało się odczytać listy skanerów.')); }
    finally { setIsWiaLoadingDevices(false); }
  };

  const scanFromPrinter = async () => {
    if (!wiaDeviceId && !wiaPendingScanPath) return showToast('Wybierz skaner.', 'error');
    if (wiaPages.length >= 20) return showToast('Jeden dokument może mieć najwyżej 20 stron.', 'error');
    const ipc = getElectronIpc();
    if (!ipc) return showToast('Skanowanie WIA działa w zainstalowanej aplikacji desktopowej.', 'error');
    setIsWiaScanning(true); setWiaStage(`Skanowanie strony ${wiaPages.length + 1}…`);
    let scanPath = wiaPendingScanPath;
    try {
      if (!scanPath) {
        const scanResponse = await ipc.invoke('eteczka-wia-scan', wiaDeviceId);
        if (!isWiaScanResult(scanResponse)) throw new Error('Nieprawidłowa odpowiedź skanera.');
        if (!scanResponse.ok || !scanResponse.path) throw new Error('Nie odebrano obrazu ze skanera.');
        scanPath = scanResponse.path;
        setWiaPendingScanPath(scanPath);
      }
      setWiaStage('Zmniejszanie rozmiaru strony…');
      const base64 = readScanFileBase64(scanPath);
      const page = await preparePrinterPage(base64);
      setWiaPages(previous => [...previous, page]);
      removeTemporaryScan(scanPath); setWiaPendingScanPath(null);
      setWiaStage(`Dodano stronę ${wiaPages.length + 1}. Skanuj następną albo zapisz PDF.`);
    } catch (error: unknown) {
      const message = errorMessage(error, 'Nie udało się zeskanować dokumentu.');
      setWiaStage(`Błąd: ${message}${scanPath ? ' Ponów dodanie strony bez ponownego skanowania.' : ''}`);
      showToast(message, 'error');
    }
    finally { setIsWiaScanning(false); }
  };
  const savePrinterDocument = async () => {
    if (!wiaPages.length) return;
    setIsWiaScanning(true); setWiaStage('Łączenie stron i zapisywanie PDF…');
    try {
      const result = await uploadPrinterDocument(API_URL, fetch, wiaPages, wiaTitle, { enabled: wiaRetentionEnabled, value: wiaRetentionValue, unit: wiaRetentionUnit });
      const message = result.pdfa ? 'Skan zapisany jako PDF/A‑2b. Zgodność potwierdził veraPDF.' : result.pdfaWarning || 'PDF zapisany w skanach do posortowania.';
      setWiaPages([]); setWiaTitle(defaultPrinterScanTitle()); setWiaStage(message);
      await fetchData(); showToast(message, result.pdfaWarning ? 'error' : 'success');
    } catch (error: unknown) {
      const message = errorMessage(error, 'Nie udało się zapisać PDF.');
      setWiaStage(`Błąd zapisu: ${message}. Strony są zachowane — możesz ponowić zapis.`);
      showToast(message, 'error');
    } finally { setIsWiaScanning(false); }
  };
  const moveInboxScan = async (id: string) => {
    if (!wiaFolderId) return;
    setIsWiaScanning(true);
    try {
      const response = await fetch(`${API_URL}/api/scanner/${id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: Number(wiaFolderId) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Nie udało się przenieść skanu.');
      await fetchData(); showToast('Skan przeniesiony do kartoteki.', 'success');
    } catch (error: unknown) { setWiaStage(errorMessage(error, 'Nie udało się przenieść skanu.')); }
    finally { setIsWiaScanning(false); }
  };
  const renameInboxScan = async (id: string, title: string) => {
    const response = await fetch(`${API_URL}/api/scanner/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Nie udało się zmienić nazwy.');
    setScannerFiles(previous => previous.map(scan => scan.id === id ? { ...scan, title: result.title } : scan));
    showToast('Nazwa skanu została zmieniona.', 'success');
  };
  const toggleDocSelection = (id: number) => setSelectedDocs(prev => prev.includes(id) ? prev.filter(dId => dId !== id) : [...prev, id]);
  const selectAllVisibleDocs = () => setSelectedDocs(displayedDocs.map(doc => doc.id));
  const clearSelectedDocs = () => setSelectedDocs([]);
  const updateSelectedDocs = async (data: Record<string, unknown>, successMessage: string) => {
    if (!selectedDocs.length) return;
    try {
      const responses = await Promise.all(selectedDocs.map(id => patchDocument(API_URL, fetch, id, data)));
      if (responses.some(response => !response.ok)) throw new Error();
      clearSelectedDocs(); await fetchData(); showToast(successMessage, 'success');
    } catch { showToast('Nie udało się wykonać operacji dla wszystkich dokumentów.', 'error'); }
  };
  const moveSelectedDocs = async (folderId: number, retention?: BulkRetention): Promise<boolean> => {
    const restoring = activeView === 'trash' || activeView === 'archive';
    if (!selectedDocs.length || (restoring && !retention)) return false;
    const data = restoring && retention ? { folderId, isDeleted: false, isArchived: false, deletedAt: null, createdAt: new Date().toISOString(), retentionEnabled: retention.enabled, retentionValue: retention.value, retentionUnit: retention.unit } : { folderId };
    const results = await Promise.allSettled(selectedDocs.map(id => patchDocument(API_URL, fetch, id, data)));
    const failed = selectedDocs.filter((_, index) => results[index].status === 'rejected' || (results[index].status === 'fulfilled' && !results[index].value.ok));
    setSelectedDocs(failed);
    try { await fetchData(); } catch { showToast('Zmiany zapisano, ale nie udało się odświeżyć listy.', 'error'); }
    if (failed.length) { showToast(`Nie udało się przetworzyć ${failed.length} dokumentów. Pozostały zaznaczone.`, 'error'); return false; }
    showToast(restoring ? 'Dokumenty przywrócono do wybranej podkartoteki.' : 'Dokumenty przeniesiono.', 'success');
    return true;
  };

  const handleCreateFolder = async (parentId: number | null) => {
    if (!newFolderName.trim()) return;
    try {
      const res = await createFolder(API_URL, fetch, newFolderName.trim(), parentId);
      if (res.ok) { setAddingSubfolderTo(null); setNewFolderName(''); if (parentId) setExpandedFolders(prev => [...prev, parentId]); await fetchData(); }
    } catch {}
  };

  const handleRenameFolder = async (id: number) => {
    if (!renamingFolderName.trim()) return;
    try {
      const res = await renameFolder(API_URL, fetch, id, renamingFolderName.trim());
      if (res.ok) { setRenamingFolderId(null); await fetchData(); }
    } catch {}
  };

  const moveFolder = async (id: number, direction: 'up' | 'down') => {
    try { await moveFolderRequest(API_URL, fetch, id, direction); await fetchData(); } catch {}
  };

  const toggleFolderExpand = (id: number) => setExpandedFolders(prev => prev.includes(id) ? prev.filter(fId => fId !== id) : [...prev, id]);
  const getSortedChildren = (parentId: number | null) => sortedChildren(folders, parentId);

  const renderDashboardFolder = (folder: FolderRecord, depth = 0): React.ReactNode => {
    const children = getSortedChildren(folder.id);
    const isExpanded = expandedFolders.includes(folder.id);
    const hasChildren = children.length > 0;
    const countDescendants = (id: number): { folders: number; documents: number } => {
      const descendants = getSortedChildren(id);
      return descendants.reduce((total, child) => { const nested = countDescendants(child.id); return { folders: total.folders + 1 + nested.folders, documents: total.documents + (child._count?.documents ?? 0) + nested.documents }; }, { folders: 0, documents: 0 });
    };
    const totals = depth === 0 ? countDescendants(folder.id) : null;
    const branchIds = (id: number): number[] => [id, ...getSortedChildren(id).flatMap(child => branchIds(child.id))];
    const ids = new Set(branchIds(folder.id));
    const hidden = documents.filter(doc => ids.has(doc.folderId));
    const trashCount = hidden.filter(doc => doc.isDeleted).length;
    const archiveCount = hidden.filter(doc => doc.isArchived && !doc.isDeleted).length;
    const openFolder = () => {
      if (hasChildren) return toggleFolderExpand(folder.id);
      setSelectedFolderId(folder.id);
      setActiveView('folder');
    };
    return <div key={folder.id} className={depth ? 'ml-7 border-l border-slate-700 pl-4' : ''}>
      <div className="flex items-center gap-2"><button onClick={openFolder} className="flex-1 flex items-center gap-4 rounded-lg border border-slate-700 bg-[#1e293b] px-5 py-4 text-left hover:border-blue-500 hover:bg-[#263449] transition-all">
        <span className="text-2xl">{hasChildren && isExpanded ? '📂' : '📁'}</span>
        <span className="flex-1">{renamingFolderId === folder.id ? <input autoFocus value={renamingFolderName} onClick={(event) => event.stopPropagation()} onChange={(event) => setRenamingFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') handleRenameFolder(folder.id); if (event.key === 'Escape') setRenamingFolderId(null); }} className="w-full rounded bg-[#111827] border border-blue-500 px-2 py-1 text-lg font-bold text-white" /> : <span className="block text-lg font-bold text-white">{folder.name}</span>}<span className="mt-1 block text-sm text-blue-300">{totals ? `${totals.folders} podkartotek · ${totals.documents + (folder._count?.documents ?? 0)} aktywnych dokumentów` : hasChildren ? `${children.length} podkartotek · ${folder._count?.documents ?? 0} dokumentów` : `${folder._count?.documents ?? 0} aktywnych dokumentów`}{trashCount > 0 && ` · ${trashCount} w koszu`}{archiveCount > 0 && ` · ${archiveCount} w archiwum`}</span></span>
        <span className="text-xl text-slate-400">{hasChildren ? (isExpanded ? '⌄' : '›') : '›'}</span>
      </button>{hasChildren && Boolean(folder._count?.documents) && <button onClick={() => { setSelectedFolderId(folder.id); setActiveView('folder'); }} className="rounded border border-blue-500/60 px-3 py-2 text-xs text-blue-200 hover:bg-blue-500/10">Pokaż dokumenty ({folder._count?.documents})</button>}{isEditingFolders && <div className="flex gap-1"><button onClick={() => { setAddingSubfolderTo(folder.id); setNewFolderName(''); setExpandedFolders(value => value.includes(folder.id) ? value : [...value, folder.id]); }} className="p-2 text-blue-300 hover:text-white" title="Dodaj podkartotekę">＋</button><button onClick={() => { setRenamingFolderId(folder.id); setRenamingFolderName(folder.name); }} className="p-2 text-amber-300 hover:text-white" title="Zmień nazwę">✎</button><button onClick={() => void requestFolderDelete(folder.id, folder.name)} className="p-2 text-red-300 hover:text-white" title="Usuń">🗑</button></div>}</div>
      {isEditingFolders && addingSubfolderTo === folder.id && <div className="mt-2 flex gap-2"><input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder(folder.id)} placeholder="Nazwa podkartoteki" className="flex-1 rounded bg-[#111827] border border-slate-600 px-3 py-2 text-sm text-white" /><button onClick={() => handleCreateFolder(folder.id)} className="rounded bg-blue-600 px-3 text-sm font-bold text-white">Dodaj</button><button onClick={() => setAddingSubfolderTo(null)} className="px-2 text-slate-400">×</button></div>}
      {hasChildren && isExpanded && <div className="mt-2 space-y-2">{children.map(child => renderDashboardFolder(child, depth + 1))}</div>}
    </div>;
  };


  const renderSelectOptions = () => buildFolderOptions(folders);


  const handleHoverEnter = (id: number) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoverDocId(id);
  };

  const handleHoverLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => { setHoverDocId(null); }, 300);
  };

  const _renderFolderNode = (folder: FolderRecord, depth = 0) => {
    const children = getSortedChildren(folder.id);
    const isExpanded = expandedFolders.includes(folder.id);
    const isSelected = selectedFolderId === folder.id && activeView === 'folder';
    const indentPixels = depth * 16; 

    return (
      <div key={folder.id} className="relative">
        {depth > 0 && <div className="absolute top-0 bottom-0 left-[-8px] border-l border-slate-600" style={{ left: `${indentPixels - 12}px` }}></div>}
        <div className={`flex items-center justify-between px-2 py-1.5 rounded mb-0.5 transition-colors group cursor-pointer ${isSelected ? 'bg-blue-600 text-white shadow' : 'hover:bg-[#374151] text-slate-300'}`} onClick={() => { setActiveView('folder'); setSelectedFolderId(folder.id); }}>
          <div className="flex items-center gap-1.5 overflow-hidden" style={{ paddingLeft: `${indentPixels}px` }}>
            <span onClick={(e) => { if(children.length > 0) { e.stopPropagation(); toggleFolderExpand(folder.id); } }} className={`w-4 text-[10px] flex items-center justify-center ${children.length > 0 ? (isSelected ? 'text-white' : 'text-blue-400 hover:bg-blue-500/30 rounded cursor-pointer') : 'opacity-0'}`}>
              {isExpanded ? '▼' : '▶'}
            </span>
            <span className="text-yellow-500 text-base flex-shrink-0">📁</span>
            {renamingFolderId === folder.id ? (
              <input type="text" autoFocus value={renamingFolderName} onChange={e => setRenamingFolderName(e.target.value)} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(folder.id); if (e.key === 'Escape') setRenamingFolderId(null); }} className="bg-[#0f172a] text-white px-1 border border-blue-500 rounded text-sm outline-none max-w-[100px]" />
            ) : (
              <span className={`font-medium truncate ${isSelected ? 'text-white' : 'group-hover:text-white'}`} title={folder.name}>{folder.name}</span>
            )}
          </div>
          {isEditingFolders ? (
            <div className="flex items-center gap-1 bg-[#111827] rounded border border-slate-700 p-0.5 shadow-inner" onClick={e => e.stopPropagation()}>
              <button onClick={() => moveFolder(folder.id, 'up')} className="text-slate-500 hover:text-white px-1 text-xs">▲</button>
              <button onClick={() => moveFolder(folder.id, 'down')} className="text-slate-500 hover:text-white px-1 text-xs">▼</button>
              <button onClick={() => { setRenamingFolderId(folder.id); setRenamingFolderName(folder.name); }} className="text-blue-400 hover:text-blue-300 px-1 text-xs">✎</button>
              <button onClick={() => { setAddingSubfolderTo(folder.id); setNewFolderName(''); }} className="text-purple-500 px-1 font-bold text-sm">+</button>
              <button onClick={() => void requestFolderDelete(folder.id, folder.name)} className="text-slate-500 hover:text-red-400 px-1 text-xs">🗑️</button>
            </div>
          ) : (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-2 ${isSelected ? 'bg-white text-blue-600' : 'bg-[#111827] text-slate-400'}`}>
              {folder._count?.documents ?? 0}
            </span>
          )}
        </div>
        {addingSubfolderTo === folder.id && isEditingFolders && (
          <div className="flex items-center gap-1 my-1.5 pr-2" style={{ paddingLeft: `${indentPixels + 24}px` }}>
            <div className="flex-1 bg-white rounded flex items-center p-0.5 border-2 border-blue-500 shadow-lg">
              <input type="text" autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateFolder(folder.id)} className="bg-transparent text-black px-2 py-0.5 text-xs w-full outline-none font-medium" placeholder="Nazwa podkartoteki..." />
              <button onClick={() => handleCreateFolder(folder.id)} className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold">OK</button>
              <button onClick={() => setAddingSubfolderTo(null)} className="bg-slate-400 text-white px-2 py-1 rounded text-xs font-bold ml-0.5">X</button>
            </div>
          </div>
        )}
        {isExpanded && children.length > 0 && <div className="flex flex-col relative">{children.map(child => _renderFolderNode(child, depth + 1))}</div>}
      </div>
    );
  };

  const recognizeSelected = useCallback(async () => {
    try {
      for (let offset = 0; offset < selectedDocs.length; offset += 100) {
        const response = await apiFetch(`${API_URL}/api/ocr/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: selectedDocs.slice(offset, offset + 100) }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Nie udało się uruchomić OCR.');
      }
      showToast('Dokumenty dodano do kolejki OCR.');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Nie udało się uruchomić OCR.', 'error'); }
  }, [billingPlan, selectedDocs, showToast]);

  const exportSelectedPdf = useCallback(async () => {
    if (!selectedDocs.length) return;
    if (billingPlan !== 'premium') { setPlanLimitMessage('Eksport zaznaczonych dokumentów do PDF jest dostępny w planie Premium.'); return; }
    try {
      const blob = await exportDocuments(API_URL, fetch, selectedDocs); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `eteczka-eksport-${new Date().toISOString().slice(0, 10)}.pdf`; anchor.click(); URL.revokeObjectURL(url);
      showToast(`Wyeksportowano ${selectedDocs.length} dokumentów do jednego PDF-a.`, 'success');
    } catch (error: unknown) { showToast(errorMessage(error, 'Nie udało się wyeksportować dokumentów.'), 'error'); }
  }, [billingPlan, selectedDocs, showToast]);

  useEffect(() => {
    const query = searchQuery.trim(); let active = true;
    setOcrSearchIds([]);
    if (!query || query.length > 200) return () => { active = false; };
    const search = () => { void fetch(`${API_URL}/api/ocr/search?q=${encodeURIComponent(query)}`).then(async response => response.ok ? response.json() : null).then(data => { if (active && Array.isArray(data?.ids)) setOcrSearchIds(data.ids); }).catch(() => { if (active) setOcrSearchIds([]); }); };
    const timer = window.setTimeout(search, 300); const interval = window.setInterval(search, 5000);
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(interval); };
  }, [searchQuery, billingPlan]);

  const displayedDocs = documents.filter(doc => {
    if (activeView === 'trash') return doc.isDeleted;
    if (activeView === 'archive') return doc.isArchived && !doc.isDeleted;
    const query = searchQuery.toLowerCase();
    const matchesSearch = !query || doc.title.toLowerCase().includes(query) || ocrSearchIds.includes(doc.id);
    if (activeView === 'dashboard') return !doc.isDeleted && !doc.isArchived && matchesSearch;
    if (activeView === 'folder') return doc.folderId === selectedFolderId && !doc.isDeleted && !doc.isArchived && matchesSearch;
    return false;
  });

  return (
    <div className="flex h-screen bg-[#111827] text-slate-300 font-sans text-sm">
      {showWelcome && !currentUser && <WelcomeScreen onContinue={() => setShowWelcome(false)} onAuthenticated={user => { setShowWelcome(false); handleAuthenticated(user); }} />}
      {toast && (
        <div role="status" className={`fixed bottom-5 right-5 z-50 min-w-80 border-l-4 px-5 py-4 rounded-md shadow-2xl font-medium ${toast.type === 'error' ? 'border-red-400 bg-red-950 text-red-50' : 'border-emerald-400 bg-emerald-950 text-emerald-50'}`}>
          {toast.message}
        </div>
      )}

      {previewDoc && <DocumentPreviewModal apiUrl={API_URL} document={previewDoc} zoom={previewZoom} onZoomChange={setPreviewZoom} onClose={() => { setPreviewDoc(null); setPreviewZoom(1); }} />}

      {uploadReport && <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 p-4"><section role="dialog" aria-modal="true" aria-labelledby="upload-report-title" className="w-full max-w-lg rounded-xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl"><h2 id="upload-report-title" className="text-xl font-bold text-white">Wynik wgrywania</h2><p className="mt-3 text-sm">Podkartoteka: <strong>{uploadReport.folder}</strong>. Wgrano plików: <strong>{uploadReport.saved}</strong>.</p><p className="mt-3 text-sm text-amber-200">Pominięto {uploadReport.skipped.length} identycznych plików — były już w tej podkartotece lub pojawiły się wcześniej w wybranej paczce.</p><ul className="mt-3 max-h-48 list-disc overflow-auto pl-5 text-sm text-slate-300">{uploadReport.skipped.map((item, index) => <li key={index} className="break-words">{item.name} — identyczny jak „{item.existingTitle}”</li>)}</ul><button onClick={() => setUploadReport(null)} className="mt-5 rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white">Rozumiem</button></section></div>}
      {isBillingCancelOpen && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-[#0f172a] p-7 shadow-2xl"><h3 className="text-xl font-bold text-white">Anulować subskrypcję?</h3>{billingCancelPreviewBusy && <p className="mt-3 text-sm text-slate-300">Obliczam rozliczenie…</p>}{billingCancelPreviewError && <p role="alert" className="mt-3 text-sm text-red-300">{billingCancelPreviewError}</p>}{billingCancelPreview && <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300"><p>Odnowienie zostanie wyłączone. Dostęp do planu pozostanie aktywny do <strong className="text-white">{new Date(billingCancelPreview.accessUntil).toLocaleDateString('pl-PL')}</strong>.</p><p>Zwrot za {billingCancelPreview.refundedMonths} pełnych niewykorzystanych miesięcy: <strong className="text-white">{(billingCancelPreview.refundedAmount / 100).toFixed(2)} {billingCancelPreview.currency.toUpperCase()}</strong>.</p><p className="rounded-lg bg-amber-950/40 p-3 text-amber-100">Po przejściu na plan Darmowy {billingCancelPreview.restrictedDocuments} dokumentów będzie tylko do odczytu, a {billingCancelPreview.inactiveTags} tagów stanie się nieaktywnych. Dokumenty zachowają możliwość pobrania i usunięcia. To szacunkowy stan na teraz.</p>{billingCancelPreview.alreadyScheduled && <p className="text-amber-300">Anulowanie zostało już zaplanowane.</p>}</div>}<div className="mt-6 flex gap-3"><button disabled={billingCancelBusy} onClick={() => setIsBillingCancelOpen(false)} className="flex-1 rounded-lg bg-slate-700 py-3 font-bold text-white hover:bg-slate-600 disabled:opacity-50">Wróć</button><button disabled={billingCancelBusy || billingCancelPreviewBusy || !billingCancelPreview || billingCancelPreview.alreadyScheduled} onClick={() => void cancelBilling()} className="flex-1 rounded-lg bg-red-600 py-3 font-bold text-white hover:bg-red-500 disabled:opacity-50">{billingCancelBusy ? 'Rozliczanie…' : 'Potwierdź anulowanie'}</button></div></div></div>}

      {planLimitMessage && <PlanLimitModal message={planLimitMessage} plan={billingPlan} busy={billingBusy} onClose={() => setPlanLimitMessage('')} onSelect={(plan, interval) => { setPlanLimitMessage(''); void openBillingCheckout(plan, interval, false, true); }} />}
      {secureShareId !== null && <SecureShareModal apiUrl={API_URL} fetcher={apiFetch} documentId={secureShareId} title={documents.find(doc => doc.id === secureShareId)?.title || 'Dokument'} onClose={() => setSecureShareId(null)} />}
      {isPlanUsageOpen && <PlanUsageModal apiUrl={API_URL} fetcher={apiFetch} onClose={() => setIsPlanUsageOpen(false)} />}
      {isBillingHistoryOpen && <BillingHistoryModal transactions={billingHistory} loading={billingHistoryBusy} onClose={() => setIsBillingHistoryOpen(false)} />}
      {backupSection && <BackupModal key={backupSection} section={backupSection} apiUrl={API_URL} fetcher={apiFetch} onClose={() => setBackupSection(null)} onDone={() => { setBackupSection(null); void fetchData(); }} />}
      {ocrDocumentId !== null && <OcrPanel apiUrl={API_URL} documentId={ocrDocumentId} title={documents.find(document => document.id === ocrDocumentId)?.title || 'Dokument'} fetcher={fetch} onClose={() => setOcrDocumentId(null)} />}

      <TagManagerModal
        isOpen={isTagManagerOpen}
        tags={tags}
        name={newTagName}
        color={newTagColor}
        onNameChange={setNewTagName}
        onColorChange={setNewTagColor}
        onCreate={() => void createTag()}
        onDelete={(tagId) => void (async () => { await deleteTagRequest(API_URL, fetch, tagId); await fetchData(); })()}
        onClose={() => setIsTagManagerOpen(false)}
      />

      <MoveDocumentModal
        documentId={moveModalDocId}
        folderOptions={renderSelectOptions()}
        onMove={(folderId) => updateDocument(moveModalDocId!, { folderId })}
        onClose={() => setMoveModalDocId(null)}
      />

      <BulkMoveModal
        isOpen={isBulkMoveOpen}
        documentCount={selectedDocs.length}
        restoring={activeView === 'trash' || activeView === 'archive'}
        folderOptions={renderSelectOptions()}
        onMove={moveSelectedDocs}
        onClose={() => setIsBulkMoveOpen(false)}
      />

      {folderDeletePreview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/50 bg-[#0f172a] p-7 shadow-2xl">
            <h3 className="text-xl font-bold text-white">Najpierw przenieś dokumenty</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">W kartotece „{folderDeletePreview.name}” i jej podkartotekach jest <strong className="text-white">{folderDeletePreview.documentCount}</strong> aktywnych dokumentów. Wybierz podkartotekę, do której zostaną przeniesione. W archiwum jest {folderDeletePreview.archivedCount}, a w koszu {folderDeletePreview.trashedCount} dokumentów — pozostaną w archiwum i koszu. Przy ich przywracaniu wybierzesz miejsce docelowe.</p>
            <select value={transferFolderId} onChange={(event) => setTransferFolderId(event.target.value)} className="mt-5 w-full rounded-md border border-slate-600 bg-[#111827] px-3 py-3 text-white focus:border-blue-500 focus:outline-none">
              <option value="">— wybierz podkartotekę docelową —</option>
              {renderSelectOptions()}
            </select>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setFolderDeletePreview(null)} className="flex-1 rounded-lg bg-slate-700 py-3 font-bold text-white hover:bg-slate-600">Anuluj</button>
              <button disabled={!transferFolderId} onClick={() => { const preview = folderDeletePreview; setFolderDeletePreview(null); initiateAction('delete_folder', preview.id, preview.name, Number(transferFolderId), preview.archivedCount, preview.trashedCount); }} className="flex-1 rounded-lg bg-red-600 py-3 font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">Dalej</button>
            </div>
          </div>
        </div>
      )}

      <DestructiveActionModal
        action={pendingAction}
        seconds={actionTimer}
        onCancel={() => {
          setPendingAction(null);
          setActionTimer(null);
          showToast('Anulowano operację', 'success');
        }}
        onConfirm={() => { if (actionTimer === 0) void executeAction(); }}
      />

      <RetentionModal
        state={retentionModal}
        folderOptions={renderSelectOptions()}
        onStateChange={setRetentionModal}
        onSubmit={handleRetentionUpdate}
        onClose={() => setRetentionModal({ ...retentionModal, isOpen: false })}
      />

      <DesktopSidebar
        activeView={activeView}
        documents={documents}
        onViewChange={(view) => { setActiveView(view); if (view === 'dashboard') setSelectedFolderId(null); }}
        onOpenScanner={() => void openWiaScanner()}
        onToggleSettings={() => setIsSettingsMenuOpen(true)}
        onOpenBackup={setBackupSection}
      />
      {isSettingsMenuOpen && <SettingsDialog onClose={() => setIsSettingsMenuOpen(false)} onPair={() => setIsPairingGuideOpen(true)} onSecurity={() => setIsAccessSettingsOpen(true)} onTags={() => setIsTagManagerOpen(true)} onBackup={() => setBackupSection('settings')} onLogout={() => void logoutAccount()} />}
      {/* GŁÓWNA ZAWARTOŚĆ */}
      {isAccessSettingsOpen && <DesktopAccessSettings onClose={() => setIsAccessSettingsOpen(false)} />}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0f172a]">
        <DesktopTopBar
          activeView={activeView}
          searchQuery={searchQuery}
          localAddress={localAddresses[0] || ''}
          pairingCode={pairingCode}
          phoneConnected={phoneConnected}
          scannerFileCount={scannerFiles.length}
          retentionAlerts={retentionAlerts}
          notificationsOpen={isNotificationsOpen}
          userMenuOpen={isUserMenuOpen}
          currentUser={currentUser}
          billingPlan={billingPlan}
          billingIsDev={billingIsDev}
          apiUrl={API_URL}
          apiFetcher={apiFetch}
          onDevPlanChanged={() => { setBillingDetails(null); void fetchData(); }}
          billingDetails={billingDetails}
          billingDetailsBusy={billingDetailsBusy}
          billingBusy={billingBusy}
          billingCancelBusy={billingCancelBusy}
          onSearchChange={setSearchQuery}
          onBack={() => { setActiveView('dashboard'); setSelectedFolderId(null); }}
          onToggleNotifications={() => setIsNotificationsOpen((value) => !value)}
          onOpenScannerInbox={() => { void openWiaScanner(); setIsNotificationsOpen(false); }}
          onOpenNotification={(documentId) => { const doc = documents.find((item) => item.id === documentId); if (doc) { setSelectedFolderId(doc.folderId); setActiveView('folder'); } setIsNotificationsOpen(false); }}
          onToggleUserMenu={() => void toggleUserMenu()}
          onOpenBillingPlans={() => { setIsBillingPlansOpen(true); setIsUserMenuOpen(false); }}
          onRequestCancelBilling={() => { void openBillingCancel(); }}
          onOpenPlanUsage={() => { setIsUserMenuOpen(false); setIsPlanUsageOpen(true); }}
          onOpenBillingHistory={() => { setIsUserMenuOpen(false); void openBillingHistory(); }}
          onOpenAuth={() => { setIsAuthOpen(true); setIsUserMenuOpen(false); }}
          onLogout={() => void logoutAccount()}
          onOpenPairing={() => setIsPairingGuideOpen(true)}
          onOpenAccessSettings={() => { setIsAccessSettingsOpen(true); setIsUserMenuOpen(false); }}
          onOpenSettings={() => { setIsSettingsMenuOpen(true); setIsUserMenuOpen(false); }}
        />
        <main className="relative flex-1 overflow-y-auto p-6 flex justify-center custom-scrollbar">
          {selectedDocs.length > 0 && activeView !== 'dashboard' && <button onClick={() => void exportSelectedPdf()} className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-xl hover:bg-emerald-500">Eksportuj zaznaczone do PDF ({selectedDocs.length})</button>}
      {activeView === 'scanner' ? <PrinterScannerModal
        devices={wiaDevices}
        loadingDevices={isWiaLoadingDevices}
        deviceId={wiaDeviceId}
        folderId={wiaFolderId}
        folderOptions={renderSelectOptions()}
        pages={wiaPages}
        title={wiaTitle}
        retentionValue={wiaRetentionValue}
        retentionUnit={wiaRetentionUnit}
        retentionEnabled={wiaRetentionEnabled}
        stage={wiaStage}
        busy={isWiaScanning}
        pendingScan={Boolean(wiaPendingScanPath)}
        onDeviceChange={(id) => { setWiaDeviceId(id); localStorage.setItem('eteczka_default_scanner', id); }}
        onFolderChange={setWiaFolderId}
        onTitleChange={setWiaTitle}
        onRetentionValueChange={setWiaRetentionValue}
        onRetentionUnitChange={setWiaRetentionUnit}
        onRetentionEnabledChange={setWiaRetentionEnabled}
        onScan={() => void scanFromPrinter()}
        onRemovePage={(index) => setWiaPages(previous => previous.filter((_, pageIndex) => pageIndex !== index))}
        inbox={scannerFiles}
        onSave={() => void savePrinterDocument()}
        onMove={(id) => void moveInboxScan(id)}
        onRename={renameInboxScan}
        onClose={() => setActiveView('dashboard')}
      /> :

          activeView === 'upload' ? (
            <div className="w-full max-w-5xl bg-[#1e293b] border border-slate-700 rounded-lg p-6 shadow-xl h-fit mb-10">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">📦 Rejestracja Dokumentów</h2>
                <label className="flex items-center gap-2 border border-slate-600 bg-[#111827] px-3 py-1.5 rounded-md cursor-pointer hover:bg-slate-700 transition-colors">
                  <input type="checkbox" checked={isMergeMode} onChange={(e) => setIsMergeMode(e.target.checked)} className="rounded bg-slate-700 border-slate-500 text-blue-500 focus:ring-blue-500" />
                  <span className="text-slate-300 font-medium">Połącz w jeden PDF</span>
                </label>
              </div>

              <form onSubmit={handleBatchUpload} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-slate-300">Wybierz lub przeciągnij pliki do archiwizacji</label>
                  <div className="border border-slate-600 rounded-lg p-4 bg-[#111827]/50 flex flex-col gap-4">
                    <div className="border-2 border-dashed border-blue-500/40 rounded-lg p-6 bg-[#111827] hover:bg-[#1f2937] transition-colors flex flex-col items-center justify-center gap-3">
                      <div className="text-4xl opacity-80">📁</div>
                      <div className="text-slate-400 text-sm font-medium">Przeciągnij pliki tutaj lub kliknij przycisk poniżej</div>
                      <input type="file" multiple accept=".png,.jpg,.jpeg,.pdf" onChange={handleFileSelect} className="text-sm text-slate-400 file:mr-4 file:py-2 file:px-6 file:rounded-md file:border-0 file:text-sm file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer" />
                    </div>
                    {filesToUpload.length > 0 && (
                      <div className="mt-2 border-t border-slate-700 pt-4">
                        <div className="flex justify-between items-center mb-3">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gotowe do wgrania:</h4>
                          <span className="text-xs bg-blue-900/40 text-blue-300 border border-blue-800/50 px-2.5 py-1 rounded-md font-bold">Łącznie: {filesToUpload.length}</span>
                        </div>
                        <ul className="space-y-2 max-h-56 overflow-y-auto pr-2 custom-scrollbar">
                          {filesToUpload.map((item, idx) => (
                            <li key={idx} className="flex justify-between items-center bg-[#1f2937] px-4 py-3 rounded-md border border-slate-600 shadow-sm hover:border-blue-500/50 transition-colors group">
                              <div className="flex items-center gap-3 overflow-hidden">
                                <span className="text-2xl">{item.file.name.toLowerCase().endsWith('.pdf') ? '📄' : '🖼️'}</span>
                                <div className="flex flex-col overflow-hidden">
                                  <span className="text-sm font-semibold text-slate-200 truncate" title={item.file.name}>{item.file.name}</span>
                                  <span className="text-xs text-slate-400">{(item.file.size / 1024).toFixed(1)} KB</span>
                                </div>
                              </div>
                              <button type="button" onClick={() => setFilesToUpload(prev => prev.filter((_, i) => i !== idx))} className="text-slate-500 hover:text-red-400 hover:bg-red-900/30 p-2 rounded transition-colors ml-2 opacity-40 group-hover:opacity-100">🗑️ Usuń</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {isMergeMode && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border border-blue-500/30 rounded-lg bg-[#111827]">
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-300">Tytuł scalonego PDF (WYMAGANE):</label>
                      <input type="text" value={mergedTitle} onChange={(e) => setMergedTitle(e.target.value)} className="w-full bg-[#1f2937] border border-slate-600 rounded px-3 py-2 text-white focus:border-blue-500 outline-none" placeholder="Tytuł dokumentu..." />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 text-slate-300">Termin życia dokumentu:</label>
                      <div className="flex items-center gap-2">
                        <input type="number" value={mergedRetentionVal} onChange={(e) => setMergedRetentionVal(Number(e.target.value))} className="w-20 bg-[#1f2937] border border-slate-600 rounded px-2 py-2 text-white outline-none" min="1" />
                        <select value={mergedRetentionUnit} onChange={(e) => setMergedRetentionUnit(e.target.value as RetentionUnit)} className="bg-[#1f2937] border border-slate-600 rounded px-2 py-2 text-white outline-none">
                          <option value="years">Lata</option>
                          <option value="months">Miesiące</option>
                          <option value="days">Dni</option>
                          <option value="minutes">Minuty</option>
                        </select>
                        <label className="flex items-center gap-1 ml-2"><input type="checkbox" checked={mergedRetentionEnabled} onChange={(e) => setMergedRetentionEnabled(e.target.checked)} /> Aktywna</label>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-bold mb-1 text-slate-200">Docelowa Kartoteka (WYMAGANA)</label>
                  <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="w-full bg-[#111827] border border-slate-600 rounded-md p-2.5 text-white font-medium focus:outline-none focus:border-blue-500 appearance-none">
                    <option value="">-- Wybierz kartotekę --</option>
                    {renderSelectOptions().length ? renderSelectOptions() : <option disabled>Brak kartotek — utwórz kartotekę w widoku Kartoteki</option>}
                  </select>
                  {foldersUnavailable && <div role="status" className="mt-2 text-sm text-amber-300"><p>Nie udało się pobrać kartotek z serwera. Sprawdź, czy E-Teczka na komputerze działa.</p><button type="button" onClick={() => void fetchData()} className="mt-2 rounded border border-amber-500 px-3 py-1.5 text-amber-200 hover:bg-amber-500/10">Ponów połączenie</button></div>}
                </div>

                <div>
                  <label className="flex items-center gap-1 text-sm font-medium mb-1 text-orange-400">
                    📍 Fizyczna lokalizacja (Opcjonalnie)
                  </label>
                  <input type="text" placeholder="np. Szafka biurowa A, półka 2..." value={physicalLocation} onChange={(e) => setPhysicalLocation(e.target.value)} className="w-full bg-[#111827] border border-slate-600 rounded-md p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500" />
                </div>

                <div className="flex justify-end pt-4">
                  <button type="submit" disabled={isUploading || filesToUpload.length === 0 || !folderId || foldersUnavailable} className="px-6 py-2.5 bg-slate-200 hover:bg-white text-slate-800 rounded-md font-bold shadow-lg disabled:opacity-50 transition-colors">
                    {isUploading ? 'Przetwarzanie...' : isMergeMode ? `Scal i wgraj (${filesToUpload.length}) plików` : `Wgraj osobno (${filesToUpload.length}) plików`}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="w-full max-w-[1400px]">
              <div className="flex items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4"><span className="text-3xl">{activeView === 'trash' ? '🗑️' : activeView === 'archive' ? '📦' : '📁'}</span>
                <h2 className="text-2xl font-bold text-white tracking-wide">
                  {activeView === 'dashboard' ? 'Kartoteki' : activeView === 'trash' ? 'Kosz' : activeView === 'archive' ? 'Archiwum Systemowe' : (folders.find(f => f.id === selectedFolderId)?.name || 'Kartoteka')}
                </h2></div>
                <div className="flex items-center gap-2">
                  {activeView === 'trash' && displayedDocs.length > 0 && <button onClick={() => initiateAction('empty_trash', 0, String(displayedDocs.length))} className="rounded-md border border-red-500 px-4 py-2 text-sm font-bold text-red-300 hover:bg-red-900/40">Opróżnij kosz</button>}
                  {activeView === 'folder' && selectedFolderId && folders.some(folder => folder.id === selectedFolderId && folder.parentId !== null) && <button onClick={() => { setFolderId(String(selectedFolderId)); setActiveView('upload'); }} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">＋ Dodaj dokument</button>}
                  {activeView === 'dashboard' && <button onClick={() => { setIsEditingFolders(value => !value); setAddingSubfolderTo(null); }} className="rounded-md border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700">{isEditingFolders ? '✓ Gotowe' : '✎ Edytuj kartoteki'}</button>}
                </div>
              </div>
              {activeView === 'dashboard' && !searchQuery.trim() ? <div className="max-w-4xl space-y-3">{isEditingFolders && <div className="rounded-lg border border-dashed border-slate-500 p-3"><p className="mb-2 text-sm font-semibold text-slate-300">Dodaj kartotekę główną</p>{addingSubfolderTo === 'root' ? <div className="flex gap-2"><input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleCreateFolder(null)} placeholder="Nazwa kartoteki" className="flex-1 rounded bg-[#111827] border border-slate-600 px-3 py-2 text-sm text-white" /><button onClick={() => handleCreateFolder(null)} className="rounded bg-blue-600 px-3 text-sm font-bold text-white">Dodaj</button><button onClick={() => setAddingSubfolderTo(null)} className="px-2 text-slate-400">×</button></div> : <button onClick={() => { setAddingSubfolderTo('root'); setNewFolderName(''); }} className="text-sm text-blue-300 hover:text-white">＋ Dodaj kartotekę główną</button>}</div>}{getSortedChildren(null).map(folder => renderDashboardFolder(folder))}</div> : <><div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-950/30 px-3 py-2"><button onClick={() => selectedDocs.length === displayedDocs.length ? clearSelectedDocs() : selectAllVisibleDocs()} className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">{selectedDocs.length === displayedDocs.length && displayedDocs.length ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}</button>{selectedDocs.length > 0 && <><span className="px-1 text-xs font-semibold text-blue-200">Wybrano: {selectedDocs.length}</span>{activeView !== 'trash' && <button onClick={() => void recognizeSelected()} className="rounded border border-blue-400 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-500/10">Rozpoznaj tekst (OCR)</button>}<button onClick={() => setIsBulkMoveOpen(true)} className="rounded border border-indigo-500/70 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/10">{activeView === 'trash' || activeView === 'archive' ? 'Przywróć do kartoteki' : 'Przenieś'}</button>{activeView !== 'archive' && <button onClick={() => void updateSelectedDocs({ isArchived: true }, 'Dokumenty zarchiwizowano.')} className="rounded border border-amber-600/70 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-600/10">Archiwizuj</button>}{activeView !== 'trash' && <button onClick={() => void updateSelectedDocs({ isDeleted: true }, 'Dokumenty przeniesiono do kosza.')} className="rounded border border-red-500/70 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">Do kosza</button>}<button onClick={() => showToast('Wysyłka wymaga wskazania odbiorcy i konfiguracji poczty.', 'error')} className="rounded border border-emerald-500/70 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10">Wyślij</button></>}</div><div className="bg-[#1e293b] rounded-lg border border-slate-700 overflow-visible shadow-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-700 text-xs text-slate-400 font-semibold tracking-wider bg-[#0f172a]/50">
                      <th className="p-4 w-12 text-center">✓</th>
                      <th className="p-4 w-20">PODGLĄD</th>
                      <th className="p-4">DOKUMENT I TAGI</th>
                      <th className="p-4">DODANO</th>
                      <th className="p-4">TERMIN ŻYCIA</th>
                      <th className="p-4">WGRYWAJĄCY</th>
                      <th className="p-4">ROZMIAR</th>
                      <th className="p-4 text-right pr-6">MENU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedDocs.length === 0 ? (
                      <tr><td colSpan={8} className="p-8 text-center text-slate-500 italic">Brak dokumentów w tym widoku.</td></tr>
                    ) : displayedDocs.map(doc => (
                      <tr key={doc.id} className="border-b border-slate-700/50 hover:bg-[#374151]/30 transition-colors group">
                        <td className="p-4 text-center">
                          <input type="checkbox" checked={selectedDocs.includes(doc.id)} onChange={() => toggleDocSelection(doc.id)} className="rounded bg-[#111827] border-slate-600 text-blue-500 focus:ring-0 w-4 h-4 cursor-pointer" />
                        </td>
                        
                        <td className="p-4 relative">
                          <div className="flex items-center justify-center">
                            <div 
                              className="w-14 h-16 bg-[#0f172a] rounded border border-slate-600 flex items-center justify-center overflow-hidden cursor-pointer hover:border-blue-500 hover:shadow-[0_0_10px_rgba(59,130,246,0.5)] transition-all relative z-10"
                              onClick={() => { setPreviewDoc(doc); setPreviewZoom(1); setHoverDocId(null); }}
                              onMouseEnter={(event) => { setHoverAnchor(event.currentTarget); handleHoverEnter(doc.id); }}
                              onMouseLeave={handleHoverLeave}
                            >
                              <DocumentThumbnail document={doc} apiUrl={API_URL} fetcher={apiFetch} />
                              <div className="absolute inset-0 bg-black/0 hover:bg-blue-500/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow pointer-events-none">Powiększ</span>
                              </div>
                            </div>

                            {hoverDocId === doc.id && hoverAnchor && <HoverDocumentPreview document={doc} anchor={hoverAnchor} apiUrl={API_URL} fetcher={apiFetch} onEnter={() => handleHoverEnter(doc.id)} onLeave={handleHoverLeave} />}
                          </div>
                        </td>

                        <td className="p-4">
                          <div className="flex flex-col">
                            {renamingDocId === doc.id ? (
                              <input type="text" autoFocus value={renamingDocTitle} onChange={e => setRenamingDocTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { updateDocument(doc.id, { title: renamingDocTitle }); setRenamingDocId(null); } if (e.key === 'Escape') setRenamingDocId(null); }} onBlur={() => setRenamingDocId(null)} className="bg-[#0f172a] text-white px-2 py-1 border border-blue-500 rounded text-sm outline-none w-full max-w-sm mb-1" />
                            ) : (
                              <div className="flex items-center gap-2 group/title">
                                <span className="text-slate-200 font-bold text-sm truncate max-w-sm" title={doc.title}>{doc.title}</span>
                                <button onClick={() => { setRenamingDocId(doc.id); setRenamingDocTitle(doc.title); }} className="text-blue-400 opacity-0 group-hover/title:opacity-100 hover:text-white transition-opacity" title="Zmień nazwę pliku">✎</button>
                              </div>
                            )}
                            <div className="mt-1 flex flex-wrap gap-1">{doc.readOnly && <span className="rounded bg-amber-900/60 px-2 py-0.5 text-[10px] text-amber-200">Tylko do odczytu — limit planu</span>}{(doc.tags || []).map((entry) => <span key={entry.tagId} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${entry.tag.inactive ? 'bg-slate-700 text-slate-400' : 'text-white'}`} style={entry.tag.inactive ? undefined : { backgroundColor: entry.tag.color }}>{entry.tag.name}{entry.tag.inactive ? ' (nieaktywny)' : ''}</span>)}</div>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className="text-xs text-slate-300">{new Date(doc.createdAt).toLocaleDateString('pl-PL')}</span><br /><span className="text-[10px] text-slate-500">{new Date(doc.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-300 bg-[#0f172a] px-2 py-0.5 rounded border border-slate-700">
                                {doc.retentionEnabled === false ? 'Bez terminu' : `${doc.retentionValue} ${doc.retentionUnit === 'years' ? 'lat' : doc.retentionUnit === 'months' ? 'mies.' : doc.retentionUnit === 'minutes' ? 'min.' : 'dni'}`}
                              </span>
                            </div>
                            <span className="text-xs text-slate-500 mt-1">{getExpiryDate(doc) ? `Do kosza: ${getExpiryDate(doc)?.toLocaleDateString('pl-PL')}` : 'Brak automatycznego kosza'}</span>
                          </div>
                        </td>
                        <td className="p-4 text-xs text-slate-300">{doc.user?.name || doc.user?.email || 'Właściciel'}</td>
                        <td className="p-4 text-xs text-slate-300 whitespace-nowrap">{formatFileSize(doc.fileSize)}</td>
                        <td className="p-4 align-middle">
                          <div className="relative flex justify-end">
                            {activeView === 'trash' ? (
                              <button onClick={() => setDocumentMenuId(documentMenuId === doc.id ? null : doc.id)} className="rounded p-2 text-xl text-slate-300 hover:bg-slate-700 hover:text-white" aria-label="Menu dokumentu">⋮</button>
                            ) : (
                              <button onClick={() => setDocumentMenuId(documentMenuId === doc.id ? null : doc.id)} className="rounded p-2 text-xl text-slate-300 hover:bg-slate-700 hover:text-white" aria-label="Menu dokumentu">⋮</button>
                            )}
                            {documentMenuId === doc.id && <div className="absolute right-0 top-10 z-40 w-52 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left shadow-2xl">{activeView !== 'trash' && activeView !== 'archive' && <button onClick={() => { setMoveModalDocId(doc.id); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Przenieś</button>}{activeView === 'trash' ? <><button onClick={() => { beginRestore(doc, 'trash'); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-emerald-300 hover:bg-slate-700">Przywróć</button><button onClick={() => { initiateAction('delete_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-red-300 hover:bg-slate-700">Usuń trwale</button></> : <>{activeView === 'archive' ? <button onClick={() => { beginRestore(doc, 'archive'); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Przywróć</button> : <button onClick={() => { void updateDocument(doc.id, { isArchived: true }); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-amber-300 hover:bg-slate-700">Archiwizuj</button>}<button onClick={() => { setRetentionModal({ isOpen: true, docId: doc.id, value: doc.retentionValue || 5, unit: doc.retentionUnit || 'years', enabled: doc.retentionEnabled !== false }); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Edytuj termin życia</button><button onClick={() => { initiateAction('trash_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-red-300 hover:bg-slate-700">Do kosza</button></>}{!doc.isDeleted && <button onClick={() => { setSecureShareId(doc.id); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-emerald-300 hover:bg-slate-700">Bezpieczny link</button>}<button onClick={() => { setOcrDocumentId(doc.id); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-blue-300 hover:bg-slate-700">Rozpoznany tekst (OCR)</button><div className="my-1 border-t border-slate-700" />{tags.filter(tag => !tag.inactive).map(tag => <button key={tag.id} onClick={() => { const tagIds = (doc.tags || []).filter(entry => !entry.tag.inactive).map((entry) => entry.tagId); void updateDocument(doc.id, { tagIds: tagIds.includes(tag.id) ? tagIds.filter((id) => id !== tag.id) : [...tagIds, tag.id] }); setDocumentMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />{(doc.tags || []).some((entry) => entry.tagId === tag.id) ? '✓ ' : ''}{tag.name}</button>)}</div>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div></>}
            </div>
          )}
        </main>
      </div>
      {isAuthOpen && <AuthModal onClose={() => setIsAuthOpen(false)} onAuthenticated={handleAuthenticated} />}
      {isBillingPlansOpen && <BillingPlansModal busy={billingBusy} currentPlan={billingPlan} developmentOverride={billingIsDev} cancellationScheduled={billingDetails?.cancellationScheduled === true} onSelectFree={() => { if (billingIsDev) { void (async () => { try { const response = await apiFetch(`${API_URL}/api/dev/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'free' }) }); if (!response.ok) throw new Error('Nie udało się zmienić planu testowego.'); setIsBillingPlansOpen(false); setBillingDetails(null); await fetchData(); showToast('Wybrano testowy plan Darmowy.'); } catch (error) { showToast(errorMessage(error), 'error'); } })(); } else { setIsBillingPlansOpen(false); void openBillingCancel(); } }} onClose={() => setIsBillingPlansOpen(false)} onSelect={(plan, interval) => { if (billingDetails?.cancellationScheduled) { const amount = plan === 'standard' ? (interval === 'yearly' ? '49,90 zł za rok' : '4,99 zł miesięcznie') : (interval === 'yearly' ? '99,90 zł za rok' : '9,99 zł miesięcznie'); const end = billingDetails.renewalAt ? new Date(billingDetails.renewalAt).toLocaleDateString('pl-PL') : 'końca opłaconego okresu'; if (!window.confirm(`Obecny plan pozostaje opłacony do ${end}. Nowy plan zacznie działać od razu, a nowa płatność (${amount}) zostanie pobrana po jej zatwierdzeniu w Stripe. Niewykorzystana część bieżącego miesiąca nie zostanie ponownie rozliczona. Czy chcesz kontynuować?`)) return; } setIsBillingPlansOpen(false); void openBillingCheckout(plan, interval, billingDetails?.cancellationScheduled === true); }} />}

      {currentUser && <MobileOnboarding key={currentUser.email} email={currentUser.email} phoneConnected={phoneConnected} onPair={() => setIsPairingGuideOpen(true)} />}
      {isPairingGuideOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/80 flex items-center justify-center p-6" onClick={() => setIsPairingGuideOpen(false)}>
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-600 bg-[#1e293b] shadow-2xl p-7" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-5 mb-6">
              <div><h2 className="text-2xl font-bold text-white">Połącz telefon z E‑Teczką</h2><p className="text-slate-400 mt-1">Połączenie działa wyłącznie w Twojej sieci lokalnej.</p></div>
              <button onClick={() => setIsPairingGuideOpen(false)} className="text-slate-400 hover:text-white text-2xl">×</button>
            </div>
            <div className="mb-5"><MobileAppDownload /><p className="mt-3 rounded-xl border border-blue-500/30 bg-blue-950/30 p-4 text-sm leading-6 text-blue-100">Kod QR lub kod parowania łączy telefon z tym komputerem jako zaufanym urządzeniem. Dzięki temu skanujesz dokumenty telefonem i przesyłasz je do archiwum przez Wi‑Fi. Konto indywidualne obsługuje jeden telefon; plany Rodzinny i Firmowy dla wielu telefonów są w przygotowaniu.</p></div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-blue-500/50 bg-blue-950/30 p-5"><div className="text-4xl mb-3">🖥️</div><div className="text-blue-300 font-bold">1. Połącz urządzenia z Wi‑Fi</div><p className="text-sm text-slate-300 mt-2">Telefon i komputer muszą być w tej samej sieci lokalnej. Otwórz E‑Teczkę na obu urządzeniach.</p></div>
              <div className="rounded-xl border border-emerald-500/50 bg-emerald-950/30 p-5"><div className="text-4xl mb-3">📱</div><div className="text-emerald-300 font-bold">2. Zeskanuj kod QR</div><p className="text-sm text-slate-300 mt-2">W telefonie wybierz <b>Połączenie z komputerem → Skanuj kod QR</b> i skieruj aparat na ekran.</p></div>
              <div className="rounded-xl border border-violet-500/50 bg-violet-950/30 p-5"><div className="text-4xl mb-3">🔐</div><div className="text-violet-300 font-bold">3. Postępuj według wskazówek</div><p className="text-sm text-slate-300 mt-2">Telefon pobierze i sprawdzi certyfikat przez Wi‑Fi. Następnie wybierz „Połącz” w aplikacji mobilnej.</p></div>
            </div>
            <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-cyan-500/40 bg-cyan-950/20 p-5"><h3 className="font-bold text-cyan-200">Szyfrowane połączenie z telefonem</h3><p className="text-center text-sm text-slate-300">Na telefonie otwórz Połączenie z komputerem i zeskanuj kod QR. Aplikacja sprawdzi certyfikat przez Wi‑Fi i zapisze go w E‑Teczce. Nie musisz instalować certyfikatu w ustawieniach telefonu.</p><p className="max-w-full break-all text-center font-mono text-xs text-slate-400">Odcisk SHA-256 certyfikatu: {localCaFingerprint || 'niedostępny'}</p><p className="text-center text-sm text-slate-300">W aplikacji mobilnej wybierz „Skanuj kod QR”.</p>{localAddresses[0] && pairingCode && localCaFingerprint ? <div className="rounded-lg bg-white p-4"><QRCode value={JSON.stringify({ serverUrl: `https://${localAddresses[0]}`, pairingCode, caFingerprint: localCaFingerprint })} size={190} /></div> : <p className="text-sm text-amber-200">Serwer HTTPS nie jest gotowy. Uruchom ponownie E‑Teczkę na komputerze, a potem odśwież to okno.</p>}<p className="font-mono text-xs text-slate-400">{localAddresses[0] || 'brak adresu'} · {pairingCode || 'brak kodu'}</p></div>
            <div className="mt-5 rounded-xl border border-amber-500/40 bg-amber-950/30 p-5 grid md:grid-cols-[1fr_auto] gap-5 items-center">
              <div><h3 className="font-bold text-amber-200">Dlaczego adres IP czasem się zmienia?</h3><p className="text-sm text-slate-300 mt-1">Router przydziela adresy automatycznie (DHCP). Po restarcie routera lub komputera może przydzielić komputerowi inny adres.</p><p className="text-sm text-slate-300 mt-3"><b>Jak temu zapobiec:</b> w ustawieniach routera utwórz rezerwację DHCP dla tego komputera (najbezpieczniejsze rozwiązanie). Router będzie zawsze przydzielał mu ten sam adres.</p></div>
              <div className="text-5xl text-center">📡<div className="text-xs text-amber-200 mt-2">Rezerwacja DHCP</div></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
