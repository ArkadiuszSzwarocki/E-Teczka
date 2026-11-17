import {useEffect,useState,useSyncExternalStore} from 'react';
import {sessionDeadline,subscribeSessionClock,sessionCountdown} from '../services/sessionClock';
export default function SessionCountdown(){const expiry=useSyncExternalStore(subscribeSessionClock,sessionDeadline),[now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);if(!expiry)return null;
 return <span role="timer" aria-label={`Wylogowanie po bezczynności za ${sessionCountdown(expiry,now)}`} title="Wylogowanie po 20 minutach bezczynności. Ruch myszą, klawiatura i dotyk odnawiają sesję." className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-1 font-mono text-xs tabular-nums ${expiry-now<120000?'border-amber-500/60 text-amber-200':'border-slate-600 text-slate-300'}`}>⏱ {sessionCountdown(expiry,now)}</span>;
}
