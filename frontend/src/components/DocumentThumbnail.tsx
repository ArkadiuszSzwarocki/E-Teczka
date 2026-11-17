import AuthenticatedImage from './AuthenticatedImage';
import { useEffect, useRef, useState } from 'react';
import { generatePdfThumbnail } from '../services/documentUpload';
import type { DocumentRecord } from '../types/domain';

const cache = new Map<string, Promise<string | null>>();
let work = Promise.resolve();

function getPdfThumbnail(url: string, fetcher: typeof window.fetch, key: string) {
  const previous = cache.get(key);
  if (previous) return previous;
  const task = work.then(async () => {
    const response = await fetcher(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return generatePdfThumbnail(new File([blob], 'preview.pdf', { type: 'application/pdf' }));
  }).catch(() => null);
  work = task.then(() => undefined);
  if (cache.size >= 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, task);
  void task.then(value => { if (!value) cache.delete(key); });
  return task;
}

export default function DocumentThumbnail({ document: doc, apiUrl, fetcher }: { document: DocumentRecord; apiUrl: string; fetcher: typeof window.fetch }) {
  const element = useRef<HTMLSpanElement>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(doc.thumbnail || null);
  useEffect(() => {
    setThumbnail(doc.thumbnail || null);
    if (doc.thumbnail || !doc.filePath || !(doc.mimeType?.includes('pdf') || doc.filePath.toLowerCase().endsWith('.pdf'))) return;
    let active = true;
    const url = `${apiUrl}/${doc.filePath.replace(/\\/g, '/')}`;
    const load = () => { void getPdfThumbnail(url, fetcher, `${url}:${doc.updatedAt || ''}`).then(value => { if (active && value) setThumbnail(value); }); };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); } }, { rootMargin: '150px' });
    if (observer && element.current) observer.observe(element.current); else load();
    return () => { active = false; observer?.disconnect(); };
  }, [apiUrl, doc.filePath, doc.mimeType, doc.thumbnail, doc.updatedAt, fetcher]);
  const imageUrl=doc.mimeType?.startsWith('image/')?`${apiUrl}/${doc.filePath.replace(/\\/g,'/')}`:null;
  return <span ref={element} className="flex h-full w-full items-center justify-center">{thumbnail ? <img src={thumbnail} alt={`Miniatura: ${doc.title}`} className="h-full w-full object-contain pointer-events-none" /> : imageUrl ? <AuthenticatedImage url={imageUrl} fetcher={fetcher} alt={`Miniatura: ${doc.title}`} lazy className="h-full w-full pointer-events-none"/> : <span className="text-3xl pointer-events-none">📄</span>}</span>;
}
