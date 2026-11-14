import { useId, useState } from 'react';

type Props = { label: string; children: React.ReactNode };

export default function InfoTip({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="mt-2 text-left text-sm">
    <button type="button" aria-label={`Informacje: ${label}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-blue-400 text-xs font-bold text-blue-200 hover:bg-blue-500/20">i</button>
    {open && <div id={id} className="mt-2 rounded-lg border border-blue-700/60 bg-blue-950/40 p-3 text-xs leading-relaxed text-blue-100">{children}</div>}
  </div>;
}
