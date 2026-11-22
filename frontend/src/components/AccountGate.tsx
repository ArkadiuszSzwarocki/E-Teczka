import {IDLE_SESSION_MS,setSessionDeadline} from '../services/sessionClock';
import { useEffect, useState, type ReactNode } from 'react';
import TrustedHelloStart from './TrustedHelloStart';
import { getElectronIpc } from '../services/electron';
import WelcomeScreen from './WelcomeScreen';
import { resolveApiBase } from '../services/apiBase';
export default function AccountGate({ children }: { children: ReactNode }) {
 const [authenticated, setAuthenticated] = useState(false), [checking, setChecking] = useState(true);
 const [error, setError] = useState('');
 const [trustedAccounts,setTrustedAccounts]=useState<{email:string}[]>([]),[useOther,setUseOther]=useState(false),[autoHello,setAutoHello]=useState(true);
 useEffect(() => {
  let active=true,bootstrapComplete=false,verifiedToken='',deadline=0,confirmedExpiry=0,lastSent=0,lastActivity=0;
  let expiryTimer:number|undefined,renewTimer:number|undefined,renewBusy=false;
  const base=resolveApiBase(window.location,import.meta.env.VITE_API_URL);
  function arm(token:string,expiry:number){deadline=expiry;setSessionDeadline(expiry);window.clearTimeout(expiryTimer);expiryTimer=window.setTimeout(()=>{if(deadline<=Date.now())expire(token);},Math.max(0,expiry-Date.now()));}
  function expire(token:string,reason='Sesja wygasła po 20 minutach bezczynności. Zaloguj się ponownie.',forceWelcome=false){
   if(!active)return;
   if(token&&localStorage.getItem('mojateczka_auth_token')===token)localStorage.removeItem('mojateczka_auth_token');
   verifiedToken='';deadline=0;window.clearTimeout(renewTimer);setSessionDeadline(0);setAuthenticated(false);setChecking(false);
   if(forceWelcome){setTrustedAccounts([]);setUseOther(true);void getElectronIpc()?.invoke('mojateczka-hello-clear').catch(()=>undefined);}
   setError(reason);
   if(token)void fetch(`${base}/api/auth/logout`,{method:'POST',headers:{authorization:`Bearer ${token}`}}).catch(()=>undefined);
   window.dispatchEvent(new Event('mojateczka-auth-changed'));
  }
  function queueRenew(){if(renewTimer!==undefined||renewBusy)return;renewTimer=window.setTimeout(()=>{renewTimer=undefined;void renew();},Math.max(0,5000-(Date.now()-lastSent)));}
  async function renew(){
   const token=localStorage.getItem('mojateczka_auth_token');if(!active||!token||token!==verifiedToken||!lastActivity)return;
   renewBusy=true;lastSent=Date.now();const activityAtSend=lastActivity;
   try{
    const response=await fetch(`${base}/api/auth/activity`,{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
    if(!active||localStorage.getItem('mojateczka_auth_token')!==token)return;
    if(response.status===401){expire(token);return;}
    if(response.status===403){const err=await response.clone().json().catch(()=>({})) as {code?:string};if(err.code==='DEVICE_REVOKED'){expire(token,'To urządzenie zostało usunięte z konta i zostało automatycznie wylogowane.',true);return;}}
    if(!response.ok)throw new Error();
    const data=await response.json(),expiry=Date.parse(data.expiresAt);if(!Number.isFinite(expiry))throw new Error();
    const serverNow=Date.parse(data.serverNow);confirmedExpiry=Date.now()+expiry-(Number.isFinite(serverNow)?serverNow:Date.now());
    arm(token,Math.max(deadline,confirmedExpiry));setError('');
   }catch{if(active&&localStorage.getItem('mojateczka_auth_token')===token){setError('Nie udało się odnowić sesji. Sprawdź połączenie z aplikacją.');}}
   finally{renewBusy=false;if(active&&verifiedToken===token&&lastActivity>activityAtSend)queueRenew();}
  }
  function activity(){const token=localStorage.getItem('mojateczka_auth_token');if(!active||!token||token!==verifiedToken)return;if(deadline<=Date.now()){expire(token);return;}lastActivity=Date.now();arm(token,lastActivity+IDLE_SESSION_MS);queueRenew();}
  async function check(){
   if(!bootstrapComplete)return;const token=localStorage.getItem('mojateczka_auth_token');
   if(!token){verifiedToken='';window.clearTimeout(expiryTimer);window.clearTimeout(renewTimer);renewTimer=undefined;setSessionDeadline(0);if(active){setAuthenticated(false);setChecking(false);}return;}
   try{
    const response=await fetch(`${base}/api/auth/me`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
    if(!active||localStorage.getItem('mojateczka_auth_token')!==token)return;
    if(response.status===401){expire(token);return;}
    if(response.status===403){const err=await response.clone().json().catch(()=>({})) as {code?:string};if(err.code==='DEVICE_REVOKED'){expire(token,'To urządzenie zostało usunięte z konta i zostało automatycznie wylogowane.',true);return;}}
    if(!response.ok)throw new Error();const user=await response.json();if(!user.email)throw new Error();
    const rawExpiry=Date.parse(user.expiresAt),serverNow=Date.parse(user.serverNow);if(!Number.isFinite(rawExpiry))throw new Error();
    const expiry=Date.now()+rawExpiry-(Number.isFinite(serverNow)?serverNow:Date.now());confirmedExpiry=expiry;
    if(verifiedToken!==token){verifiedToken=token;lastActivity=0;lastSent=0;arm(token,expiry);}else if(!renewBusy&&renewTimer===undefined){arm(token,Math.min(deadline,expiry));}
    if(deadline<=Date.now()){expire(token);return;}setAuthenticated(true);setError('');
   }catch{if(active&&localStorage.getItem('mojateczka_auth_token')===token){if(verifiedToken!==token||deadline<=Date.now()){setAuthenticated(false);setError('Nie udało się sprawdzić sesji. Sprawdź połączenie i zaloguj się ponownie.');}}}
   finally{if(active)setChecking(false);}
  }
  void(async()=>{try{if(!sessionStorage.getItem('mojateczka_hello_checked')){const accounts=await getElectronIpc()?.invoke('mojateczka-hello-accounts');sessionStorage.setItem('mojateczka_hello_checked','1');if(active&&Array.isArray(accounts)&&accounts.some(item=>typeof item?.email==='string')){localStorage.removeItem('mojateczka_auth_token');bootstrapComplete=true;setTrustedAccounts(accounts.filter(item=>typeof item?.email==='string'));setChecking(false);return;}}}catch{}bootstrapComplete=true;if(active)await check();})();
  const timer=window.setInterval(()=>void check(),15000);
  const events=['mousemove','pointerdown','keydown','wheel','touchstart'];events.forEach(name=>window.addEventListener(name,activity,{passive:true,capture:true}));
  const ipc=getElectronIpc(),nativeActivity=()=>activity();ipc?.on('mojateczka-user-activity',nativeActivity);
  const handleDeviceRevoked=(event:Event)=>{const detail=(event as CustomEvent<string>).detail;expire(localStorage.getItem('mojateczka_auth_token')||verifiedToken,detail||'To urządzenie zostało usunięte z konta i zostało automatycznie wylogowane.',true);};
  window.addEventListener('mojateczka-device-revoked',handleDeviceRevoked);
  window.addEventListener('mojateczka-auth-changed',check);window.addEventListener('focus',check);
  return()=>{active=false;window.clearInterval(timer);window.clearTimeout(expiryTimer);window.clearTimeout(renewTimer);setSessionDeadline(0);events.forEach(name=>window.removeEventListener(name,activity,true));ipc?.removeListener('mojateczka-user-activity',nativeActivity);window.removeEventListener('mojateczka-device-revoked',handleDeviceRevoked);window.removeEventListener('focus',check);window.removeEventListener('mojateczka-auth-changed',check);};
 }, []);

 if (checking) return <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">Sprawdzanie konta…</main>;
 if (!authenticated && trustedAccounts.length && !useOther) return <TrustedHelloStart accounts={trustedAccounts} autoStart={autoHello} onAuthenticated={()=>{setError('');setAutoHello(false);window.dispatchEvent(new Event('mojateczka-auth-changed'));}} onUseOther={()=>{setAutoHello(false);setUseOther(true);}}/>;
 if (!authenticated) return <>{error && <p role="alert" className="fixed bottom-4 left-4 z-[150] max-w-md rounded-lg bg-red-950 p-4 text-sm text-red-200">{error}</p>}<WelcomeScreen onContinue={() => undefined} onAuthenticated={() => { setError(''); window.dispatchEvent(new Event('mojateczka-auth-changed')); }} /></>;
 return <>{children}</>;
}
