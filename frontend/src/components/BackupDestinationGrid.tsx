import type { ReactElement } from 'react';

export type BackupDestinationChoice = 'computer' | 'webdav' | 'google-drive' | 'onedrive' | 'dropbox';

type CardDef = {
  id: BackupDestinationChoice;
  label: string;
  subtitle: string;
  accent: string;
  icon: ReactElement;
};

const CARDS: CardDef[] = [
  {
    id: 'computer',
    label: 'Komputer',
    subtitle: 'Lokalny plik ZIP',
    accent: 'border-slate-400 bg-slate-800/70',
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-slate-200" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'webdav',
    label: 'Serwer NAS',
    subtitle: 'QNAP / Synology / WebDAV',
    accent: 'border-cyan-400 bg-cyan-950/40',
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-cyan-300" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="4" y="3" width="16" height="7" rx="1.5" />
        <rect x="4" y="14" width="16" height="7" rx="1.5" />
        <circle cx="8" cy="6.5" r="1" fill="currentColor" />
        <circle cx="8" cy="17.5" r="1" fill="currentColor" />
        <path d="M12 6.5h4M12 17.5h4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'google-drive',
    label: 'Google Drive',
    subtitle: 'Chmura Google',
    accent: 'border-emerald-400 bg-emerald-950/35',
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7">
        <path fill="#0F9D58" d="M8.5 3.5L2 14.8l3.3 5.7L11.8 9.2z" />
        <path fill="#4285F4" d="M5.3 20.5h13.4l3.3-5.7H8.6z" />
        <path fill="#F4B400" d="M15.5 3.5H8.5l6.9 11.3H22z" />
      </svg>
    ),
  },
  {
    id: 'onedrive',
    label: 'OneDrive',
    subtitle: 'Chmura Microsoft',
    accent: 'border-sky-400 bg-sky-950/40',
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7">
        <path fill="#0364B8" d="M14.6 7.4a4.8 4.8 0 0 0-9.1 1.7A3.8 3.8 0 0 0 6.2 16.5h11.3a3.5 3.5 0 0 0 .6-6.9 4.7 4.7 0 0 0-3.5-2.2z" />
        <path fill="#28A8EA" d="M10.4 10.6a4.2 4.2 0 0 1 7.6 1.2 3.2 3.2 0 0 1-.5 6.2H7.6a3.5 3.5 0 0 1-.4-7 4.1 4.1 0 0 1 3.2-.4z" />
      </svg>
    ),
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    subtitle: 'Chmura Dropbox',
    accent: 'border-blue-400 bg-blue-950/40',
    icon: (
      <svg viewBox="0 0 24 24" className="h-7 w-7">
        <path fill="#0061FF" d="M7.2 3.5L2 6.8l5.2 3.3 5.2-3.3zm9.6 0l-5.2 3.3 5.2 3.3L22 6.8zM2 13.4l5.2 3.3 5.2-3.3-5.2-3.3zm14.8-3.3l-5.2 3.3 5.2 3.3 5.2-3.3zM7.2 17.6l5.2 3.3 5.2-3.3-5.2-3.3z" />
      </svg>
    ),
  },
];

type Props = {
  selected: BackupDestinationChoice;
  disabled?: boolean;
  onSelect: (choice: BackupDestinationChoice) => void;
};

/** Visual selector cards for local computer, NAS, and cloud backup providers. */
export default function BackupDestinationGrid({ selected, disabled, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {CARDS.map((card) => {
        const active = selected === card.id;
        return (
          <button
            key={card.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(card.id)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition disabled:opacity-50 ${
              active
                ? `${card.accent} ring-1 ring-white/25 shadow-lg`
                : 'border-slate-700 bg-[#111827]/80 hover:border-slate-500 hover:bg-slate-800/60'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900/80">{card.icon}</div>
            <span className="text-xs font-bold text-white">{card.label}</span>
            <span className="text-[10px] leading-tight text-slate-400">{card.subtitle}</span>
          </button>
        );
      })}
    </div>
  );
}
