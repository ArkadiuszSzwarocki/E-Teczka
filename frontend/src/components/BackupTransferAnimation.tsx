import './BackupTransferAnimation.css';

type Props = { destination: 'nas' | 'cloud'; mode?: 'send' | 'restore' };

export default function BackupTransferAnimation({ destination, mode = 'send' }: Props) {
  const isNas = destination === 'nas';
  const isRestore = mode === 'restore';
  const targetLabel = isNas ? 'Serwer NAS' : 'Chmura';
  return <div className="backup-transfer-overlay" role="status" aria-live="polite">
    <section className="backup-transfer-card" aria-label={isRestore ? 'Trwa pobieranie i przywracanie kopii zapasowej' : 'Trwa tworzenie i wysyłanie kopii zapasowej'}>
      <div className="backup-transfer-heading"><span className="backup-transfer-icon">E</span><span>E-TECZKA</span></div>
      <h2>{isRestore ? 'Trwa przywracanie kopii' : 'Twoja kopia jest w drodze'}</h2>
      <p>{isRestore ? `Pobieramy i odtwarzamy dokumenty (${isNas ? 'z serwera NAS' : 'z kopii'}).` : `Przygotowujemy i wysyłamy dokumenty ${isNas ? 'na serwer NAS' : 'do chmury'}.`}</p>
      <div className="backup-transfer-scene" aria-hidden="true">
        <div className="backup-transfer-source"><div className="backup-transfer-source-mark">E</div><span>E-Teczka</span></div>
        <div className="backup-transfer-route"><div className="backup-transfer-path"/><div className="backup-transfer-folder folder-one">📁</div><div className="backup-transfer-folder folder-two">📁</div><div className="backup-transfer-folder folder-three">📁</div></div>
        <div className="backup-transfer-target">{isNas ? <svg viewBox="0 0 100 100" fill="none"><rect x="19" y="11" width="62" height="78" rx="10" fill="#1e3a5f" stroke="#60a5fa" strokeWidth="3"/><rect x="27" y="21" width="46" height="26" rx="4" fill="#0f172a" stroke="#93c5fd" strokeWidth="2"/><rect x="27" y="54" width="46" height="26" rx="4" fill="#0f172a" stroke="#93c5fd" strokeWidth="2"/><circle cx="35" cy="34" r="3" fill="#34d399"/><circle cx="35" cy="67" r="3" fill="#34d399"/><path d="M46 34h19M46 67h19" stroke="#60a5fa" strokeWidth="3" strokeLinecap="round"/></svg> : <svg viewBox="0 0 100 100" fill="none"><path d="M25 72C12 72 7 63 9 53C11 44 19 38 28 39C32 23 45 17 57 20C68 22 75 31 76 41C86 40 94 47 94 57C94 66 87 72 77 72H25Z" fill="#2563eb" stroke="#93c5fd" strokeWidth="3"/><path d="M51 64V38M40 48l11-11 11 11" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>}<span>{targetLabel}</span></div>
      </div>
      <div className="backup-transfer-indeterminate"><div /></div>
      <p className="backup-transfer-note">To może chwilę potrwać. Nie zamykaj aplikacji.</p>
    </section>
  </div>;
}
