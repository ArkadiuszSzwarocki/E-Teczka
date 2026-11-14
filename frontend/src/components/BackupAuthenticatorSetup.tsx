import { useState } from 'react';
import QRCode from 'react-qr-code';
import InfoTip from './InfoTip';

type Props = { apiUrl: string; headers: () => Record<string, string>; enabled: boolean | null; onChange: (enabled: boolean) => void };
export default function BackupAuthenticatorSetup({ apiUrl, headers, enabled, onChange }: Props) {
  const [password, setPassword] = useState(''); const [uri, setUri] = useState(''); const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const post = async (path: string, body: object) => {
    const response = await fetch(`${apiUrl}/api/backup/authenticator/${path}`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Nie udało się wykonać operacji.'); return result;
  };
  const start = async () => { setBusy(true); setMessage(''); try { const result = await post('start', { password }); setPassword(''); setUri(result.uri); } catch (error) { setMessage(error instanceof Error ? error.message : 'Błąd konfiguracji.'); } finally { setBusy(false); } };
  const confirm = async () => { setBusy(true); setMessage(''); try { const result = await post('confirm', { code }); setCodes(result.codes); setCode(''); setUri(''); onChange(true); } catch (error) { setMessage(error instanceof Error ? error.message : 'Błąd konfiguracji.'); } finally { setBusy(false); } };
  const disable = async () => { setBusy(true); setMessage(''); try { await post('disable', { password, code }); setPassword(''); setCode(''); setCodes([]); onChange(false); setMessage('Authenticator został wyłączony.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się wyłączyć Authenticatora.'); } finally { setBusy(false); } };
  return <details className="mt-4 rounded-lg border border-slate-600 p-3 text-sm text-slate-200"><summary className="cursor-pointer font-semibold">Microsoft Authenticator {enabled ? '— włączony' : enabled === false ? '— wyłączony' : '— sprawdzanie'}</summary>
    <InfoTip label="Microsoft Authenticator">Kod z aplikacji na telefonie potwierdza ręczną operację na kopii w E-Teczce. Zapisz jednorazowe kody odzyskiwania na wypadek utraty telefonu. To inne kody niż hasło i plik klucza kopii.</InfoTip>
    {enabled === false && <><p className="mt-2 text-xs text-slate-400">Potwierdź swoje hasło lub PIN E-Teczki. Zeskanuj kod QR w Microsoft Authenticator i wpisz wyświetlony kod.</p>
      {!uri && <><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Hasło lub PIN E-Teczki" aria-label="Hasło lub PIN E-Teczki" className="mt-2 w-full rounded border border-slate-600 bg-[#111827] p-2" /><button type="button" disabled={busy || !password} onClick={() => void start()} className="mt-2 rounded bg-blue-600 px-3 py-2 disabled:opacity-50">Rozpocznij konfigurację</button></>}
      {uri && <><div className="mt-3 inline-block rounded bg-white p-3"><QRCode value={uri} size={175} /></div><input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" placeholder="6-cyfrowy kod" aria-label="Kod Authenticatora do aktywacji" className="mt-2 block w-full rounded border border-slate-600 bg-[#111827] p-2" /><button type="button" disabled={busy} onClick={() => void confirm()} className="mt-2 rounded bg-blue-600 px-3 py-2">Włącz Authenticator</button></>}
    </>}
    {enabled && codes.length === 0 && <><p className="mt-2 text-xs text-slate-400">Aby wyłączyć ochronę kopii, podaj hasło lub PIN E-Teczki oraz aktualny kod albo niewykorzystany kod odzyskiwania.</p><input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Hasło lub PIN E-Teczki" aria-label="Hasło lub PIN do wyłączenia Authenticatora" className="mt-2 w-full rounded border border-slate-600 bg-[#111827] p-2" /><input value={code} onChange={event => setCode(event.target.value)} placeholder="Kod Authenticatora lub kod odzyskiwania" aria-label="Kod do wyłączenia Authenticatora" className="mt-2 w-full rounded border border-slate-600 bg-[#111827] p-2" /><button type="button" disabled={busy || !password || !code} onClick={() => void disable()} className="mt-2 rounded border border-red-400 px-3 py-2 text-red-300 disabled:opacity-50">Wyłącz Authenticator dla kopii</button></>}
    {codes.length > 0 && <div className="mt-3 rounded border border-amber-500 p-3"><strong>Zapisz te jednorazowe kody poza komputerem — są pokazywane tylko raz.</strong><pre className="mt-2 whitespace-pre-wrap break-all">{codes.join('\n')}</pre><p className="mt-2 text-xs">Każdego kodu można użyć tylko raz. Kolejna operacja wymaga nowego kodu z Authenticatora.</p></div>}
    {message && <p role="alert" className="mt-2 text-red-300">{message}</p>}
  </details>;
}
