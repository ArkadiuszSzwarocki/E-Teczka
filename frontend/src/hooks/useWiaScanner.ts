import { useEffect, useState } from 'react';
import type { InboxScan } from '../components/PrinterScannerModal';
import { getElectronIpc, isWiaDeviceList, isWiaScanResult, readScanFileBase64, removeTemporaryScan, type WiaDevice } from '../services/electron';
import { fetchWiaDevices, preparePrinterPage, scanViaBackend, uploadPrinterDocument, type PrinterPage } from '../services/scannerApi';
import { errorMessage } from '../utils/errors';

const defaultPrinterScanTitle = () => `Skan drukarki ${new Date().toLocaleString('pl-PL')}`;

type UseWiaScannerArgs = {
  apiUrl: string;
  fetcher: typeof fetch;
  activeView: string;
  setActiveView: (view: string) => void;
  setScannerFiles: React.Dispatch<React.SetStateAction<InboxScan[]>>;
  fetchData: () => Promise<void>;
  showToast: (message: string, type?: string) => void;
};

/** Manages Windows WIA printer/scanner device discovery, page scanning, PDF/A saving, and scanner inbox actions. */
export function useWiaScanner({
  apiUrl, fetcher: fetch, activeView, setActiveView, setScannerFiles, fetchData, showToast,
}: UseWiaScannerArgs) {
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

  useEffect(() => {
    const ipc = getElectronIpc();
    if (!ipc) return;
    const handleStage = (_event: unknown, stage: unknown) => {
      if (typeof stage === 'string') setWiaStage(stage);
    };
    ipc.on('eteczka-wia-status', handleStage);
    return () => ipc.removeListener('eteczka-wia-status', handleStage);
  }, []);

  const openWiaScanner = async () => {
    if (activeView === 'scanner') return;
    setActiveView('scanner');
    setWiaStage('Wyszukiwanie skanerów…');
    setIsWiaLoadingDevices(true);
    setWiaDevices([]);
    setWiaDeviceId('');
    if (!wiaPages.length && !wiaPendingScanPath) setWiaTitle(defaultPrinterScanTitle());
    const ipc = getElectronIpc();
    try {
      const devices = ipc
        ? (isWiaDeviceList(await ipc.invoke('eteczka-wia-devices')) ? await ipc.invoke('eteczka-wia-devices') as WiaDevice[] : [])
        : await fetchWiaDevices(apiUrl, fetch);
      setWiaDevices(devices);
      const remembered = localStorage.getItem('eteczka_default_scanner');
      const defaultPrinter = ipc ? await ipc.invoke('eteczka-default-printer') : null;
      const printerName = typeof defaultPrinter === 'string'
        ? defaultPrinter.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(series|lan|network|usb)$/g, '')
        : '';
      const match = devices.find(device => device.id === remembered)
        || (printerName ? devices.find(device => {
          const name = device.name.toLowerCase().replace(/\s*\[.*$/, '').replace(/[^a-z0-9]/g, '').replace(/(series|lan|network|usb)$/g, '');
          return name.length > 5 && (printerName.includes(name) || name.includes(printerName));
        }) : undefined)
        || (devices.length === 1 ? devices[0] : undefined);
      if (match) setWiaDeviceId(match.id);
      setWiaStage(devices.length ? 'Wybierz skaner i kartotekę docelową.' : 'Nie znaleziono skanera WIA.');
    } catch (error: unknown) {
      setWiaStage(errorMessage(error, 'Nie udało się odczytać listy skanerów.'));
    } finally {
      setIsWiaLoadingDevices(false);
    }
  };

  const scanFromPrinter = async () => {
    if (!wiaDeviceId && !wiaPendingScanPath) return showToast('Wybierz skaner.', 'error');
    if (wiaPages.length >= 20) return showToast('Jeden dokument może mieć najwyżej 20 stron.', 'error');
    const ipc = getElectronIpc();
    setIsWiaScanning(true);
    setWiaStage(`Skanowanie strony ${wiaPages.length + 1}…`);
    let scanPath = wiaPendingScanPath;
    try {
      let base64: string;
      if (ipc) {
        if (!scanPath) {
          const scanResponse = await ipc.invoke('eteczka-wia-scan', wiaDeviceId);
          if (!isWiaScanResult(scanResponse)) throw new Error('Nieprawidłowa odpowiedź skanera.');
          if (!scanResponse.ok || !scanResponse.path) throw new Error('Nie odebrano obrazu ze skanera.');
          scanPath = scanResponse.path;
          setWiaPendingScanPath(scanPath);
        }
        setWiaStage('Zmniejszanie rozmiaru strony…');
        base64 = readScanFileBase64(scanPath);
      } else {
        base64 = await scanViaBackend(apiUrl, fetch, wiaDeviceId, wiaFolderId, setWiaStage);
        setWiaStage('Zmniejszanie rozmiaru strony…');
      }
      const page = await preparePrinterPage(base64);
      setWiaPages(previous => [...previous, page]);
      if (ipc && scanPath) removeTemporaryScan(scanPath);
      setWiaPendingScanPath(null);
      setWiaStage(`Dodano stronę ${wiaPages.length + 1}. Skanuj następną albo zapisz PDF.`);
    } catch (error: unknown) {
      const message = errorMessage(error, 'Nie udało się zeskanować dokumentu.');
      setWiaStage(`Błąd: ${message}${scanPath ? ' Ponów dodanie strony bez ponownego skanowania.' : ''}`);
      showToast(message, 'error');
    } finally {
      setIsWiaScanning(false);
    }
  };

  const savePrinterDocument = async () => {
    if (!wiaPages.length) return;
    setIsWiaScanning(true);
    setWiaStage('Łączenie stron i zapisywanie PDF…');
    try {
      const result = await uploadPrinterDocument(apiUrl, fetch, wiaPages, wiaTitle, {
        enabled: wiaRetentionEnabled,
        value: wiaRetentionValue,
        unit: wiaRetentionUnit,
      });
      const message = result.pdfa ? 'Skan zapisany jako PDF/A‑2b. Zgodność potwierdził veraPDF.' : result.pdfaWarning || 'PDF zapisany w skanach do posortowania.';
      setWiaPages([]);
      setWiaTitle(defaultPrinterScanTitle());
      setWiaStage(message);
      await fetchData();
      showToast(message, result.pdfaWarning ? 'error' : 'success');
    } catch (error: unknown) {
      const message = errorMessage(error, 'Nie udało się zapisać PDF.');
      setWiaStage(`Błąd zapisu: ${message}. Strony są zachowane — możesz ponowić zapis.`);
      showToast(message, 'error');
    } finally {
      setIsWiaScanning(false);
    }
  };

  const moveInboxScan = async (id: string) => {
    if (!wiaFolderId) return;
    setIsWiaScanning(true);
    try {
      const response = await fetch(`${apiUrl}/api/scanner/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: Number(wiaFolderId) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Nie udało się przenieść skanu.');
      await fetchData();
      showToast('Skan przeniesiony do kartoteki.', 'success');
    } catch (error: unknown) {
      setWiaStage(errorMessage(error, 'Nie udało się przenieść skanu.'));
    } finally {
      setIsWiaScanning(false);
    }
  };

  const renameInboxScan = async (id: string, title: string) => {
    const response = await fetch(`${apiUrl}/api/scanner/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Nie udało się zmienić nazwy.');
    setScannerFiles(previous => previous.map(scan => (scan.id === id ? { ...scan, title: result.title } : scan)));
    showToast('Nazwa skanu została zmieniona.', 'success');
  };

  return {
    wiaFolderId, setWiaFolderId,
    wiaDevices, wiaDeviceId, setWiaDeviceId,
    isWiaLoadingDevices, isWiaScanning, wiaStage, setWiaStage,
    wiaPendingScanPath, wiaPages, setWiaPages,
    wiaTitle, setWiaTitle,
    wiaRetentionEnabled, setWiaRetentionEnabled,
    wiaRetentionValue, setWiaRetentionValue,
    wiaRetentionUnit, setWiaRetentionUnit,
    openWiaScanner, scanFromPrinter, savePrinterDocument, moveInboxScan, renameInboxScan,
  };
}
