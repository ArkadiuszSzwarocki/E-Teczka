import { useCallback, useState, type ClipboardEvent } from 'react';
import { getElectronIpc } from '../services/electron';
import { renderAnnotatedScreenshot } from '../utils/screenshotAnnotator';
import { useScreenshotAnnotator } from './useScreenshotAnnotator';

export type FeedbackCategory = 'bug' | 'feedback' | 'backup' | 'other';
export type FeedbackThreadMessage = { id: string; author: 'user' | 'admin'; text: string; createdAt: number };
export type FeedbackHistoryItem = {
  id: number;
  category: FeedbackCategory;
  title: string;
  description: string;
  contactEmail: string | null;
  status: string;
  createdAt: number;
  messages: FeedbackThreadMessage[];
};

type UseFeedbackReportArgs = {
  apiUrl: string;
  fetcher: typeof fetch;
  activeView: string;
  initialScreenshot?: string | null;
  initialAppVersion?: string;
  initialPlatform?: string;
};

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      reject(new Error('Obsługiwane są tylko obrazy PNG, JPG lub WebP.'));
      return;
    }
    if (file.size > 2_000_000) {
      reject(new Error('Zrzut ekranu może mieć maksymalnie 2 MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Nie udało się odczytać pliku zrzutu ekranu.'));
    reader.readAsDataURL(file);
  });
}

