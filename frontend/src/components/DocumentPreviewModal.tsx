import type { DocumentRecord } from '../types/domain';

type Props = {
  apiUrl: string;
  document: Pick<DocumentRecord, 'title' | 'filePath' | 'mimeType'>;
  zoom: number;
  onZoomChange: (next: number | ((current: number) => number)) => void;
  onClose: () => void;
};

/** Full-application document preview, kept outside the table layout. */
export default function DocumentPreviewModal({ apiUrl, document, zoom, onZoomChange, onClose }: Props) {
  const source = `${apiUrl}/${document.filePath?.replace(/\\/g, '/')}`;
  return <div className="fixed inset-0 z-[150] bg-black backdrop-blur-sm">
    <div className="flex h-screen w-screen flex-col overflow-hidden border border-blue-500/50 bg-[#1e293b] shadow-2xl">
      <div className="z-10 flex items-center justify-between border-b border-blue-500/30 bg-[#0f172a] px-4 py-3 shadow-lg">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white"><span className="text-blue-400">🔍</span>{document.title}</h3>
        <div className="flex items-center gap-3"><button onClick={() => onZoomChange(current => Math.min(current + 0.25, 3))} className="rounded bg-slate-700 px-3 py-1 text-sm font-bold text-white shadow hover:bg-slate-600">🔍 +</button><button onClick={() => onZoomChange(1)} className="rounded bg-slate-700 px-3 py-1 text-sm font-bold text-white shadow hover:bg-slate-600">100%</button><button onClick={() => onZoomChange(current => Math.max(current - 0.25, 0.5))} className="rounded bg-slate-700 px-3 py-1 text-sm font-bold text-white shadow hover:bg-slate-600">🔍 -</button><button onClick={onClose} className="ml-4 text-3xl leading-none text-slate-400 transition-colors hover:text-red-400">×</button></div>
      </div>
      <div className="relative flex flex-1 items-start justify-center overflow-auto bg-slate-900/50 p-10">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }} className="flex h-[1000px] w-[800px] shrink-0 items-center justify-center bg-white shadow-[0_0_50px_rgba(0,0,0,0.5)] transition-transform duration-200 ease-out">
          {document.mimeType?.includes('pdf') ? <iframe src={`${source}#toolbar=1`} className="h-full w-full border-none" title="PDF" /> : <img src={source} className="h-full w-full object-contain" />}
        </div>
      </div>
    </div>
  </div>;
}
