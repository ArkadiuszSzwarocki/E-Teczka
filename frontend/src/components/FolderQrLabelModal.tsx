import { useRef } from 'react';
import QRCode from 'react-qr-code';

type Props = {
  folderId: number;
  folderName: string;
  onClose: () => void;
};

/** Printable QR binder-spine label linking a physical paper folder to its digital MojaTeczka folder. */
export default function FolderQrLabelModal({ folderId, folderName, onClose }: Props) {
  const printAreaRef = useRef<HTMLDivElement>(null);
  const deepLink = `mojateczka://folder/${folderId}`;

  const handlePrint = () => {
    const svg = printAreaRef.current?.querySelector('svg')?.outerHTML || '';
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc || !frame.contentWindow) {
      document.body.removeChild(frame);
      return;
    }
    doc.open();
    doc.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
      body{font-family:system-ui,sans-serif;padding:24px}
      .label{width:240px;border:2px dashed #334155;border-radius:12px;padding:16px;text-align:center}
      .brand{font-size:10px;font-weight:800;letter-spacing:2px;color:#2563eb;text-transform:uppercase}
      h2{margin:6px 0 12px;font-size:18px;color:#0f172a;word-break:break-word}
      .hint{margin-top:10px;font-size:10px;color:#475569}
    </style></head><body>
      <div class="label">
        <div class="brand">MojaTeczka · Segregator</div>
        <h2>${folderName.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h2>
        <div>${svg}</div>
        <div class="hint">Zeskanuj w aplikacji MojaTeczka, aby otworzyć kartotekę #${folderId}</div>
      </div>
    </body></html>`);
    doc.close();
    const cleanup = () => { if (frame.parentNode) frame.parentNode.removeChild(frame); };
    frame.contentWindow.onafterprint = cleanup;
    window.setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(cleanup, 60_000); }, 150);
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-blue-400">Most papier ↔ cyfra</p>
            <h3 className="mt-1 text-lg font-bold text-white">🏷️ Etykieta QR na segregator</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </div>

        <div ref={printAreaRef} className="mt-4 flex flex-col items-center rounded-xl border-2 border-dashed border-slate-500 bg-white p-5 text-center text-slate-900">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-blue-600">MojaTeczka · Segregator</p>
          <p className="mt-1 text-lg font-extrabold">{folderName}</p>
          <div className="mt-3">
            <QRCode value={deepLink} size={148} />
          </div>
          <p className="mt-3 text-[11px] text-slate-600">Zeskanuj telefonem, aby otworzyć kartotekę #{folderId}</p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">Zamknij</button>
          <button type="button" onClick={handlePrint} className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500">🖨️ Drukuj etykietę</button>
        </div>
      </section>
    </div>
  );
}
