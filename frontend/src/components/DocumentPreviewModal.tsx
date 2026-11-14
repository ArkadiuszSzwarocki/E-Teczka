import { useEffect } from 'react';
import type { DocumentRecord } from '../types/domain';

type Props = {
  apiUrl: string;
  document: Pick<DocumentRecord, 'title' | 'filePath' | 'mimeType'>;
  zoom: number;
  onZoomChange: (next: number | ((current: number) => number)) => void;
  onClose: () => void;
};

/** A single viewer fills the window. PDFs use their own native zoom controls. */
export default function DocumentPreviewModal({ apiUrl, document, zoom, onZoomChange, onClose }: Props) {
  const source = `${apiUrl}/${document.filePath?.replace(/\\/g, '/')}`;
  const isPdf = document.mimeType?.includes('pdf') || document.filePath?.toLowerCase().endsWith('.pdf');
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);
  return <div role="dialog" aria-modal="true" aria-label={`Podgląd dokumentu: ${document.title}`} className="fixed inset-0 z-[150] flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#0f172a]">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-[#0f172a] px-4 py-2">
      <h3 className="min-w-0 truncate text-base font-bold text-white" title={document.title}>{document.title}</h3>
      <div className="flex shrink-0 items-center gap-2">{!isPdf && <>
        <button type="button" aria-label="Pomniejsz obraz" onClick={() => onZoomChange(current => Math.max(current - 0.25, 0.5))} className="rounded bg-slate-700 px-3 py-1 text-white hover:bg-slate-600">−</button>
        <button type="button" onClick={() => onZoomChange(1)} title="Dopasuj obraz do okna" className="rounded bg-slate-700 px-3 py-1 text-sm text-white hover:bg-slate-600">{Math.round(zoom * 100)}% · Dopasuj</button>
        <button type="button" aria-label="Powiększ obraz" onClick={() => onZoomChange(current => Math.min(current + 0.25, 3))} className="rounded bg-slate-700 px-3 py-1 text-white hover:bg-slate-600">+</button>
      </>}<button type="button" onClick={onClose} aria-label="Zamknij podgląd" className="ml-2 rounded px-2 text-3xl leading-none text-slate-300 hover:text-white">×</button></div>
    </div>
    {isPdf ? <iframe src={`${source}#toolbar=1&view=FitH`} className="min-h-0 w-full flex-1 border-0" title={`Podgląd PDF: ${document.title}`} /> :
      <div className="min-h-0 flex-1 overflow-auto bg-slate-900">
        <div style={{ width: `${Math.max(1, zoom) * 100}%`, height: `${Math.max(1, zoom) * 100}%` }} className="flex items-center justify-center">
          <img src={source} alt={document.title} style={{ width: `${Math.min(1, zoom) * 100}%`, height: `${Math.min(1, zoom) * 100}%` }} className="object-contain" />
        </div>
      </div>}
  </div>;
}
