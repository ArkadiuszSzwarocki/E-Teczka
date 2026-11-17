import { useCallback, useEffect, useState } from 'react';
import { exportDocuments } from '../services/documentApi';
import { createTag as createTagRequest, deleteTag as deleteTagRequest } from '../services/tagApi';
import { errorMessage } from '../utils/errors';

type UseTagAndOcrActionsArgs = {
  apiUrl: string;
  fetcher: typeof fetch;
  selectedDocs: number[];
  billingPlan: 'free' | 'standard' | 'premium';
  setPlanLimitMessage: (msg: string) => void;
  searchQuery: string;
  fetchData: () => Promise<void>;
  showToast: (message: string, type?: string) => void;
};

/** Manages tag creation/deletion, batch OCR queueing, live OCR search, and combined PDF export. */
export function useTagAndOcrActions({
  apiUrl,
  fetcher,
  selectedDocs,
  billingPlan,
  setPlanLimitMessage,
  searchQuery,
  fetchData,
  showToast,
}: UseTagAndOcrActionsArgs) {
  const [ocrSearchIds, setOcrSearchIds] = useState<number[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#2563eb');

  const createTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    const response = await createTagRequest(apiUrl, fetcher, name, newTagColor);
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      if (details.code !== 'PLAN_LIMIT_REACHED') showToast(details.error || 'Nie udało się dodać tagu.', 'error');
      return;
    }
    setNewTagName('');
    await fetchData();
    showToast('Dodano tag.', 'success');
  };

  const deleteTag = async (tagId: number) => {
    await deleteTagRequest(apiUrl, fetcher, tagId);
    await fetchData();
  };

  const recognizeSelected = useCallback(async () => {
    try {
      for (let offset = 0; offset < selectedDocs.length; offset += 100) {
        const response = await fetcher(`${apiUrl}/api/ocr/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentIds: selectedDocs.slice(offset, offset + 100) }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Nie udało się uruchomić OCR.');
      }
      showToast('Dokumenty dodano do kolejki OCR.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nie udało się uruchomić OCR.', 'error');
    }
  }, [apiUrl, fetcher, selectedDocs, showToast]);

  const exportDocumentPdf = useCallback(async (doc: { id: number; title?: string }, watermark = false) => {
    if (billingPlan !== 'premium') {
      setPlanLimitMessage('Eksport dokumentu do PDF jest dostępny w planie Premium.');
      return;
    }
    try {
      const blob = await exportDocuments(apiUrl, fetcher, [doc.id], watermark);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const safeName = (doc.title || `dokument-${doc.id}`).replace(/[^a-zA-Z0-9._-]+/g, '-');
      const baseName = safeName.toLowerCase().endsWith('.pdf') ? safeName.slice(0, -4) : safeName;
      anchor.download = watermark ? `${baseName}-znak-wodny.pdf` : `${baseName}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast(watermark ? 'Wyeksportowano dokument PDF ze znakiem wodnym.' : 'Wyeksportowano dokument do PDF.', 'success');
    } catch (error: unknown) {
      showToast(errorMessage(error, 'Nie udało się wyeksportować dokumentu.'), 'error');
    }
  }, [apiUrl, billingPlan, fetcher, setPlanLimitMessage, showToast]);

  useEffect(() => {
    const query = searchQuery.trim();
    let active = true;
    setOcrSearchIds([]);
    if (!query || query.length > 200) return () => { active = false; };
    const search = () => {
      void fetcher(`${apiUrl}/api/ocr/search?q=${encodeURIComponent(query)}`)
        .then(async response => (response.ok ? response.json() : null))
        .then(data => { if (active && Array.isArray(data?.ids)) setOcrSearchIds(data.ids); })
        .catch(() => { if (active) setOcrSearchIds([]); });
    };
    const timer = window.setTimeout(search, 300);
    const interval = window.setInterval(search, 5000);
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(interval); };
  }, [apiUrl, fetcher, searchQuery, billingPlan]);

  return {
    ocrSearchIds,
    newTagName, setNewTagName,
    newTagColor, setNewTagColor,
    createTag,
    deleteTag,
    recognizeSelected,
    exportDocumentPdf,
  };
}
