import { useCallback, useEffect, useState } from 'react';
import type { PendingAction } from '../components/DestructiveActionModal';
import type { RetentionModalState } from '../components/RetentionModal';
import type { BulkRetention } from '../components/BulkMoveModal';
import { deleteDocument, patchDocument } from '../services/documentApi';
import { deleteFolderSafely } from '../services/folderActions';
import { errorMessage } from '../utils/errors';
import type { DocumentPatch, DocumentRecord } from '../types/domain';
import { useFolderTreeActions } from './useFolderTreeActions';
import { useTagAndOcrActions } from './useTagAndOcrActions';

type Args = {
  apiUrl: string;
  fetcher: typeof fetch;
  activeView: string;
  setActiveView: (view: string) => void;
  setSelectedFolderId: (id: number | null) => void;
  selectedDocs: number[];
  setSelectedDocs: React.Dispatch<React.SetStateAction<number[]>>;
  displayedDocs: DocumentRecord[];
  billingPlan: 'free' | 'standard' | 'premium';
  setPlanLimitMessage: (msg: string) => void;
  searchQuery: string;
  fetchData: () => Promise<void>;
  showToast: (message: string, type?: string) => void;
};

/** Orchestrates document mutations, destructive action confirmation, retention, and composed folder/tag/OCR hooks. */
export function useDocumentAndFolderActions({
  apiUrl, fetcher: fetch, activeView, setActiveView, setSelectedFolderId,
  selectedDocs, setSelectedDocs, displayedDocs, billingPlan, setPlanLimitMessage,
  searchQuery, fetchData, showToast,
}: Args) {
  const [retentionModal, setRetentionModal] = useState<RetentionModalState>({ isOpen: false, docId: null, value: 5, unit: 'years', enabled: true });
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionTimer, setActionTimer] = useState<number | null>(null);

  const initiateAction = (
    type: PendingAction['type'],
    id: number,
    name: string,
    transferId?: number | null,
    archivedCount = 0,
    trashedCount = 0,
    extra?: { deleteMode?: 'transfer' | 'trash'; docIds?: number[]; onAfter?: () => void },
  ) => {
    setPendingAction({ type, id, name, transferFolderId: transferId, archivedCount, trashedCount, ...extra });
    setActionTimer(5);
  };

  const folderActions = useFolderTreeActions({
    apiUrl,
    fetcher: fetch,
    fetchData,
    showToast,
    onConfirmEmptyDelete: (id, name, archivedCount, trashedCount) => initiateAction('delete_folder', id, name, null, archivedCount, trashedCount),
  });

  const tagAndOcr = useTagAndOcrActions({
    apiUrl, fetcher: fetch, selectedDocs, billingPlan, setPlanLimitMessage, searchQuery, fetchData, showToast,
  });

  const executeAction = useCallback(async () => {
    if (!pendingAction) return;
    const { type, id } = pendingAction;
    setPendingAction(null);
    setActionTimer(null);
    try {
      if (type === 'trash_doc') {
        const response = await patchDocument(apiUrl, fetch, id, { isDeleted: true });
        if (!response.ok) throw new Error('Nie udało się przenieść dokumentu do kosza.');
        showToast('Przeniesiono do kosza', 'success');
      } else if (type === 'archive_doc') {
        const response = await patchDocument(apiUrl, fetch, id, { isArchived: true, retentionEnabled: false });
        if (!response.ok) throw new Error('Nie udało się zarchiwizować dokumentu.');
        showToast('Zarchiwizowano dokument (termin życia usunięty).', 'success');
      } else if (type === 'bulk_trash') {
        const ids = pendingAction.docIds || selectedDocs;
        await Promise.all(ids.map(async docId => {
          const res = await patchDocument(apiUrl, fetch, docId, { isDeleted: true });
          if (!res.ok) throw new Error('Nie udało się przenieść wszystkich dokumentów do kosza.');
        }));
        if (!pendingAction.docIds) setSelectedDocs([]);
        pendingAction.onAfter?.();
        showToast(`Przeniesiono do kosza: ${ids.length}.`, 'success');
      } else if (type === 'bulk_archive') {
        await Promise.all(selectedDocs.map(async docId => {
          const res = await patchDocument(apiUrl, fetch, docId, { isArchived: true, retentionEnabled: false });
          if (!res.ok) throw new Error('Nie udało się zarchiwizować wszystkich dokumentów.');
        }));
        setSelectedDocs([]);
        showToast(`Zarchiwizowano dokumentów: ${selectedDocs.length}.`, 'success');
      } else if (type === 'bulk_delete') {
        await Promise.all(selectedDocs.map(async docId => {
          const res = await deleteDocument(apiUrl, fetch, docId);
          if (!res.ok) throw new Error('Nie udało się usunąć wszystkich dokumentów.');
        }));
        setSelectedDocs([]);
        showToast(`Usunięto trwale: ${selectedDocs.length}.`, 'success');
      } else if (type === 'delete_doc') {
        const response = await deleteDocument(apiUrl, fetch, id);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Nie udało się usunąć dokumentu.');
        showToast(result.failedFiles ? 'Usunięto dokument z bazy, ale nie udało się usunąć pliku z dysku.' : 'Usunięto trwale', result.failedFiles ? 'error' : 'success');
      } else if (type === 'empty_trash') {
        const response = await fetch(`${apiUrl}/api/documents/empty-trash`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Nie udało się opróżnić kosza.');
        setSelectedDocs([]);
        showToast(result.failedFiles ? `Usunięto ${result.deleted} dokumentów, ale ${result.failedFiles} plików nie udało się usunąć z dysku.` : `Kosz opróżiony: usunięto ${result.deleted} dokumentów.`, result.failedFiles ? 'error' : 'success');
      } else if (type === 'delete_folder') {
        await deleteFolderSafely(apiUrl, fetch, id, pendingAction.transferFolderId, pendingAction.deleteMode || 'transfer');
        showToast(pendingAction.deleteMode === 'trash' ? 'Kartoteka usunięta, a pliki przeniesiono do kosza.' : pendingAction.transferFolderId ? 'Dokumenty przeniesiono, a kartotekę usunięto.' : 'Kartoteka usunięta.', 'success');
        setActiveView('dashboard');
        setSelectedFolderId(null);
      }
      await fetchData();
    } catch (error: unknown) {
      showToast(errorMessage(error), 'error');
    }
  }, [apiUrl, fetch, fetchData, pendingAction, selectedDocs, setActiveView, setSelectedDocs, setSelectedFolderId, showToast]);

  useEffect(() => {
    if (actionTimer === null || actionTimer <= 0) return;
    const timer = window.setTimeout(() => setActionTimer(value => (value === null ? null : Math.max(0, value - 1))), 1000);
    return () => window.clearTimeout(timer);
  }, [actionTimer]);

  const updateDocument = async (id: number, data: DocumentPatch) => {
    try {
      const res = await patchDocument(apiUrl, fetch, id, data);
      if (!res.ok) throw new Error('Serwer odrzucił zmianę dokumentu.');
      showToast('Wykonano!', 'success');
      await fetchData();
    } catch {
      showToast('Błąd zapisu.', 'error');
    }
  };

  const handleRetentionUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retentionModal.docId) return;
    if (!Number.isSafeInteger(retentionModal.value) || retentionModal.value < 1) {
      showToast('Podaj dodatnią liczbę całkowitą dla terminu życia.', 'error');
      return;
    }
    if (retentionModal.restoreFrom && !retentionModal.targetFolderId) {
      showToast('Wybierz podkartotekę docelową.', 'error');
      return;
    }
    try {
      const restoreData = retentionModal.restoreFrom ? { isArchived: false, isDeleted: false, deletedAt: null, folderId: Number(retentionModal.targetFolderId) } : {};
      const response = await patchDocument(apiUrl, fetch, retentionModal.docId, {
        ...restoreData,
        ...(retentionModal.enabled ? { createdAt: new Date().toISOString() } : {}),
        retentionEnabled: retentionModal.enabled,
        retentionValue: retentionModal.value,
        retentionUnit: retentionModal.unit,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Nie udało się zapisać dokumentu.');
      }
      setRetentionModal({ ...retentionModal, isOpen: false });
      showToast(retentionModal.restoreFrom ? 'Dokument przywrócono.' : 'Zapisano zmianę.', 'success');
      await fetchData();
    } catch (error: unknown) {
      showToast(errorMessage(error, 'Nie udało się zapisać dokumentu.'), 'error');
    }
  };

  const beginRestore = (doc: Pick<DocumentRecord, 'id'>, restoreFrom: 'archive' | 'trash') => {
    setRetentionModal({ isOpen: true, docId: doc.id, value: 5, unit: 'years', enabled: true, restoreFrom, targetFolderId: '' });
  };

  const toggleDocSelection = (id: number) => setSelectedDocs(prev => (prev.includes(id) ? prev.filter(dId => dId !== id) : [...prev, id]));
  const selectAllVisibleDocs = () => setSelectedDocs(displayedDocs.map(doc => doc.id));
  const clearSelectedDocs = () => setSelectedDocs([]);

  const moveSelectedDocs = async (folderId: number, retention?: BulkRetention): Promise<boolean> => {
    const restoring = activeView === 'trash' || activeView === 'archive';
    if (!selectedDocs.length || (restoring && !retention)) return false;
    const data = restoring && retention
      ? { folderId, isDeleted: false, isArchived: false, deletedAt: null, createdAt: new Date().toISOString(), retentionEnabled: retention.enabled, retentionValue: retention.value, retentionUnit: retention.unit }
      : { folderId };
    const results = await Promise.allSettled(selectedDocs.map(id => patchDocument(apiUrl, fetch, id, data)));
    const failed = selectedDocs.filter((_, index) => results[index].status === 'rejected' || (results[index].status === 'fulfilled' && !results[index].value.ok));
    setSelectedDocs(failed);
    try { await fetchData(); } catch { showToast('Zmiany zapisano, ale nie udało się odświeżyć listy.', 'error'); }
    if (failed.length) { showToast(`Nie udało się przetworzyć ${failed.length} dokumentów. Pozostały zaznaczone.`, 'error'); return false; }
    showToast(restoring ? 'Dokumenty przywrócono do wybranej podkartoteki.' : 'Dokumenty przeniesiono.', 'success');
    return true;
  };

  return {
    ...tagAndOcr,
    ...folderActions,
    retentionModal, setRetentionModal,
    pendingAction, setPendingAction,
    actionTimer, setActionTimer,
    initiateAction, executeAction,
    updateDocument, handleRetentionUpdate, beginRestore,
    toggleDocSelection, selectAllVisibleDocs, clearSelectedDocs, moveSelectedDocs,
  };
}
