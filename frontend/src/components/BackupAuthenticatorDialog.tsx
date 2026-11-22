import { useState } from 'react';
import InfoTip from './InfoTip';

type Props = { onSubmit: (code: string) => void; onCancel: () => void };

export default function BackupAuthenticatorDialog({ onSubmit, onCancel }: Props) {
  const [code, setCode] = useState('');
  return <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="backup-mfa-dialog-title" className="w-full max-w-md rounded-xl border border-slate-600 bg-[#172338] p-6 text-white shadow-2xl">
      <h2 id="backup-mfa-dialog-title" className="text-xl font-bold">Potwierdź operację</h2>
      <p className="mt-3 text-sm text-slate-300">Wpisz aktualny kod z Microsoft Authenticatora lub jednorazowy kod odzyskiwania.</p>
      <InfoTip label="kod Authenticatora">Otwórz Microsoft Authenticator na telefonie i przepisz aktualny kod MojejTeczki. Każdy kod odzyskiwania może zostać użyty tylko raz.</InfoTip>
      <form onSubmit={event => { event.preventDefault(); if (code.trim()) onSubmit(code.trim()); }} className="mt-4">
        <label className="block text-sm text-slate-200">Kod Authenticatora<input autoFocus required autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-[#111827] p-3" /></label>
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded px-4 py-2 text-slate-300">Anuluj</button><button type="submit" className="rounded bg-blue-600 px-4 py-2 font-semibold text-white">Potwierdź</button></div>
      </form>
    </section>
  </div>;
}
