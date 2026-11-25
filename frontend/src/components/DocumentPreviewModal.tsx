import { useEffect, useState } from 'react';
import type { DocumentRecord } from '../types/domain';
import { useSensitiveMasking } from '../hooks/useSensitiveMasking';
import { shouldProtectDocument } from '../services/rodoProtection';
import {
  addDocumentRodoRegion,
  getDocumentRodoRegions,
  getDocumentRodoUnlockRemainingSeconds,
  removeDocumentRodoRegion,
  RODO_UNLOCK_EVENT,
  unlockDocumentRodo,
  type RodoRegion,
} from '../services/rodoRegions';
import { downloadRedactedImage, downloadRedactedPdf } from '../services/rodoExport';
import { buildDocumentFileUrl } from '../utils/documentUrl';
import EReceiptPreview from './EReceiptPreview';
import KsefInvoicePreview from './KsefInvoicePreview';
import PannablePdf from './PannablePdf';
import RodoRegionOverlay from './RodoRegionOverlay';
import SensitiveUnmaskPrompt from './SensitiveUnmaskPrompt';

const isMobileBrowser = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const NATIVE_FETCH: typeof window.fetch = (input, init) => window.fetch(input, init);

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  document: Pick<DocumentRecord, 'title' | 'filePath' | 'mimeType'> & Partial<Pick<DocumentRecord, 'id' | 'ocrText' | 'paymentStatus' | 'amountCents' | 'currency' | 'dueDate'>>;
  zoom: number;
  onZoomChange: (next: number | ((current: number) => number)) => void;
  onMarkPaid?: (docId: number) => Promise<void>;
  onClose: () => void;
};

