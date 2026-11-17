export const IDLE_SESSION_MS=20*60*1000;
let deadline=0;const listeners=new Set<()=>void>();
export function sessionDeadline(){return Math.floor(deadline/1000)*1000;}
export function setSessionDeadline(value:number){const old=sessionDeadline();deadline=value;if(old!==sessionDeadline())listeners.forEach(listener=>listener());}
export function subscribeSessionClock(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function sessionCountdown(expiresAt:number,now=Date.now()){const seconds=Math.max(0,Math.min(1200,Math.ceil((expiresAt-now)/1000)));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
