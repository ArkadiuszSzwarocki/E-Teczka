import { useCallback, useState, type ClipboardEvent } from 'react';
import { getElectronIpc } from '../services/electron';
import { renderAnnotatedScreenshot } from '../utils/screenshotAnnotator';
import { useScreenshotAnnotator } from './useScreenshotAnnotator';

export type FeedbackCategory = 'bug' | 'feedback' | 'backup' | 'other';

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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(initialScreenshot);
  const [appVersion, setAppVersion] = useState(initialAppVersion);
  const [platform, setPlatform] = useState(initialPlatform || navigator.platform || 'web');
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  const annotator = useScreenshotAnnotator({ onCaptureLive: captureScreen });

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
    if (title.trim().length < 3) { setError('Wpisz krótki temat zgłoszenia (min. 3 znaki).'); return; }
    if (description.trim().length < 5) { setError('Opisz problem lub uwagę (min. 5 znaków).'); return; }
    setSubmitting(true);
    try {
      const finalScreenshot = screenshotDataUrl
        ? await renderAnnotatedScreenshot(screenshotDataUrl, annotator.annotations)
        : undefined;
      const response = await fetcher(`${apiUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category,
          title: title.trim(),
          description: description.trim(),
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd wysyłania zgłoszenia.');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    category, setCategory,
    title, setTitle,
    description, setDescription,
    contactEmail, setContactEmail,
    screenshotDataUrl,
    clearScreenshot: () => setScreenshotDataUrl(null),
    capturing,
    submitting,
    error,
    submittedId,
    hasDesktopCapture: Boolean(getElectronIpc()),
    annotator,
    captureScreen,
    attachFile,
    handlePaste,
    submit,
  };
}
