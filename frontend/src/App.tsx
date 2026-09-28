import React, { useState, useEffect, useRef, useCallback } from 'react';
import DesktopAccessSettings from './DesktopAccessSettings';
import DocumentPreviewModal from './components/DocumentPreviewModal';
import DesktopSidebar from './components/DesktopSidebar';
import DesktopTopBar from './components/DesktopTopBar';
import BillingHistoryModal from './components/BillingHistoryModal';
import AuthModal from './components/AuthModal';
import BillingPlansModal from './components/BillingPlansModal';
import TagManagerModal from './components/TagManagerModal';
import RetentionModal, { type RetentionModalState } from './components/RetentionModal';
import MoveDocumentModal from './components/MoveDocumentModal';
import DestructiveActionModal, { type PendingAction } from './components/DestructiveActionModal';
import BulkMoveModal from './components/BulkMoveModal';
import { formatFileSize, getExpiryDate } from './utils/documentLifecycle';
import { errorMessage } from './utils/errors';
import type { DocumentPatch, DocumentRecord, FolderRecord, RetentionUnit, Tag } from './types/domain';
import { getElectronIpc, isWiaDeviceList, isWiaScanResult, readAndRemoveFileBase64, type WiaDevice } from './services/electron';

const API_URL = "http://localhost:3000";
const apiFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const requestUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, window.location.href);
  const token = localStorage.getItem('eteczka_auth_token');
  if (!token || requestUrl.origin !== new URL(API_URL).origin) return window.fetch(input, init);
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return window.fetch(input, { ...init, headers });
};
type ActionType = 'trash_doc' | 'delete_doc' | 'delete_folder';
type UploadFile = {
  file: File;
  enabled: boolean;
  value: number;
  unit: RetentionUnit;
};
type BillingTransaction = {
  id: number;
  type: string;
  status: string;
  amount: number;
  currency: string;
  description?: string | null;
  occurredAt: string;
};
type BillingDetails = {
  plan: 'free' | 'premium';
  status: string;
  interval?: 'month' | 'year' | null;
  intervalCount?: number;
  amount?: number;
  currency?: string;
  renewalAt?: string | null;
  cancellationPolicy?: string;
};