/** Manages bug/feedback form state, Electron/clipboard screenshot capture, and QNAP submission. */
export function useFeedbackReport({
  apiUrl,
  fetcher,
  activeView,
  initialScreenshot = null,
  initialAppVersion = '',
  initialPlatform = '',
}: UseFeedbackReportArgs) {
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [reporterName, setReporterName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(initialScreenshot);
  const [appVersion, setAppVersion] = useState(initialAppVersion);
  const [platform, setPlatform] = useState(initialPlatform || navigator.platform || 'web');
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copyEmail, setCopyEmail] = useState('');
  const [emailCopyBusy, setEmailCopyBusy] = useState(false);
  const [emailCopyStatus, setEmailCopyStatus] = useState('');
  const [history, setHistory] = useState<FeedbackHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetcher(`${apiUrl}/api/feedback/history`);
      if (!response.ok) return;
      const data = await response.json().catch(() => ({})) as { items?: FeedbackHistoryItem[] };
      if (Array.isArray(data.items)) setHistory(data.items);
    } finally {
      setHistoryLoading(false);
    }
  }, [apiUrl, fetcher]);

  const sendEmailCopy = async () => {
    if (submittedId === null) return;
    setEmailCopyBusy(true);
    setEmailCopyStatus('');
    try {
      const response = await fetcher(`${apiUrl}/api/feedback/${submittedId}/email-copy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: copyEmail.trim() }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
      setEmailCopyStatus(payload.message || payload.error || (response.ok ? 'Wysłano kopię.' : 'Nie udało się wysłać kopii.'));
    } catch {
      setEmailCopyStatus('Błąd połączenia podczas wysyłania kopii.');
    } finally {
      setEmailCopyBusy(false);
    }
  };

  const replyToHistory = async (feedbackId: number, text: string) => {
    const clean = text.trim();
    if (clean.length < 2) return;
    const response = await fetcher(`${apiUrl}/api/feedback/${feedbackId}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: clean }),
    });
    const payload = await response.json().catch(() => ({})) as { message?: FeedbackThreadMessage; error?: string };
    if (!response.ok || !payload.message) throw new Error(payload.error || 'Nie udało się wysłać odpowiedzi.');
    setHistory(prev => prev.map(item => (item.id === feedbackId ? { ...item, messages: [...item.messages, payload.message!] } : item)));
  };
  const [error, setError] = useState('');
  const [submittedId, setSubmittedId] = useState<number | null>(null);

  const captureScreen = useCallback(async (): Promise<string | null> => {
    const ipc = getElectronIpc();
    if (!ipc) {
      setError('W przeglądarce wklej zrzut ekranu (Ctrl+V) lub wybierz plik obrazu.');
      return null;
    }
    setCapturing(true);
    setError('');
    try {
      const result = await ipc.invoke('eteczka-capture-screenshot') as {
        dataUrl?: string;
        appVersion?: string;
        platform?: string;
      } | null;
      if (result?.dataUrl) setScreenshotDataUrl(result.dataUrl);
      if (result?.appVersion) setAppVersion(result.appVersion);
      if (result?.platform) setPlatform(result.platform);
      return result?.dataUrl || null;
    } catch {
      setError('Nie udało się wykonać zrzutu ekranu.');
      return null;
    } finally {
      setCapturing(false);
    }
  }, []);

  const appendScreenshotNote = useCallback((note: string) => {
    setDescription(prev => {
      const lines = prev.trim() ? prev.trimEnd().split('\n') : [];
      const numberedCount = lines.filter(line => /^\d+\.\s/.test(line.trim())).length;
      const entry = `${numberedCount + 1}. ${note}`;
      return prev.trim() ? `${prev.trimEnd()}\n${entry}` : entry;
    });
  }, []);

  const annotator = useScreenshotAnnotator({
    onCaptureLive: captureScreen,
    onTextConfirmed: appendScreenshotNote,
  });

  const attachFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      setScreenshotDataUrl(await readImageAsDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się dołączyć zrzutu.');
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (file) {
      event.preventDefault();
      void attachFile(file);
    }
  };

  const submit = async () => {
    setError('');
    const pendingText = annotator.pendingTextPos && annotator.pendingTextValue.trim()
      ? [{
          id: `${Date.now()}_pending`,
          type: 'text' as const,
          color: annotator.color,
          x: annotator.pendingTextPos.x,
          y: annotator.pendingTextPos.y,
          text: annotator.pendingTextValue.trim(),
        }]
      : [];
    const finalAnnotations = [...annotator.annotations, ...pendingText];
    const trimmedDesc = description.trim();
    const unaddedPending = pendingText.length ? `\n• ${pendingText[0].text}` : '';
    const baseDescription = `${trimmedDesc}${unaddedPending}`.trim();
    const trimmedName = reporterName.trim();

    if (trimmedName.length < 2) { setError('Podaj swoje imię (min. 2 znaki).'); return; }
    if (title.trim().length < 3) { setError('Wpisz krótki temat zgłoszenia (min. 3 znaki).'); return; }
    if (baseDescription.length < 5) { setError('Opisz problem lub dodaj opis przy zaznaczonym elemencie (min. 5 znaków).'); return; }
    const combinedDescription = `Zgłaszający: ${trimmedName}\n\n${baseDescription}`;
    setSubmitting(true);
    try {
      const finalScreenshot = screenshotDataUrl
        ? await renderAnnotatedScreenshot(screenshotDataUrl, finalAnnotations)
        : undefined;
      const response = await fetcher(`${apiUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category,
          title: title.trim(),
          description: combinedDescription,
          contactEmail: contactEmail.trim() || undefined,
          appVersion: appVersion || undefined,
          platform: platform || undefined,
          activeView,
          screenshotDataUrl: finalScreenshot,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { id?: number; error?: string };
      if (!response.ok || typeof payload.id !== 'number') {
        throw new Error(payload.error || 'Nie udało się wysłać zgłoszenia.');
      }
      setSubmittedId(payload.id);
      setCopyEmail(contactEmail.trim());
      setEmailCopyStatus('');
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd wysyłania zgłoszenia.');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    category, setCategory,
    reporterName, setReporterName,
    title, setTitle,
    description, setDescription,
    contactEmail, setContactEmail,
    screenshotDataUrl,
    clearScreenshot: () => setScreenshotDataUrl(null),
    capturing,
    submitting,
    error,
    submittedId,
    copyEmail, setCopyEmail,
    emailCopyBusy,
    emailCopyStatus,
    sendEmailCopy,
    history,
    historyLoading,
    loadHistory,
    replyToHistory,
    resetSubmitted: () => { setSubmittedId(null); setTitle(''); setDescription(''); setEmailCopyStatus(''); },
    hasDesktopCapture: Boolean(getElectronIpc()),
    annotator,
    captureScreen,
    attachFile,
    handlePaste,
    submit,
  };
}
