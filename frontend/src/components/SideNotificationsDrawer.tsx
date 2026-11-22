import { useRef, useState } from 'react';
import bellIdleIcon from '../assets/sidebar-icons/bell-idle.png';
import bellAlertIcon from '../assets/sidebar-icons/bell-alert.png';
import { useClassicIcons } from './FolderIconPicker';

const SIDE_TOP_STORAGE_KEY = 'mojateczka_notifications_side_top';
const clampTopPercent = (value: number) => Math.min(90, Math.max(10, value));
const readInitialTopPercent = (): number => {
  const raw = Number(localStorage.getItem(SIDE_TOP_STORAGE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampTopPercent(raw) : 50;
};

type AlertItem = { id: number; title: string; text: string; type: 'warning' | 'danger' };

type Props = {
  open: boolean;
  scannerFileCount: number;
  retentionAlerts: AlertItem[];
  onToggleOpen: () => void;
  onOpenScannerInbox: () => void;
  onOpenNotification: (documentId: number) => void;
  onRestoreToTopBar: () => void;
};

/** Edge-docked notification tab and slide-out drawer with an option to restore top-bar mode. */
export default function SideNotificationsDrawer({
  open,
  scannerFileCount,
  retentionAlerts,
  onToggleOpen,
  onOpenScannerInbox,
  onOpenNotification,
  onRestoreToTopBar,
}: Props) {
  const classicIcons = useClassicIcons();
  const [topPercent, setTopPercent] = useState<number>(readInitialTopPercent);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{ startY: number; startTop: number; lastTop: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const notificationCount = retentionAlerts.length + scannerFileCount;

  const applyTransform = (percent: number) => {
    if (buttonRef.current) {
      buttonRef.current.style.transform = `translate3d(0, calc(${percent}vh - 50%), 0)`;
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    suppressClickRef.current = false;
    dragRef.current = { startY: event.clientY, startTop: topPercent, lastTop: topPercent, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || window.innerHeight <= 0) return;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaY) > 4) {
      drag.moved = true;
    }
    if (drag.moved) {
      const nextTop = clampTopPercent(drag.startTop + (deltaY / window.innerHeight) * 100);
      drag.lastTop = nextTop;
      applyTransform(nextTop);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) {
      suppressClickRef.current = true;
      setTopPercent(drag.lastTop);
      localStorage.setItem(SIDE_TOP_STORAGE_KEY, String(Math.round(drag.lastTop)));
    }
    dragRef.current = null;
  };

  const handleTabClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onToggleOpen();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleTabClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{ transform: `translate3d(0, calc(${topPercent}vh - 50%), 0)` }}
        aria-label="Powiadomienia"
        aria-expanded={open}
        title="Powiadomienia (przeciągnij w górę lub w dół)"
        className="fixed right-0 top-0 z-[105] flex touch-none select-none will-change-transform cursor-grab items-center gap-1.5 rounded-l-xl border border-r-0 border-slate-600 bg-[#1e293b]/95 px-2.5 py-3 text-slate-200 shadow-2xl backdrop-blur hover:bg-slate-700 active:cursor-grabbing"
      >
        {classicIcons ? (
          <span className="text-lg leading-none">🔔</span>
        ) : (
          <img src={notificationCount > 0 ? bellAlertIcon : bellIdleIcon} alt="" aria-hidden="true" className="cyber-icon-glow h-6 w-6 object-contain" />
        )}
        {notificationCount > 0 && (
          <span className="min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
            {notificationCount}
          </span>
        )}
      </button>

      <aside
        aria-label="Panel powiadomień"
        className={`fixed right-0 top-16 bottom-4 z-[110] flex w-80 max-w-[90vw] flex-col rounded-l-2xl border border-r-0 border-slate-600 bg-[#1e293b]/95 p-4 text-slate-200 shadow-2xl backdrop-blur transition-transform duration-200 sm:w-96 ${open ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}
      >
        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
          <h3 className="text-sm font-bold text-white">Powiadomienia o terminie życia</h3>
          <button type="button" onClick={onToggleOpen} aria-label="Zamknij powiadomienia" className="rounded px-2 py-0.5 text-lg text-slate-400 hover:bg-slate-700 hover:text-white">
            ×
          </button>
        </div>

        <div className="custom-scrollbar mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {scannerFileCount > 0 && (
            <button type="button" onClick={onOpenScannerInbox} className="w-full rounded-lg bg-blue-500/15 p-2.5 text-left text-sm text-blue-300 hover:bg-blue-500/25">
              Skrzynka skanera: {scannerFileCount} plików.
            </button>
          )}
          {retentionAlerts.map(alert => (
            <button
              key={alert.id}
              type="button"
              onClick={() => onOpenNotification(alert.id)}
              className={`w-full rounded-lg border border-slate-700/70 bg-slate-900/50 p-2.5 text-left text-xs transition hover:bg-white/10 ${alert.type === 'danger' ? 'text-red-300' : 'text-amber-300'}`}
            >
              <strong className="block">{alert.title}</strong>
              <span className="mt-0.5 block opacity-90">{alert.text} Kliknij, aby otworzyć dokument.</span>
            </button>
          ))}
          {retentionAlerts.length === 0 && scannerFileCount === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">Brak powiadomień.</p>
          )}
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-slate-700 pt-3 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={false}
            onChange={e => { if (e.target.checked) onRestoreToTopBar(); }}
            className="h-4 w-4 accent-blue-500"
          />
          <span>Przywróć powiadomienia do górnego paska (standardowo)</span>
        </label>
      </aside>
    </>
  );
}