export default function App() {
  const fetch = apiFetch;
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [scannerFiles, setScannerFiles] = useState<unknown[]>([]);
  
  const [filesToUpload, setFilesToUpload] = useState<UploadFile[]>([]);
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
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  
  const [previewDoc, setPreviewDoc] = useState<DocumentRecord | null>(null);
  const [previewZoom, setPreviewZoom] = useState<number>(1);
  const [hoverDocId, setHoverDocId] = useState<number | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<number[]>([]);
  const [documentMenuId, setDocumentMenuId] = useState<number | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#2563eb');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isBillingPlansOpen, setIsBillingPlansOpen] = useState(false);
  const [billingPlan, setBillingPlan] = useState<'free' | 'premium'>('free');
  const [billingDetails, setBillingDetails] = useState<BillingDetails | null>(null);
  const [billingDetailsBusy, setBillingDetailsBusy] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingCancelBusy, setBillingCancelBusy] = useState(false);
  const [isBillingCancelOpen, setIsBillingCancelOpen] = useState(false);
  const [isBillingHistoryOpen, setIsBillingHistoryOpen] = useState(false);
  const [billingHistory, setBillingHistory] = useState<BillingTransaction[]>([]);
  const [billingHistoryBusy, setBillingHistoryBusy] = useState(false);
  
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [pairingCode, setPairingCode] = useState<string>('');
  const [localAddresses, setLocalAddresses] = useState<string[]>([]);
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
  const [folderDeletePreview, setFolderDeletePreview] = useState<{ id: number; name: string; documentCount: number } | null>(null);
  const [transferFolderId, setTransferFolderId] = useState('');
  const [isAccessSettingsOpen, setIsAccessSettingsOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isWiaScanOpen, setIsWiaScanOpen] = useState(false);
  const [wiaFolderId, setWiaFolderId] = useState('');
  const [wiaDevices, setWiaDevices] = useState<WiaDevice[]>([]);
  const [wiaDeviceId, setWiaDeviceId] = useState('');
  const [isWiaLoadingDevices, setIsWiaLoadingDevices] = useState(false);
  const [isWiaScanning, setIsWiaScanning] = useState(false);
  const [wiaStage, setWiaStage] = useState('');

  const hoverTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: string = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); }, []);

  const fetchData = useCallback(async () => {
    try {
      const [resDocs, resFolders, resScanner, resTags, resBilling] = await Promise.all([
        fetch(`${API_URL}/api/documents`).then(r => r.json()).catch(() => []),
        fetch(`${API_URL}/api/folders`).then(r => r.json()).catch(() => []),
        fetch(`${API_URL}/api/scanner`).then(r => r.json()).catch(() => []),
        fetch(`${API_URL}/api/tags`).then(r => r.json()).catch(() => []),
        fetch(`${API_URL}/api/billing/status`).then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      setDocuments(resDocs); setFolders(resFolders); setScannerFiles(resScanner); setTags(resTags);
      if (resBilling?.plan === 'premium') setBillingPlan('premium');
      else setBillingPlan('free');
    } catch {}
  }, []);

  const handleAuthenticated = useCallback((user: { name?: string | null; email: string }) => {
    setIsAuthOpen(false); setIsUserMenuOpen(false); showToast(`Zalogowano jako ${user.email}.`, 'success'); void fetchData();
  }, [fetchData, showToast]);

  const openBillingCheckout = useCallback(async (interval: 'monthly' | 'yearly') => {
    setBillingBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.url !== 'string') {
        throw new Error(payload.error || 'Nie udało się uruchomić płatności.');
      }
      window.open(payload.url, '_blank', 'noopener,noreferrer');
      setIsUserMenuOpen(false);
      showToast('Otworzono bezpieczną stronę płatności Stripe.', 'success');
    } catch (error: unknown) {
      showToast(errorMessage(error, 'Nie udało się uruchomić płatności Stripe.'), 'error');
    } finally {
      setBillingBusy(false);
    }
  }, [showToast]);

  const toggleUserMenu = useCallback(async () => {
    const willOpen = !isUserMenuOpen;
    setIsUserMenuOpen(willOpen);
    if (!willOpen || billingPlan !== 'premium') return;
    setBillingDetailsBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/manage`);
      const payload = await response.json().catch(() => null);
      if (response.ok && payload) setBillingDetails(payload as BillingDetails);
    } finally {
      setBillingDetailsBusy(false);
    }
  }, [billingPlan, isUserMenuOpen]);

  const cancelBilling = useCallback(async () => {
    setBillingCancelBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/billing/cancel-subscription`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nie udało się anulować Premium.');
      setBillingPlan('free');
      setBillingDetails(null);
      setIsBillingCancelOpen(false);
      const amount = typeof payload.refundedAmount === 'number' ? (payload.refundedAmount / 100).toFixed(2) : '0.00';
      const months = typeof payload.refundedMonths === 'number' ? payload.refundedMonths : 0;
      showToast(months > 0 ? `Premium anulowane. Zwrot: ${amount} zł za ${months} mies.` : 'Premium anulowane. Bieżący miesiąc pozostaje rozliczony.', 'success');
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
    const initialFetch = window.setTimeout(() => { void fetchData(); }, 0);
    const interval = window.setInterval(() => { void fetchData(); }, 5000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(interval);
    };
  }, [fetchData]);

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
    fetchPairingCode();
    const interval = setInterval(fetchPairingCode, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchNetworkInfo = async () => {
      try {
        const response = await fetch(`${API_URL}/api/network-info`);
        const data = await response.json();
        const port = data.port || 3000;
        setLocalAddresses((data.addresses || []).map((address: string) => `${address}:${port}`));
      } catch { setLocalAddresses([]); }
    };
    fetchNetworkInfo();
    const interval = setInterval(fetchNetworkInfo, 30000);
    return () => clearInterval(interval);
  }, []);

  const getDocExpiryInfo = (doc: DocumentRecord) => {
    const expiry = getExpiryDate(doc);
    if (!expiry) return { diffMs: 0, diffDays: 0, diffMonths: 0, diffMinutes: 0 };
    const now = new Date();
    const diffMs = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const diffMonths = Math.round(diffDays / 30);
    const diffMinutes = Math.ceil(diffMs / (1000 * 60));

    return { diffMs, diffDays, diffMonths, diffMinutes };
  };

  const getRetentionNotifications = () => {
    const alerts: { id: number, title: string; text: string; type: 'warning' | 'danger' }[] = [];
    documents.filter(d => d.retentionEnabled !== false && !d.isDeleted && !d.isArchived).forEach(doc => {
      const { diffMs, diffDays, diffMonths, diffMinutes } = getDocExpiryInfo(doc);
      if (diffMs > 0) {
        if (diffMinutes <= 60 && diffDays === 1) alerts.push({ id: doc.id, title: doc.title, text: `Wygasa za ${diffMinutes} min!`, type: 'danger' });
        else if (diffDays >= 1 && diffDays <= 15) alerts.push({ id: doc.id, title: doc.title, text: `Termin życia: ${diffDays} ${diffDays === 1 ? 'dzień' : 'dni'}.`, type: 'danger' });
        else if (diffMonths >= 1 && diffMonths <= 6) alerts.push({ id: doc.id, title: doc.title, text: `Termin życia: ${diffMonths} ${diffMonths === 1 ? 'miesiąc' : 'mies.'}.`, type: 'warning' });
      }
    });
    return alerts.sort((a) => a.type === 'danger' ? -1 : 1);
  };
  const retentionAlerts = getRetentionNotifications();
  const createTag = async () => {
    if (billingPlan !== 'premium') { showToast('Tagi są dostępne w planie Premium.', 'error'); return; }
    const name = newTagName.trim(); if (!name) return;
    const response = await fetch(`${API_URL}/api/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color: newTagColor }) });
    if (!response.ok) { showToast('Nie udało się dodać tagu.', 'error'); return; }
    setNewTagName(''); await fetchData(); showToast('Dodano tag.', 'success');
  };

  const initiateAction = (type: ActionType, id: number, name: string, transferId?: number | null) => { setPendingAction({type, id, name, transferFolderId: transferId}); setActionTimer(10); };

  const requestFolderDelete = async (id: number, name: string) => {
    try {
      const response = await fetch(`${API_URL}/api/folders/${id}/delete-preview`);
      if (!response.ok) throw new Error('Nie udało się sprawdzić kartoteki.');
      const preview = await response.json();
      if (preview.documentCount > 0) {
        setTransferFolderId('');
        setFolderDeletePreview({ id, name, documentCount: preview.documentCount });
      } else initiateAction('delete_folder', id, name);
    } catch (error: unknown) { showToast(errorMessage(error, 'Nie udało się sprawdzić kartoteki.'), 'error'); }
  };

  const executeAction = useCallback(async () => {
    if(!pendingAction) return;
    const {type, id} = pendingAction;
    setPendingAction(null); setActionTimer(null);
    try {
      if (type === 'trash_doc') { await fetch(`${API_URL}/api/documents/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isDeleted: true }) }); showToast("Przeniesiono do kosza", "success"); } 
      else if (type === 'delete_doc') { await fetch(`${API_URL}/api/documents/${id}`, { method: 'DELETE' }); showToast("Usunięto trwale", "success"); } 
      else if (type === 'delete_folder') {
        const response = await fetch(`${API_URL}/api/folders/${id}/delete-safely`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transferFolderId: pendingAction.transferFolderId }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Nie udało się usunąć kartoteki.');
        showToast(pendingAction.transferFolderId ? 'Dokumenty przeniesiono, a kartotekę usunięto.' : 'Kartoteka usunięta.', 'success');
        setActiveView('dashboard'); setSelectedFolderId(null);
      }
      await fetchData();
    } catch(error: unknown) { showToast(errorMessage(error), "error"); }
  }, [fetchData, pendingAction, showToast]);

  useEffect(() => {
    if (actionTimer === null) return;
    if (actionTimer === 0 && pendingAction) {
      const execution = window.setTimeout(() => { void executeAction(); }, 0);
      return () => window.clearTimeout(execution);
    }
    const timer = window.setTimeout(() => setActionTimer(value => value === null ? null : value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [actionTimer, pendingAction, executeAction]);

  const updateDocument = async (id: number, data: DocumentPatch) => {
    try {
      const res = await fetch(`${API_URL}/api/documents/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (res.ok) { showToast("Wykonano!", "success"); await fetchData(); }
    } catch { showToast("Błąd zapisu.", "error"); }
  };

  const handleRetentionUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retentionModal.docId) return;
    const restoreData = retentionModal.restoreFrom === 'archive'
      ? { isArchived: false }
      : retentionModal.restoreFrom === 'trash'
        ? { isDeleted: false, deletedAt: null }
        : {};
    await updateDocument(retentionModal.docId, {
      ...restoreData,
      retentionEnabled: retentionModal.restoreFrom ? true : retentionModal.enabled,
      retentionValue: retentionModal.value,
      retentionUnit: retentionModal.unit,
      ...(retentionModal.restoreFrom ? { createdAt: new Date().toISOString() } : {}),
    });
    setRetentionModal({ ...retentionModal, isOpen: false });
  };

  const beginRestore = (doc: Pick<DocumentRecord, 'id'>, restoreFrom: 'archive' | 'trash') => {
    setRetentionModal({
      isOpen: true,
      docId: doc.id,
      value: 5,
      unit: 'years',
      enabled: true,
      restoreFrom,
    });
  };

  const generatePdfThumbnail = async (file: File): Promise<string | null> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 0.5 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.8);
    } catch { return null; }
  };

  const handleBatchUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (filesToUpload.length === 0 || !folderId) return showToast("Wybierz pliki i kartotekę!", "error");
    if (isMergeMode && !mergedTitle) return showToast("Podaj tytuł PDF!", "error");
    setIsUploading(true);
    try {
      const filePromises = filesToUpload.map((item) => {
        return new Promise((resolve) => { void (async () => {
          const file = item.file;
          let thumbnail: string | null = null;
          if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            thumbnail = await generatePdfThumbnail(file);
            const reader = new FileReader(); 
            reader.onload = (ev) => resolve({ name: file.name, data: ev.target?.result, thumbnail }); 
            reader.readAsDataURL(file); return;
          }
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = new Image(); img.onload = () => {
              const canvas = document.createElement('canvas');
              let width = img.width, height = img.height; const MAX_SIZE = 1600;
              if (width > height && width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } 
              else if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
              canvas.width = width; canvas.height = height;
              const ctx = canvas.getContext('2d'); ctx?.drawImage(img, 0, 0, width, height);
              resolve({ name: file.name.replace(/\.[^/.]+$/, "") + ".jpg", data: canvas.toDataURL('image/jpeg', 0.8), thumbnail: canvas.toDataURL('image/jpeg', 0.1) });
            }; img.src = event.target?.result as string;
          }; reader.readAsDataURL(file);
        })(); });
      });
      const convertedFiles = await Promise.all(filePromises);
      const res = await fetch(`${API_URL}/api/documents/upload-base64`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: convertedFiles, folderId: Number(folderId), physicalLocation: physicalLocation || null,
          retentions: filesToUpload.map(item => ({ enabled: item.enabled, value: item.value, unit: item.unit })),
          isMerge: isMergeMode, mergedTitle, mergedRetention: { enabled: mergedRetentionEnabled, value: mergedRetentionVal, unit: mergedRetentionUnit }
        })
      });
      if (res.ok) {
        showToast("Zarchiwizowano!", "success");
        setFilesToUpload([]); setPhysicalLocation(''); setMergedTitle(''); setActiveView('dashboard'); await fetchData();
      } else showToast("Błąd zapisu.", "error");
    } catch { showToast("Błąd.", "error"); }
    setIsUploading(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFilesToUpload(prev => [...prev, ...Array.from(e.target.files!).map(file => ({ file, enabled: true, value: 5, unit: 'years' as RetentionUnit }))]);
  };
  const openWiaScanner = async () => {
    if (billingPlan !== 'premium') return showToast('Skanowanie z drukarki wymaga planu Premium.', 'error');
    const ipc = getElectronIpc();
    if (!ipc) return showToast('Skanowanie WIA działa w zainstalowanej aplikacji desktopowej.', 'error');
    setIsWiaScanOpen(true); setWiaStage('Wyszukiwanie skanerów…'); setIsWiaLoadingDevices(true); setWiaDevices([]); setWiaDeviceId('');
    try {
      const response = await ipc.invoke('eteczka-wia-devices');
      const devices = isWiaDeviceList(response) ? response : [];
      setWiaDevices(devices);
      if (devices.length === 1) setWiaDeviceId(devices[0].id);
      setWiaStage(devices.length ? 'Wybierz skaner i kartotekę docelową.' : 'Nie znaleziono skanera WIA.');
    } catch (error: unknown) { setWiaStage(errorMessage(error, 'Nie udało się odczytać listy skanerów.')); }
    finally { setIsWiaLoadingDevices(false); }
  };

  const scanFromPrinter = async () => {
    if (billingPlan !== 'premium') return showToast('Skanowanie z drukarki wymaga planu Premium.', 'error');
    if (!wiaFolderId) return showToast('Wybierz podkartotekę docelową.', 'error');
    if (!wiaDeviceId) return showToast('Wybierz skaner.', 'error');
    const ipc = getElectronIpc();
    if (!ipc) return showToast('Skanowanie WIA działa w zainstalowanej aplikacji desktopowej.', 'error');
    setIsWiaScanning(true); setWiaStage('Przygotowanie skanowania…');
    try {
      const scanResponse = await ipc.invoke('eteczka-wia-scan', wiaDeviceId);
      if (!isWiaScanResult(scanResponse)) throw new Error('Nieprawidłowa odpowiedź skanera.');
      const result = scanResponse;
      if (!result?.ok || !result.path) throw new Error('Nie odebrano obrazu ze skanera.');
      setWiaStage('Zapisywanie dokumentu…');
      const base64 = readAndRemoveFileBase64(result.path);
      const response = await fetch(`${API_URL}/api/documents/upload-base64`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'printer-scan', files: [{ name: `Skan drukarki ${new Date().toLocaleString('pl-PL')}.jpg`, data: `data:image/jpeg;base64,${base64}` }], folderId: Number(wiaFolderId), retentions: [{ enabled: true, value: 5, unit: 'years' }] }) });
      if (!response.ok) throw new Error('Nie udało się zapisać skanu do wskazanej kartoteki.');
      setIsWiaScanOpen(false); setWiaFolderId(''); setWiaDeviceId(''); await fetchData(); showToast('Skan z drukarki zapisany w kartotece.', 'success');
    } catch (error: unknown) { showToast(errorMessage(error, 'Nie udało się zeskanować dokumentu.'), 'error'); }
    finally { setIsWiaScanning(false); }
  };
  const toggleDocSelection = (id: number) => setSelectedDocs(prev => prev.includes(id) ? prev.filter(dId => dId !== id) : [...prev, id]);
  const selectAllVisibleDocs = () => setSelectedDocs(displayedDocs.map(doc => doc.id));
  const clearSelectedDocs = () => setSelectedDocs([]);
  const updateSelectedDocs = async (data: Record<string, unknown>, successMessage: string) => {
    if (!selectedDocs.length) return;
    try {
      const responses = await Promise.all(selectedDocs.map(id => fetch(`${API_URL}/api/documents/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })));
      if (responses.some(response => !response.ok)) throw new Error();
      clearSelectedDocs(); await fetchData(); showToast(successMessage, 'success');
    } catch { showToast('Nie udało się wykonać operacji dla wszystkich dokumentów.', 'error'); }
  };
  const moveSelectedDocs = async (folderId: number) => {
    await updateSelectedDocs({ folderId }, 'Dokumenty przeniesiono.');
    setIsBulkMoveOpen(false);
  };

  const handleCreateFolder = async (parentId: number | null) => {
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch(`${API_URL}/api/folders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newFolderName.trim(), parentId }) });
      if (res.ok) { setAddingSubfolderTo(null); setNewFolderName(''); if (parentId) setExpandedFolders(prev => [...prev, parentId]); await fetchData(); }
    } catch {}
  };

  const handleRenameFolder = async (id: number) => {
    if (!renamingFolderName.trim()) return;
    try {
      const res = await fetch(`${API_URL}/api/folders/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: renamingFolderName.trim() }) });
      if (res.ok) { setRenamingFolderId(null); await fetchData(); }
    } catch {}
  };

  const moveFolder = async (id: number, direction: 'up' | 'down') => {
    try { await fetch(`${API_URL}/api/folders/${id}/move`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }) }); await fetchData(); } catch {}
  };

  const toggleFolderExpand = (id: number) => setExpandedFolders(prev => prev.includes(id) ? prev.filter(fId => fId !== id) : [...prev, id]);
  const getSortedChildren = (parentId: number | null) => folders.filter(f => f.parentId === parentId).sort((a, b) => (a.order || 0) - (b.order || 0));

  const renderDashboardFolder = (folder: FolderRecord, depth = 0): React.ReactNode => {
    const children = getSortedChildren(folder.id);
    const isExpanded = expandedFolders.includes(folder.id);
    const hasChildren = children.length > 0;
    const openFolder = () => {
      if (hasChildren) return toggleFolderExpand(folder.id);
      setSelectedFolderId(folder.id);
      setActiveView('folder');
    };
    return <div key={folder.id} className={depth ? 'ml-7 border-l border-slate-700 pl-4' : ''}>
      <div className="flex items-center gap-2"><button onClick={openFolder} className="flex-1 flex items-center gap-4 rounded-lg border border-slate-700 bg-[#1e293b] px-5 py-4 text-left hover:border-blue-500 hover:bg-[#263449] transition-all">
        <span className="text-2xl">{hasChildren ? (isExpanded ? '📂' : '📁') : '📄'}</span>
        <span className="flex-1">{renamingFolderId === folder.id ? <input autoFocus value={renamingFolderName} onClick={(event) => event.stopPropagation()} onChange={(event) => setRenamingFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') handleRenameFolder(folder.id); if (event.key === 'Escape') setRenamingFolderId(null); }} className="w-full rounded bg-[#111827] border border-blue-500 px-2 py-1 text-lg font-bold text-white" /> : <span className="block text-lg font-bold text-white">{folder.name}</span>}<span className="mt-1 block text-sm text-blue-300">{hasChildren ? `${children.length} ${children.length === 1 ? 'podkartoteka' : 'podkartoteki'}` : `${folder._count?.documents ?? 0} dokumentów`}</span></span>
        <span className="text-xl text-slate-400">{hasChildren ? (isExpanded ? '⌄' : '›') : '›'}</span>
      </button>{isEditingFolders && <div className="flex gap-1"><button onClick={() => { setAddingSubfolderTo(folder.id); setNewFolderName(''); setExpandedFolders(value => value.includes(folder.id) ? value : [...value, folder.id]); }} className="p-2 text-blue-300 hover:text-white" title="Dodaj podkartotekę">＋</button><button onClick={() => { setRenamingFolderId(folder.id); setRenamingFolderName(folder.name); }} className="p-2 text-amber-300 hover:text-white" title="Zmień nazwę">✎</button><button onClick={() => void requestFolderDelete(folder.id, folder.name)} className="p-2 text-red-300 hover:text-white" title="Usuń">🗑</button></div>}</div>
      {isEditingFolders && addingSubfolderTo === folder.id && <div className="mt-2 flex gap-2"><input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder(folder.id)} placeholder="Nazwa podkartoteki" className="flex-1 rounded bg-[#111827] border border-slate-600 px-3 py-2 text-sm text-white" /><button onClick={() => handleCreateFolder(folder.id)} className="rounded bg-blue-600 px-3 text-sm font-bold text-white">Dodaj</button><button onClick={() => setAddingSubfolderTo(null)} className="px-2 text-slate-400">×</button></div>}
      {hasChildren && isExpanded && <div className="mt-2 space-y-2">{children.map(child => renderDashboardFolder(child, depth + 1))}</div>}
    </div>;
  };


  // =========================================================
  // IDEALNIE CZYTELNE DRZEWKO DO WYBORU KARTOTEKI (<SELECT>)
  // =========================================================
  const renderSelectOptions = (parentId: number | null = null, depth: number = 0): React.ReactElement[] => {
    let options: React.ReactElement[] = [];
    const children = getSortedChildren(parentId);
    
    children.forEach(child => {
      // Twarde spacje gwarantują, że przeglądarka nie zetnie wcięć
      const spaces = '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'.repeat(depth); 
      const arrow = depth > 0 ? '↳ ' : '';
      const icon = depth === 0 ? '📂' : '📁';
      const prefix = `${spaces}${arrow}${icon} `;
      
      options.push(
        <option 
          key={child.id} 
          value={child.id} 
          // Wyróżnienie głównej kartoteki na liście ułatwia orientację
          className={depth === 0 ? 'font-bold bg-[#0f172a] text-blue-400' : 'font-medium text-slate-200'}
        >
          {prefix}{child.name}
        </option>
      );
      
      options = options.concat(renderSelectOptions(child.id, depth + 1));
    });
    
    return options;
  };
  // =========================================================


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

  const exportSelectedPdf = useCallback(async () => {
    if (!selectedDocs.length) return;
    if (billingPlan !== 'premium') return showToast('Eksport grupowy do PDF wymaga planu Premium.', 'error');
    try {
      const response = await fetch(`${API_URL}/api/documents/export-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: selectedDocs }) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'Nie udało się wyeksportować dokumentów.'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `eteczka-eksport-${new Date().toISOString().slice(0, 10)}.pdf`; anchor.click(); URL.revokeObjectURL(url);
      showToast(`Wyeksportowano ${selectedDocs.length} dokumentów do jednego PDF-a.`, 'success');
    } catch (error: unknown) { showToast(errorMessage(error, 'Nie udało się wyeksportować dokumentów.'), 'error'); }
  }, [billingPlan, selectedDocs, showToast]);

  const displayedDocs = documents.filter(doc => {
    if (activeView === 'trash') return doc.isDeleted;
    if (activeView === 'archive') return doc.isArchived && !doc.isDeleted;
    const query = searchQuery.toLowerCase();
    const matchesSearch = !query || doc.title.toLowerCase().includes(query) || Boolean(doc.ocrText?.toLowerCase().includes(query));
    if (activeView === 'dashboard') return !doc.isDeleted && !doc.isArchived && matchesSearch;
    if (activeView === 'folder') return doc.folderId === selectedFolderId && !doc.isDeleted && !doc.isArchived && matchesSearch;
    return false;
  });

  return (
    <div className="flex h-screen bg-[#111827] text-slate-300 font-sans text-sm">
      {toast && (
        <div role="status" className={`fixed bottom-5 right-5 z-50 min-w-80 border-l-4 px-5 py-4 rounded-md shadow-2xl font-medium ${toast.type === 'error' ? 'border-red-400 bg-red-950 text-red-50' : 'border-emerald-400 bg-emerald-950 text-emerald-50'}`}>
          {toast.message}
        </div>
      )}

      {previewDoc && <DocumentPreviewModal apiUrl={API_URL} document={previewDoc} zoom={previewZoom} onZoomChange={setPreviewZoom} onClose={() => { setPreviewDoc(null); setPreviewZoom(1); }} />}

      {isBillingCancelOpen && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-[#0f172a] p-7 shadow-2xl"><h3 className="text-xl font-bold text-white">Anulować Premium?</h3><p className="mt-3 text-sm leading-6 text-slate-300">Dostęp Premium zostanie zakończony od razu. Bieżący rozpoczęty miesiąc pozostaje opłacony, a system zwróci środki za pełne niewykorzystane miesiące.</p><div className="mt-6 flex gap-3"><button disabled={billingCancelBusy} onClick={() => setIsBillingCancelOpen(false)} className="flex-1 rounded-lg bg-slate-700 py-3 font-bold text-white hover:bg-slate-600 disabled:opacity-50">Nie</button><button disabled={billingCancelBusy} onClick={() => void cancelBilling()} className="flex-1 rounded-lg bg-red-600 py-3 font-bold text-white hover:bg-red-500 disabled:opacity-50">{billingCancelBusy ? 'Rozliczanie…' : 'Anuluj i zwróć'}</button></div></div></div>}

      {isBillingHistoryOpen && <BillingHistoryModal transactions={billingHistory} loading={billingHistoryBusy} onClose={() => setIsBillingHistoryOpen(false)} />}

      <TagManagerModal
        isOpen={isTagManagerOpen}
        tags={tags}
        name={newTagName}
        color={newTagColor}
        onNameChange={setNewTagName}
        onColorChange={setNewTagColor}
        onCreate={() => void createTag()}
        onDelete={(tagId) => void (async () => { await fetch(`${API_URL}/api/tags/${tagId}`, { method: 'DELETE' }); await fetchData(); })()}
        onClose={() => setIsTagManagerOpen(false)}
      />

      <MoveDocumentModal
        documentId={moveModalDocId}
        folderOptions={renderSelectOptions(null)}
        onMove={(folderId) => updateDocument(moveModalDocId!, { folderId })}
        onClose={() => setMoveModalDocId(null)}
      />

      <BulkMoveModal
        isOpen={isBulkMoveOpen}
        documentCount={selectedDocs.length}
        folderOptions={renderSelectOptions(null)}
        onMove={(folderId) => void moveSelectedDocs(folderId)}
        onClose={() => setIsBulkMoveOpen(false)}
      />

      {folderDeletePreview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/50 bg-[#0f172a] p-7 shadow-2xl">
            <h3 className="text-xl font-bold text-white">Najpierw przenieś dokumenty</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">W kartotece „{folderDeletePreview.name}” i jej podkartotekach jest <strong className="text-white">{folderDeletePreview.documentCount}</strong> dokumentów. Wybierz podkartotekę, do której mają zostać przeniesione przed usunięciem struktury.</p>
            <select value={transferFolderId} onChange={(event) => setTransferFolderId(event.target.value)} className="mt-5 w-full rounded-md border border-slate-600 bg-[#111827] px-3 py-3 text-white focus:border-blue-500 focus:outline-none">
              <option value="">— wybierz podkartotekę docelową —</option>
              {renderSelectOptions(null)}
            </select>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setFolderDeletePreview(null)} className="flex-1 rounded-lg bg-slate-700 py-3 font-bold text-white hover:bg-slate-600">Anuluj</button>
              <button disabled={!transferFolderId} onClick={() => { const preview = folderDeletePreview; setFolderDeletePreview(null); initiateAction('delete_folder', preview.id, preview.name, Number(transferFolderId)); }} className="flex-1 rounded-lg bg-red-600 py-3 font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">Dalej</button>
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
        onConfirm={() => void executeAction()}
      />

      <RetentionModal
        state={retentionModal}
        onStateChange={setRetentionModal}
        onSubmit={handleRetentionUpdate}
        onClose={() => setRetentionModal({ ...retentionModal, isOpen: false })}
      />

      <DesktopSidebar
        activeView={activeView}
        documents={documents}
        isSettingsMenuOpen={isSettingsMenuOpen}
        onViewChange={(view) => { setActiveView(view); if (view === 'dashboard') setSelectedFolderId(null); }}
        onOpenScanner={() => void openWiaScanner()}
        onToggleSettings={() => setIsSettingsMenuOpen((value) => !value)}
        onOpenPairing={() => setIsPairingGuideOpen(true)}
        onOpenAccessSettings={() => setIsAccessSettingsOpen(true)}
        onOpenTags={() => setIsTagManagerOpen(true)}
      />
      {/* GŁÓWNA ZAWARTOŚĆ */}
      {isAccessSettingsOpen && <DesktopAccessSettings onClose={() => setIsAccessSettingsOpen(false)} />}
      {isWiaScanOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"><div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-600 bg-[#1e293b] shadow-2xl"><div className="border-b border-slate-700 bg-[#0f172a] px-7 py-5"><h3 className="text-xl font-bold text-white">Skanuj z urządzenia</h3><p className="mt-1 text-sm text-slate-400">Wybór urządzenia i przebieg skanowania odbywają się w E‑Teczce.</p></div><div className="space-y-5 p-7"><div><label className="block text-sm font-semibold text-slate-200">1. Wybierz skaner</label><div className="mt-2 grid gap-2">{isWiaLoadingDevices && <div className="rounded-lg border border-slate-700 bg-[#111827] px-4 py-3 text-sm text-slate-400">Wyszukiwanie urządzeń…</div>}{!isWiaLoadingDevices && wiaDevices.map(device => <button key={device.id} onClick={() => setWiaDeviceId(device.id)} disabled={isWiaScanning} className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${wiaDeviceId === device.id ? 'border-blue-400 bg-blue-500/15' : 'border-slate-600 bg-[#111827] hover:border-slate-400'}`}><span className="text-2xl">🖨️</span><span><span className="block font-semibold text-white">{device.name}</span>{device.manufacturer && <span className="mt-0.5 block text-xs text-slate-400">{device.manufacturer}</span>}</span>{wiaDeviceId === device.id && <span className="ml-auto text-blue-300">✓</span>}</button>)}{!isWiaLoadingDevices && wiaDevices.length === 0 && <div className="rounded-lg border border-amber-700/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">Nie znaleziono skanera WIA. Upewnij się, że jest włączony i ma zainstalowany sterownik WIA.</div>}</div></div><div><label className="block text-sm font-semibold text-slate-200">2. Zapisz do podkartoteki</label><select value={wiaFolderId} disabled={isWiaScanning} onChange={(event) => setWiaFolderId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white"><option value="">— wybierz podkartotekę —</option>{renderSelectOptions(null)}</select></div><div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3"><p className="text-sm font-semibold text-blue-200">{isWiaScanning ? wiaStage : 'Gotowe do skanowania'}</p>{isWiaScanning && <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-700"><div className="h-full w-2/3 animate-pulse rounded bg-blue-400" /></div>}</div><div className="flex justify-end gap-3"><button onClick={() => { if (!isWiaScanning) setIsWiaScanOpen(false); }} disabled={isWiaScanning} className="px-4 py-2 text-slate-300 disabled:opacity-50">Anuluj</button><button onClick={() => void scanFromPrinter()} disabled={!wiaFolderId || !wiaDeviceId || isWiaScanning} className="rounded-lg bg-blue-600 px-5 py-2.5 font-bold text-white shadow-lg hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">{isWiaScanning ? 'Trwa skanowanie…' : 'Skanuj dokument'}</button></div></div></div></div>}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0f172a]">
        <DesktopTopBar
          activeView={activeView}
          searchQuery={searchQuery}
          localAddress={localAddresses[0] || ''}
          pairingCode={pairingCode}
          scannerFileCount={scannerFiles.length}
          retentionAlerts={retentionAlerts}
          notificationsOpen={isNotificationsOpen}
          userMenuOpen={isUserMenuOpen}
          billingPlan={billingPlan}
          billingDetails={billingDetails}
          billingDetailsBusy={billingDetailsBusy}
          billingBusy={billingBusy}
          billingCancelBusy={billingCancelBusy}
          onSearchChange={setSearchQuery}
          onBack={() => { setActiveView('dashboard'); setSelectedFolderId(null); }}
          onToggleNotifications={() => setIsNotificationsOpen((value) => !value)}
          onOpenScannerInbox={() => { setActiveView('upload'); setIsNotificationsOpen(false); }}
          onOpenNotification={(documentId) => { const doc = documents.find((item) => item.id === documentId); if (doc) { setSelectedFolderId(doc.folderId); setActiveView('folder'); } setIsNotificationsOpen(false); }}
          onToggleUserMenu={() => void toggleUserMenu()}
          onOpenBillingPlans={() => { setIsBillingPlansOpen(true); setIsUserMenuOpen(false); }}
          onRequestCancelBilling={() => { setIsBillingCancelOpen(true); setIsUserMenuOpen(false); }}
          onOpenBillingHistory={() => { setIsUserMenuOpen(false); void openBillingHistory(); }}
          onOpenAuth={() => { setIsAuthOpen(true); setIsUserMenuOpen(false); }}
          onOpenAccessSettings={() => { setIsAccessSettingsOpen(true); setIsUserMenuOpen(false); }}
          onOpenSettings={() => { setIsSettingsMenuOpen(true); setIsUserMenuOpen(false); }}
        />
        <main className="relative flex-1 overflow-y-auto p-6 flex justify-center custom-scrollbar">
          {selectedDocs.length > 0 && activeView !== 'dashboard' && <button onClick={() => void exportSelectedPdf()} className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-xl hover:bg-emerald-500">Eksportuj zaznaczone do PDF ({selectedDocs.length})</button>}
          {activeView === 'upload' ? (
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
                    {renderSelectOptions(null)}
                  </select>
                </div>

                <div>
                  <label className="flex items-center gap-1 text-sm font-medium mb-1 text-orange-400">
                    📍 Fizyczna lokalizacja (Opcjonalnie)
                  </label>
                  <input type="text" placeholder="np. Szafka biurowa A, półka 2..." value={physicalLocation} onChange={(e) => setPhysicalLocation(e.target.value)} className="w-full bg-[#111827] border border-slate-600 rounded-md p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500" />
                </div>

                <div className="flex justify-end pt-4">
                  <button type="submit" disabled={isUploading || filesToUpload.length === 0} className="px-6 py-2.5 bg-slate-200 hover:bg-white text-slate-800 rounded-md font-bold shadow-lg disabled:opacity-50 transition-colors">
                    {isUploading ? 'Przetwarzanie...' : `Wgraj osobno (${filesToUpload.length}) plików`}
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
                {activeView === 'dashboard' && <button onClick={() => { setIsEditingFolders(value => !value); setAddingSubfolderTo(null); }} className="rounded-md border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700">{isEditingFolders ? '✓ Gotowe' : '✎ Edytuj kartoteki'}</button>}
              </div>
              {activeView === 'dashboard' ? <div className="max-w-4xl space-y-3">{isEditingFolders && <div className="rounded-lg border border-dashed border-slate-500 p-3"><p className="mb-2 text-sm font-semibold text-slate-300">Dodaj kartotekę główną</p>{addingSubfolderTo === 'root' ? <div className="flex gap-2"><input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleCreateFolder(null)} placeholder="Nazwa kartoteki" className="flex-1 rounded bg-[#111827] border border-slate-600 px-3 py-2 text-sm text-white" /><button onClick={() => handleCreateFolder(null)} className="rounded bg-blue-600 px-3 text-sm font-bold text-white">Dodaj</button><button onClick={() => setAddingSubfolderTo(null)} className="px-2 text-slate-400">×</button></div> : <button onClick={() => { setAddingSubfolderTo('root'); setNewFolderName(''); }} className="text-sm text-blue-300 hover:text-white">＋ Dodaj kartotekę główną</button>}</div>}{getSortedChildren(null).map(folder => renderDashboardFolder(folder))}</div> : <><div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-950/30 px-3 py-2"><button onClick={() => selectedDocs.length === displayedDocs.length ? clearSelectedDocs() : selectAllVisibleDocs()} className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">{selectedDocs.length === displayedDocs.length && displayedDocs.length ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}</button>{selectedDocs.length > 0 && <><span className="px-1 text-xs font-semibold text-blue-200">Wybrano: {selectedDocs.length}</span><button onClick={() => setIsBulkMoveOpen(true)} className="rounded border border-indigo-500/70 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/10">Przenieś</button>{activeView !== 'archive' && <button onClick={() => void updateSelectedDocs({ isArchived: true }, 'Dokumenty zarchiwizowano.')} className="rounded border border-amber-600/70 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-600/10">Archiwizuj</button>}{activeView !== 'trash' && <button onClick={() => void updateSelectedDocs({ isDeleted: true }, 'Dokumenty przeniesiono do kosza.')} className="rounded border border-red-500/70 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">Do kosza</button>}<button onClick={() => showToast('Wysyłka wymaga wskazania odbiorcy i konfiguracji poczty.', 'error')} className="rounded border border-emerald-500/70 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/10">Wyślij</button></>}</div><div className="bg-[#1e293b] rounded-lg border border-slate-700 overflow-visible shadow-xl">
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
                              onMouseEnter={() => handleHoverEnter(doc.id)}
                              onMouseLeave={handleHoverLeave}
                            >
                              {doc.thumbnail ? (
                                <img src={doc.thumbnail} className="w-full h-full object-cover pointer-events-none" />
                              ) : doc.mimeType?.includes('image') ? (
                                <img src={`${API_URL}/${doc.filePath?.replace(/\\/g, '/')}`} className="w-full h-full object-cover pointer-events-none" />
                              ) : (
                                <span className="text-3xl pointer-events-none">📄</span>
                              )}
                              <div className="absolute inset-0 bg-black/0 hover:bg-blue-500/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded shadow pointer-events-none">Powiększ</span>
                              </div>
                            </div>

                            {hoverDocId === doc.id && (
                              <div 
                                className="absolute top-[-100px] left-20 bg-[#1e293b] border border-blue-500 shadow-[0_0_40px_rgba(0,0,0,0.8)] z-50 rounded-lg flex flex-col animate-fade-in"
                                style={{ width: '500px', height: '600px', minWidth: '400px', minHeight: '400px', maxWidth: '90vw', maxHeight: '90vh', resize: 'both', overflow: 'hidden' }}
                                onMouseEnter={() => handleHoverEnter(doc.id)}
                                onMouseLeave={handleHoverLeave}
                              >
                                <div className="text-xs bg-slate-800 text-blue-300 font-bold p-2 truncate border-b border-slate-700 flex justify-between items-center cursor-move shrink-0">
                                  <span>{doc.title}</span>
                                  <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">↘ Rozciągnij w rogu</span>
                                </div>
                                <div className="flex-1 bg-white relative w-full h-full">
                                  {doc.mimeType?.includes('pdf') ? (
                                    <iframe src={`${API_URL}/${doc.filePath?.replace(/\\/g, '/')}#toolbar=1&navpanes=0&view=Fit`} className="absolute inset-0 w-full h-full border-none" />
                                  ) : (
                                    <img src={`${API_URL}/${doc.filePath?.replace(/\\/g, '/')}`} className="absolute inset-0 w-full h-full object-contain" />
                                  )}
                                </div>
                              </div>
                            )}
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
                            <div className="mt-1 flex flex-wrap gap-1">{(doc.tags || []).map((entry) => <span key={entry.tagId} className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: entry.tag.color }}>{entry.tag.name}</span>)}</div>
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
                            {documentMenuId === doc.id && <div className="absolute right-0 top-10 z-40 w-52 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left shadow-2xl"><button onClick={() => { setMoveModalDocId(doc.id); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Przenieś</button>{activeView === 'trash' ? <><button onClick={() => { beginRestore(doc, 'trash'); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-emerald-300 hover:bg-slate-700">Przywróć</button><button onClick={() => { initiateAction('delete_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-red-300 hover:bg-slate-700">Usuń trwale</button></> : <>{activeView === 'archive' ? <button onClick={() => { beginRestore(doc, 'archive'); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Przywróć</button> : <button onClick={() => { void updateDocument(doc.id, { isArchived: true }); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-amber-300 hover:bg-slate-700">Archiwizuj</button>}<button onClick={() => { setRetentionModal({ isOpen: true, docId: doc.id, value: doc.retentionValue || 5, unit: doc.retentionUnit || 'years', enabled: doc.retentionEnabled !== false }); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Edytuj termin życia</button><button onClick={() => { initiateAction('trash_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-red-300 hover:bg-slate-700">Do kosza</button></>}<div className="my-1 border-t border-slate-700" />{tags.map(tag => <button key={tag.id} onClick={() => { const tagIds = (doc.tags || []).map((entry) => entry.tagId); void updateDocument(doc.id, { tagIds: tagIds.includes(tag.id) ? tagIds.filter((id) => id !== tag.id) : [...tagIds, tag.id] }); setDocumentMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />{(doc.tags || []).some((entry) => entry.tagId === tag.id) ? '✓ ' : ''}{tag.name}</button>)}</div>}
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
      {isBillingPlansOpen && <BillingPlansModal busy={billingBusy} onClose={() => setIsBillingPlansOpen(false)} onSelect={(interval) => { setIsBillingPlansOpen(false); void openBillingCheckout(interval); }} />}

      {isPairingGuideOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-950/80 flex items-center justify-center p-6" onClick={() => setIsPairingGuideOpen(false)}>
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-600 bg-[#1e293b] shadow-2xl p-7" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-5 mb-6">
              <div><h2 className="text-2xl font-bold text-white">Połącz telefon z E‑Teczką</h2><p className="text-slate-400 mt-1">Połączenie działa wyłącznie w Twojej sieci lokalnej.</p></div>
              <button onClick={() => setIsPairingGuideOpen(false)} className="text-slate-400 hover:text-white text-2xl">×</button>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-blue-500/50 bg-blue-950/30 p-5"><div className="text-4xl mb-3">🖥️</div><div className="text-blue-300 font-bold">1. Spójrz na ten pasek</div><p className="text-sm text-slate-300 mt-2">Przepisz do telefonu adres <span className="font-mono text-white">{localAddresses[0] || 'IP:3000'}</span> oraz kod <span className="font-mono text-white">{pairingCode || '—'}</span>.</p></div>
              <div className="rounded-xl border border-emerald-500/50 bg-emerald-950/30 p-5"><div className="text-4xl mb-3">📱</div><div className="text-emerald-300 font-bold">2. Otwórz System w telefonie</div><p className="text-sm text-slate-300 mt-2">W E‑Teczka Mobile wybierz zakładkę <b>System</b>, wpisz adres IP i kod z komputera.</p></div>
              <div className="rounded-xl border border-violet-500/50 bg-violet-950/30 p-5"><div className="text-4xl mb-3">🔐</div><div className="text-violet-300 font-bold">3. Kliknij „Połącz”</div><p className="text-sm text-slate-300 mt-2">Kod jest jednorazowy. Po sparowaniu telefon dostaje własny klucz dostępu, a dokumenty nie są wysyłane do chmury.</p></div>
            </div>
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
