import { useEffect, useState } from 'react';
import {
  getDocumentRodoUnlockRemainingSeconds,
  RODO_UNLOCK_EVENT,
} from '../services/rodoRegions';

type Props = {
  docId: number;
  className?: string;
};

/** Displays a live 3-minute countdown badge on a document tile while RODO is temporarily unlocked. */
export default function RodoUnlockBadge({ docId, className = '' }: Props) {
  const [seconds, setSeconds] = useState(() => getDocumentRodoUnlockRemainingSeconds(docId));

  useEffect(() => {
    const sync = () => setSeconds(getDocumentRodoUnlockRemainingSeconds(docId));
    sync();
    window.addEventListener(RODO_UNLOCK_EVENT, sync);
    const timer = window.setInterval(sync, 1000);
    return () => {
      window.removeEventListener(RODO_UNLOCK_EVENT, sync);
      window.clearInterval(timer);
    };
  }, [docId]);

  if (seconds <= 0) return null;

  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, '0');

  return (
    <span
      title="Czas pozostały do automatycznego ponownego zablokowania RODO"
      className={`inline-flex items-center gap-1 rounded border border-emerald-500/50 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 ${className}`}
    >
      🔓 {mins}:{secs}
    </span>
  );
}
