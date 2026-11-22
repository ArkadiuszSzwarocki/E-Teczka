import { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderRecord, RetentionUnit } from '../types/domain';
import { generatePdfThumbnail, prepareUploadFiles, uploadDocuments, type UploadItem, type UploadProgress } from '../services/documentUpload';
import { errorMessage } from '../utils/errors';

export type UploadUsageSummary = {
  plan: string;
  documents: { used: number; limit: number | null; remaining: number | null };
  merge: { used: number; limit: number | null; remaining: number | null };
};

export type UploadReport = {
  saved: number;
  folder: string;
  skipped: Array<{ name: string; existingTitle: string }>;
};

type Args = {
  apiUrl: string;
  fetcher: typeof fetch;
  activeView: string;
  setActiveView: (view: string) => void;
  selectedFolderId: number | null;
  folders: FolderRecord[];
  foldersUnavailable: boolean;
  billingPlan: string;
  documentsCount: number;
  fetchData: () => Promise<void>;
  showToast: (message: string, type?: string) => void;
};

/** Manages batch file selection, drag-and-drop upload, plan quota checks, and PDF merging. */
export function useBatchUpload({
  apiUrl, fetcher: fetch, activeView, setActiveView, selectedFolderId,
  folders, foldersUnavailable, billingPlan, documentsCount, fetchData, showToast,
}: Args) {
  const [filesToUpload, setFilesToUpload] = useState<UploadItem[]>([]);
  const [uploadReport, setUploadReport] = useState<UploadReport | null>(null);
  const [folderId, setFolderId] = useState('');
  const [physicalLocation, setPhysicalLocation] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [uploadUsage, setUploadUsage] = useState<UploadUsageSummary | null>(null);
  const [isMergeMode, setIsMergeMode] = useState(false);
  const [mergedTitle, setMergedTitle] = useState('');
  const [mergedRetentionEnabled, setMergedRetentionEnabled] = useState(true);
  const [mergedRetentionVal, setMergedRetentionVal] = useState(5);
  const [mergedRetentionUnit, setMergedRetentionUnit] = useState<RetentionUnit>('years');

  useEffect(() => {
    if (activeView !== 'upload') return;
    let active = true;
    void fetch(`${apiUrl}/api/billing/usage`).then(async response => {
      if (!response.ok) return;
      const data = await response.json().catch(() => null) as UploadUsageSummary | null;
      if (active && data?.documents && data?.merge) setUploadUsage(data);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [apiUrl, fetch, activeView, billingPlan, documentsCount]);

  const neededUploadDocs = isMergeMode ? (filesToUpload.length > 0 ? 1 : 0) : filesToUpload.length;
  const uploadDocsRemaining = uploadUsage?.documents.remaining ?? null;
  const uploadMergeRemaining = uploadUsage?.merge.remaining ?? null;
  const uploadDocsExceeded = uploadDocsRemaining !== null && neededUploadDocs > uploadDocsRemaining;
  const uploadMergeExceeded = isMergeMode && filesToUpload.length > 0 && uploadMergeRemaining !== null && uploadMergeRemaining < 1;

  const handleBatchUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (filesToUpload.length === 0 || !folderId) return showToast('Wybierz pliki i kartotekę!', 'error');
    if (foldersUnavailable) return showToast('Brak połączenia z serwerem. Odśwież kartoteki i spróbuj ponownie.', 'error');
    if (isMergeMode && !mergedTitle) return showToast('Podaj tytuł PDF!', 'error');
    if (uploadDocsExceeded) return showToast(`Limit planu pozwala wgrać jeszcze ${uploadDocsRemaining} dokumentów (wybrano ${neededUploadDocs}).`, 'error');
    if (uploadMergeExceeded) return showToast('Wykorzystano limit operacji łączenia PDF w bieżącym okresie.', 'error');
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setIsUploading(true);
    setUploadProgress({
      phase: 'preparing',
      fileName: filesToUpload[0].file.name,
      fileIndex: 1,
      totalFiles: filesToUpload.length,
      loadedBytes: 0,
      totalBytes: filesToUpload.reduce((s, x) => s + x.file.size, 0),
    });
    try {
      const convertedFiles = await prepareUploadFiles(filesToUpload, generatePdfThumbnail, setUploadProgress, controller.signal);
      const result = await uploadDocuments(
        apiUrl,
        fetch,
        convertedFiles,
        filesToUpload,
        Number(folderId),
        {
          physicalLocation: physicalLocation || null,
          isMerge: isMergeMode,
          mergedTitle,
          mergedRetention: { enabled: mergedRetentionEnabled, value: mergedRetentionVal, unit: mergedRetentionUnit },
        },
        setUploadProgress,
        controller.signal,
      );
      if (result.skippedDuplicates?.length) {
        setUploadReport({
          saved: result.savedDocs?.length || 0,
          folder: folders.find(folder => folder.id === Number(folderId))?.name || 'wybranej podkartotece',
          skipped: result.skippedDuplicates,
        });
      } else {
        showToast('Wgrano dokumenty.', 'success');
      }
      setFilesToUpload([]);
      setPhysicalLocation('');
      setMergedTitle('');
      setActiveView('dashboard');
      await fetchData();
    } catch (error: unknown) {
      if ((error as { name?: string })?.name === 'AbortError') showToast('Przerwano wysyłanie plików.', 'error');
      else showToast(errorMessage(error, 'Nie udało się wgrać plików.'), 'error');
    } finally {
      uploadAbortRef.current = null;
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const addFiles = useCallback((files: File[]) => {
    const supported = files.filter(file => /\.(pdf|png|jpe?g)$/i.test(file.name));
    if (supported.length) setFilesToUpload(prev => [...prev, ...supported.map(file => ({ file, enabled: true, value: 5, unit: 'years' as RetentionUnit }))]);
    if (supported.length !== files.length) showToast('Pominięto nieobsługiwane pliki. Wybierz PDF, JPG lub PNG.', 'error');
  }, [showToast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  useEffect(() => {
    let internalDrag = false;
    const onDragStart = () => { internalDrag = true; };
    const onDragEnd = () => { internalDrag = false; };
    const isFiles = (event: DragEvent) => {
      if (internalDrag) return false;
      const types = Array.from(event.dataTransfer?.types || []);
      return types.includes('Files') && !types.includes('application/x-mojateczka-drag');
    };
    const over = (event: DragEvent) => {
      if (isFiles(event)) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }
    };
    const drop = (event: DragEvent) => {
      if (internalDrag) { internalDrag = false; return; }
      if (!isFiles(event)) return;
      if (event.target instanceof HTMLInputElement && event.target.type === 'file') return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.length) return;
      addFiles(files);
      if (activeView === 'folder' && selectedFolderId && folders.some(folder => folder.id === selectedFolderId && folder.parentId !== null)) {
        setFolderId(String(selectedFolderId));
      }
      setActiveView('upload');
    };
    window.addEventListener('dragstart', onDragStart);
    window.addEventListener('dragend', onDragEnd);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [activeView, selectedFolderId, folders, addFiles, setActiveView]);

  const cancelUpload = () => uploadAbortRef.current?.abort();

  return {
    filesToUpload, setFilesToUpload, uploadReport, setUploadReport,
    folderId, setFolderId, physicalLocation, setPhysicalLocation,
    isUploading, uploadProgress, uploadUsage,
    isMergeMode, setIsMergeMode, mergedTitle, setMergedTitle,
    mergedRetentionEnabled, setMergedRetentionEnabled,
    mergedRetentionVal, setMergedRetentionVal,
    mergedRetentionUnit, setMergedRetentionUnit,
    neededUploadDocs, uploadDocsRemaining, uploadMergeRemaining,
    uploadDocsExceeded, uploadMergeExceeded,
    handleBatchUpload, handleFileSelect, cancelUpload,
  };
}
