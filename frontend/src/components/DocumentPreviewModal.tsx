import { useEffect, useState } from 'react';
import type { DocumentRecord } from '../types/domain';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  document: Pick<DocumentRecord, 'title' | 'filePath' | 'mimeType'>;
  zoom: number;
  onZoomChange: (next: number | ((current: number) => number)) => void;
  onClose: () => void;
};

/** A single viewer fills the window. PDFs use their own native zoom controls. */
export default function DocumentPreviewModal({ apiUrl, fetcher, document, zoom, onZoomChange, onClose }: Props) {
  const source = `${apiUrl}/${document.filePath?.replace(/\\/g, '/').replace(/^\/+/, '')}`;
  const isPdf = document.mimeType?.includes('pdf') || document.filePath?.toLowerCase().endsWith('.pdf');
  const [preview,setPreview]=useState<{source:string;url:string;error:string}>({source:'',url:'',error:''});
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(()=>{
    let active=true,objectUrl='';const controller=new AbortController();
    setPreview({source,url:'',error:''});
    setNaturalSize(null);
    void (async()=>{
      if(new URL(source).origin!==new URL(apiUrl).origin)throw new Error('Nieprawidłowy adres dokumentu.');
      // iframe/img cannot attach the account's Authorization header themselves.
      const response=await fetcher(source,{signal:controller.signal});
      if(!response.ok)throw new Error(response.status===401?'Sesja wygasła. Zaloguj się ponownie.':'Nie udało się otworzyć dokumentu.');
      const blob=await response.blob();if(!active)return;
      objectUrl=URL.createObjectURL(isPdf?new Blob([blob],{type:'application/pdf'}):blob);
      setPreview({source,url:objectUrl,error:''});
    })().catch(error=>{if(active&&!controller.signal.aborted){const raw=error instanceof Error?error.message:'';setPreview({source,url:'',error:raw==='Failed to fetch'?'Brak połączenia z lokalnym serwerem E‑Teczki (port 3000). Kliknij „Odśwież DEV” lub uruchom ponownie backend.':raw||'Nie udało się pobrać dokumentu.'});}});
    return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[apiUrl,source,isPdf,fetcher]);
  const previewUrl=preview.source===source?preview.url:'';
  const error=preview.source===source?preview.error:'';

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
        <button type="button" onClick={() => onZoomChange(1)} title="Przywróć 100% powiększenia" className="rounded bg-slate-700 px-3 py-1 text-sm text-white hover:bg-slate-600">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="Powiększ obraz" onClick={() => onZoomChange(current => Math.min(current + 0.25, 3))} className="rounded bg-slate-700 px-3 py-1 text-white hover:bg-slate-600">+</button>
      </>}<button type="button" onClick={onClose} aria-label="Zamknij podgląd" className="ml-2 rounded px-2 text-3xl leading-none text-slate-300 hover:text-white">×</button></div>
    </div>
    {error?<p role="alert" className="m-auto p-6 text-red-300">{error}</p>:!previewUrl?<p role="status" className="m-auto p-6 text-slate-300">Wczytywanie dokumentu…</p>:isPdf ? <iframe src={`${previewUrl}#toolbar=1&zoom=100`} className="min-h-0 w-full flex-1 border-0" title={`Podgląd PDF: ${document.title}`} /> :
      <div className="min-h-0 flex-1 overflow-auto bg-slate-900">
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          <img
            src={previewUrl}
            alt={document.title}
            onLoad={(event) => setNaturalSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            style={naturalSize ? { width: `${Math.round(naturalSize.w * zoom)}px`, height: `${Math.round(naturalSize.h * zoom)}px` } : undefined}
            className="max-w-none shadow-2xl"
          />
        </div>
      </div>}
  </div>;
}
