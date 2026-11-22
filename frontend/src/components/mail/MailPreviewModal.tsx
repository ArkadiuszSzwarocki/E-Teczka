import type { MailItem } from '../../types/mailInbox';

type Props = {
  preview: { item: MailItem; url: string };
  onClose: () => void;
};

/** Fullscreen modal previewing a staged PDF or image attachment. */
export function MailPreviewModal({ preview, onClose }: Props) {
  const isPdf = preview.item.mimeType.includes('pdf') || preview.item.filename.toLowerCase().endsWith('.pdf');

  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-[#0f172a]">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2.5">
        <h3 className="truncate text-sm font-bold text-white">{preview.item.filename}</h3>
        <button type="button" onClick={onClose} className="rounded px-3 py-1 text-xl text-slate-300 hover:bg-slate-800 hover:text-white">×</button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-900 p-4">
        {isPdf ? (
          <iframe src={preview.url} title={preview.item.filename} className="h-full w-full border-0" />
        ) : (
          <img src={preview.url} alt={preview.item.filename} className="max-h-full max-w-full object-contain" />
        )}
      </div>
    </div>
  );
}
