import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DocumentRecord } from '../types/domain';
import { previewPosition } from '../utils/previewPosition';
import PannablePdf from './PannablePdf';

export default function HoverDocumentPreview({ document: doc, anchor, apiUrl, fetcher, onEnter, onLeave }: { document: DocumentRecord; anchor: HTMLElement; apiUrl: string; fetcher: typeof window.fetch; onEnter: () => void; onLeave: () => void }) {
  const [position, setPosition] = useState({ top: 8, left: 8, width: 0, height: 0 });
  useLayoutEffect(() => {
    const update = () => {
      setPosition(previewPosition(anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    };
    update(); window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [anchor]);
  const source = `${apiUrl}/${doc.filePath?.replace(/\\/g, '/')}`;
  return createPortal(<div onMouseEnter={onEnter} onMouseLeave={onLeave} className="fixed z-[100] flex flex-col overflow-hidden rounded-lg border border-blue-500 bg-[#1e293b] shadow-[0_0_40px_rgba(0,0,0,0.8)]" style={position}>
    <div className="shrink-0 truncate border-b border-slate-700 bg-slate-800 p-2 text-xs font-bold text-blue-300">{doc.title}</div>
    <div className="relative min-h-0 flex-1 bg-white">{doc.mimeType?.includes('pdf') || doc.filePath?.toLowerCase().endsWith('.pdf') ? <PannablePdf url={source} fetcher={fetcher} /> : <img src={source} alt={doc.title} className="absolute inset-0 h-full w-full object-contain" />}</div>
  </div>, document.body);
}
