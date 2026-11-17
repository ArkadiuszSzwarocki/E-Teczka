import { useEffect, useState } from 'react';
import { getElectronIpc } from '../services/electron';
import type { CentralUser } from '../hooks/useCentralSignIn';

export default function HelloSignIn({ onAuthenticated }: { onAuthenticated: (user: CentralUser) => void }) {
  const [accounts, setAccounts] = useState<{email:string}[]>([]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { let active=true;void getElectronIpc()?.invoke('eteczka-hello-accounts').then(value=>{if(active&&Array.isArray(value)){const items=value.filter(item=>typeof item?.email==='string');setAccounts(items);setEmail(items[0]?.email||'');}}).catch(()=>undefined);return()=>{active=false;}; }, []);
  if (!accounts.length) return null;
  async function login() {
    setBusy(true);setMessage('');
    try {
      const result = await getElectronIpc()?.invoke('eteczka-hello-login',{email,mfaCode:code}) as {ok?:boolean;code?:string;error?:string;token?:string;user?:CentralUser}|undefined;
      if(result?.code==='MFA_REQUIRED'){setNeedsMfa(true);setMessage(result.error||'Podaj kod Authenticatora.');return;}
      if(!result?.ok||!result.token||!result.user?.email)throw new Error(result?.error||'Nie udało się zalogować.');
      localStorage.setItem('eteczka_auth_token',result.token);setCode('');onAuthenticated(result.user);
      void getElectronIpc()?.invoke('eteczka-show-main-window').catch(()=>undefined);
    }catch(error){setMessage(error instanceof Error?error.message:'Błąd Windows Hello.');}finally{setBusy(false);}
  }
  return <section className="mt-4 rounded-xl border border-blue-500/40 bg-blue-950/20 p-4">
    {accounts.length>1?<label className="block text-sm text-slate-300">Zaufane konto<select disabled={busy} value={email} onChange={e=>{setEmail(e.target.value);setNeedsMfa(false);setCode('');setMessage('');}} className="mt-2 w-full rounded-lg bg-slate-950 p-2 text-white">{accounts.map(account=><option key={account.email}>{account.email}</option>)}</select></label>:<p className="break-all text-sm text-slate-300">{email}</p>}
    {needsMfa&&<label className="mt-3 block text-sm text-slate-300">Kod Authenticatora lub kod odzyskiwania<input autoFocus autoComplete="one-time-code" value={code} maxLength={24} onChange={e=>setCode(e.target.value.replace(/\s/g,''))} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-white"/></label>}
    <button type="button" disabled={busy||(needsMfa&&!code)} onClick={()=>void login()} className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?'Weryfikacja…':needsMfa?'Potwierdź kod i zaloguj':'Zaloguj przez Windows Hello'}</button>
    {message&&<p role="status" className="mt-3 text-sm text-blue-200">{message}</p>}
  </section>;
}