/** A single viewer fills the window. PDFs use their own native zoom controls. */
export default function DocumentPreviewModal({ apiUrl, fetcher, document, zoom, onZoomChange, onMarkPaid, onClose }: Props) {
  const { maskingEnabled, rodoCategories, smartRodoEnabled } = useSensitiveMasking();
  const [liveOcrText, setLiveOcrText] = useState<string | null>(document.ocrText ?? null);
  const needsAsyncRodoOcr = Boolean(document.id && !document.ocrText && maskingEnabled && smartRodoEnabled);
  const [ocrCheckedForId, setOcrCheckedForId] = useState<number | undefined>(() => (needsAsyncRodoOcr ? undefined : document.id));
  useEffect(() => {
    setLiveOcrText(document.ocrText ?? null);
    if (!document.id || document.ocrText) {
      setOcrCheckedForId(document.id);
      return;
    }
    let active = true;
    void fetcher(`${apiUrl}/api/ocr/${document.id}`)
      .then(res => (res.ok ? res.json() : null))
      .then((data: { text?: string } | null) => {
        if (active && data?.text) setLiveOcrText(data.text);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setOcrCheckedForId(document.id);
      });
    return () => { active = false; };
  }, [apiUrl, document.id, document.ocrText, fetcher]);
  const rodoCheckPending = Boolean(needsAsyncRodoOcr && ocrCheckedForId !== document.id);
  const protection = shouldProtectDocument({
    docId: document.id,
    title: document.title,
    ocrText: liveOcrText ?? document.ocrText,
    maskingEnabled,
    categories: rodoCategories,
    smartEnabled: smartRodoEnabled,
  });
  const [unmaskSecondsLeft, setUnmaskSecondsLeft] = useState(() => getDocumentRodoUnlockRemainingSeconds(document.id));
  const unmasked = unmaskSecondsLeft > 0;
  const [showUnmaskPrompt, setShowUnmaskPrompt] = useState(false);
  const [regions, setRegions] = useState<RodoRegion[]>(() => getDocumentRodoRegions(document.id));
  useEffect(() => {
    setRegions(getDocumentRodoRegions(document.id));
  }, [document.id]);
  const [drawMode, setDrawMode] = useState(false);
  const [rodoLabel, setRodoLabel] = useState('RODO');
  const [regionUnmaskOpen, setRegionUnmaskOpen] = useState(false);
  const [exportingRodo, setExportingRodo] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [markedPaidLocal, setMarkedPaidLocal] = useState(false);

  const handleMarkPaid = async () => {
    if (!document.id || !onMarkPaid || markingPaid) return;
    setMarkingPaid(true);
    try {
      await onMarkPaid(document.id);
      setMarkedPaidLocal(true);
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleDownloadWithRodo = async () => {
    if (!previewUrl || regions.length === 0 || exportingRodo) return;
    setExportingRodo(true);
    try {
      if (isPdf && document.id) {
        await downloadRedactedPdf(apiUrl, fetcher, document.id, document.title, regions);
      } else {
        await downloadRedactedImage(previewUrl, document.title, regions);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Nie udało się pobrać dokumentu z RODO.');
    } finally {
      setExportingRodo(false);
    }
  };

  const unlockForThreeMinutes = () => {
    unlockDocumentRodo(document.id);
    setUnmaskSecondsLeft(getDocumentRodoUnlockRemainingSeconds(document.id));
  };

  useEffect(() => {
    const sync = () => setUnmaskSecondsLeft(getDocumentRodoUnlockRemainingSeconds(document.id));
    sync();
    window.addEventListener(RODO_UNLOCK_EVENT, sync);
    const timer = window.setInterval(sync, 1000);
    return () => {
      window.removeEventListener(RODO_UNLOCK_EVENT, sync);
      window.clearInterval(timer);
    };
  }, [document.id]);
  const source = buildDocumentFileUrl(apiUrl, document.filePath);
  const isPdf = document.mimeType?.includes('pdf') || document.filePath?.toLowerCase().endsWith('.pdf');
  const isXml = document.mimeType?.includes('xml') || document.filePath?.toLowerCase().endsWith('.xml');
  const isJson = document.mimeType?.includes('json') || document.filePath?.toLowerCase().endsWith('.json');
  const isStructuredText = Boolean(isXml || isJson);
  const [preview,setPreview]=useState<{source:string;url:string;rawText:string;error:string}>({source:'',url:'',rawText:'',error:''});
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(()=>{
    let active=true,objectUrl='';const controller=new AbortController();
    setPreview({source,url:'',rawText:'',error:''});
    setNaturalSize(null);
    void (async()=>{
      if(new URL(source).origin!==new URL(apiUrl).origin)throw new Error('Nieprawidłowy adres dokumentu.');
      // iframe/img cannot attach the account's Authorization header themselves.
      const response=await fetcher(source,{signal:controller.signal});
      if(!response.ok)throw new Error(response.status===401?'Sesja wygasła. Zaloguj się ponownie.':'Nie udało się otworzyć dokumentu.');
      const blob=await response.blob();if(!active)return;
      const rawText=isStructuredText?await blob.text():'';if(!active)return;
      objectUrl=URL.createObjectURL(isPdf?new Blob([blob],{type:'application/pdf'}):blob);
      setPreview({source,url:objectUrl,rawText,error:''});
    })().catch(error=>{if(active&&!controller.signal.aborted){const raw=error instanceof Error?error.message:'';setPreview({source,url:'',rawText:'',error:raw==='Failed to fetch'?'Brak połączenia z lokalnym serwerem MojejTeczki (port 3000). Kliknij „Odśwież DEV” lub uruchom ponownie backend.':raw||'Nie udało się pobrać dokumentu.'});}});
    return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[apiUrl,source,isPdf,isStructuredText,fetcher]);
  const previewUrl=preview.source===source?preview.url:'';
  const rawText=preview.source===source?preview.rawText:'';
  const error=preview.source===source?preview.error:'';

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);
  return <div role="dialog" aria-modal="true" aria-label={`Podgląd dokumentu: ${document.title}`} onClick={onClose} className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6">
    <section onClick={e => e.stopPropagation()} className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-600 bg-[#0f172a] shadow-2xl">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-[#0f172a] px-4 py-2">
      <h3 className="min-w-0 truncate text-base font-bold text-white" title={document.title}>{document.title}</h3>
      <div className="flex shrink-0 items-center gap-2">
        {document.id && onMarkPaid && document.paymentStatus === 'unpaid' && !markedPaidLocal && (
          <button
            type="button"
            disabled={markingPaid}
            onClick={() => void handleMarkPaid()}
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {markingPaid ? 'Zapisywanie…' : '✓ Oznacz jako opłacone'}
          </button>
        )}
        {(markedPaidLocal || document.paymentStatus === 'paid') && (
          <span className="rounded border border-emerald-500/50 bg-emerald-950/50 px-2.5 py-1 text-xs font-bold text-emerald-300">
            ✓ Opłacone
          </span>
        )}
        {document.id && !isStructuredText && (!protection.protect || unmasked) && previewUrl && (
          <>
            <button
              type="button"
              onClick={() => setDrawMode(v => !v)}
              className={`rounded px-3 py-1 text-xs font-semibold ${drawMode ? 'bg-cyan-600 text-white' : 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
            >
              {drawMode ? '✓ Zakończ zaznaczanie RODO' : `✏️ Zaznacz RODO${regions.length ? ` (${regions.length})` : ''}`}
            </button>
            {drawMode && (
              <select
                aria-label="Etykieta RODO"
                value={rodoLabel}
                onChange={e => setRodoLabel(e.target.value)}
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white"
              >
                <option value="RODO">RODO</option>
                <option value="PESEL">PESEL</option>
                <option value="IMIĘ I NAZWISKO">Imię/Nazwisko</option>
                <option value="ADRES">Adres</option>
                <option value="KONTO">Konto</option>
                <option value="PODPIS">Podpis</option>
              </select>
            )}
            {regions.length > 0 && !unmasked && !drawMode && (
              <button
                type="button"
                onClick={() => setRegionUnmaskOpen(true)}
                className="rounded bg-amber-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400"
              >
                🔓 Odkoduj RODO
              </button>
            )}
            {unmasked && (protection.protect || regions.length > 0) && (
              <span className="rounded border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                🔓 {Math.floor(unmaskSecondsLeft / 60)}:{String(unmaskSecondsLeft % 60).padStart(2, '0')}
              </span>
            )}
          </>
        )}
        {regions.length > 0 && previewUrl && (
          <button
            type="button"
            disabled={exportingRodo}
            onClick={() => void handleDownloadWithRodo()}
            title="Pobierz kopię dokumentu z trwale zamazanymi obszarami RODO"
            className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {exportingRodo ? 'Zapisywanie…' : '🕶️ Pobierz z RODO'}
          </button>
        )}
        {isPdf && previewUrl && (
          regions.length > 0 && !unmasked ? (
            <button
              type="button"
              onClick={() => setRegionUnmaskOpen(true)}
              title="Odkoduj RODO, aby pobrać nieocenzurowany dokument"
              className="rounded border border-amber-500/60 bg-amber-950/40 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-900/50"
            >
              🔒 Pobierz (odkoduj RODO)
            </button>
          ) : (
            <a href={previewUrl} download={document.title.toLowerCase().endsWith('.pdf') ? document.title : `${document.title}.pdf`} className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500">Pobierz</a>
          )
        )}
        {isXml && previewUrl && (
          <a href={previewUrl} download={document.title.toLowerCase().endsWith('.xml') ? document.title : `${document.title}.xml`} className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500">Pobierz XML</a>
        )}
        {isJson && previewUrl && (
          <a href={previewUrl} download={document.title.toLowerCase().endsWith('.json') ? document.title : `${document.title}.json`} className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500">Pobierz JSON</a>
        )}
        {!isPdf && !isStructuredText && <>
        <button type="button" aria-label="Pomniejsz obraz" onClick={() => onZoomChange(current => Math.max(current - 0.25, 0.5))} className="rounded bg-slate-700 px-3 py-1 text-white hover:bg-slate-600">−</button>
        <button type="button" onClick={() => onZoomChange(1)} title="Przywróć 100% powiększenia" className="rounded bg-slate-700 px-3 py-1 text-sm text-white hover:bg-slate-600">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Powiększ obraz" onClick={() => onZoomChange(current => Math.min(current + 0.25, 3))} className="rounded bg-slate-700 px-3 py-1 text-white hover:bg-slate-600">+</button>
      </>}<button type="button" onClick={onClose} aria-label="Zamknij podgląd" className="ml-2 rounded px-2 text-3xl leading-none text-slate-300 hover:text-white">×</button></div>
    </div>
    {rodoCheckPending ? (
      <p role="status" className="m-auto p-6 text-slate-300">Sprawdzanie ochrony RODO…</p>
    ) : protection.protect && !unmasked ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[#0b1120] p-6 text-center">
        {showUnmaskPrompt ? (
          <SensitiveUnmaskPrompt
            apiUrl={apiUrl}
            fetcher={fetcher}
            onUnlocked={() => { unlockForThreeMinutes(); setShowUnmaskPrompt(false); }}
            onCancel={() => setShowUnmaskPrompt(false)}
          />
        ) : (
          <div className="max-w-md rounded-2xl border border-amber-500/40 bg-[#1e293b] p-6 shadow-xl">
            <p className="text-3xl" aria-hidden="true">🙈</p>
            <h4 className="mt-2 text-lg font-bold text-white">Dokument chroniony (RODO)</h4>
            <p className="mt-1.5 text-sm text-slate-300">
              {protection.matchedLabels.length > 0
                ? `Wykryto dane: ${protection.matchedLabels.join(', ')}. Odkoduj podgląd kodem PIN, hasłem lub Authenticatorem.`
                : 'Włączono ochronę wrażliwych danych. Odkoduj podgląd kodem PIN, hasłem lub Authenticatorem.'}
            </p>
            <button type="button" onClick={() => setShowUnmaskPrompt(true)} className="mt-4 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400">
              🔓 Odkoduj dokument
            </button>
          </div>
        )}
      </div>
    ) : error?<p role="alert" className="m-auto p-6 text-red-300">{error}</p>:!previewUrl?<p role="status" className="m-auto p-6 text-slate-300">Wczytywanie dokumentu…</p>:isXml ? (
      <KsefInvoicePreview xmlText={rawText} title={document.title} />
    ) : isJson ? (
      <EReceiptPreview jsonText={rawText} title={document.title} />
    ) : isPdf ? (
      (isMobileBrowser() || drawMode || regions.length > 0) ? (
        <div className="min-h-0 w-full flex-1">
          <PannablePdf
            url={previewUrl}
            fetcher={NATIVE_FETCH}
            disablePan={drawMode}
            renderOverlay={pageNum => (
              <RodoRegionOverlay
                regions={regions.filter(r => (r.page ?? 1) === pageNum)}
                drawMode={drawMode}
                masked={!unmasked && !drawMode}
                activeLabel={rodoLabel}
                onAddRegion={region => { if (document.id) setRegions(addDocumentRodoRegion(document.id, { ...region, page: pageNum })); }}
                onRemoveRegion={id => { if (document.id) setRegions(removeDocumentRodoRegion(document.id, id)); }}
              />
            )}
          />
        </div>
      ) : (
        <iframe src={`${previewUrl}#toolbar=1&zoom=100`} className="min-h-0 w-full flex-1 border-0" title={`Podgląd PDF: ${document.title}`} />
      )
    ) :
      <div className="min-h-0 flex-1 overflow-auto bg-slate-900">
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          <div className="relative inline-block">
            <img
              src={previewUrl}
              alt={document.title}
              onLoad={(event) => setNaturalSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
              style={naturalSize ? { width: `${Math.round(naturalSize.w * zoom)}px`, height: `${Math.round(naturalSize.h * zoom)}px` } : undefined}
              className="max-w-none shadow-2xl"
            />
            <RodoRegionOverlay
              regions={regions}
              drawMode={drawMode}
              masked={!unmasked && !drawMode}
              activeLabel={rodoLabel}
              onAddRegion={region => { if (document.id) setRegions(addDocumentRodoRegion(document.id, region)); }}
              onRemoveRegion={id => { if (document.id) setRegions(removeDocumentRodoRegion(document.id, id)); }}
            />
          </div>
        </div>
      </div>}
    {regionUnmaskOpen && (
      <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
        <SensitiveUnmaskPrompt
          apiUrl={apiUrl}
          fetcher={fetcher}
          onUnlocked={() => { unlockForThreeMinutes(); setRegionUnmaskOpen(false); }}
          onCancel={() => setRegionUnmaskOpen(false)}
        />
      </div>
    )}
    </section>
  </div>;
}
