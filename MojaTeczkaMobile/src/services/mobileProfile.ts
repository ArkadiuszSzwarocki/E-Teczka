import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';

const LAST='mojateczka.mobile.last-profile';
const OWNER='mojateczka.mobile.vault-owner',KNOWN='mojateczka.mobile.known-accounts';
let current:string|null=null,namespace='',switching=false,operations=0;
let changes:Promise<unknown>=Promise.resolve();
export function currentMobileAccount(){return current;}
function selected(){if(!current)throw new Error('Najpierw wybierz konto i zaloguj się.');return namespace;}
export function profileKey(base:string){const suffix=selected();return suffix?`${base}.${suffix}`:base;}
export function profileDirectory(base:string){const suffix=selected();return suffix?`${base.replace(/\/$/,'')}-${suffix}${base.endsWith('/')?'/':''}`:base;}
export function profileCacheDirectory(){const suffix=selected();return suffix?`${FileSystem.cacheDirectory}mojateczka-profiles/${suffix}/`:FileSystem.cacheDirectory!;}
export function profileOperation<A extends unknown[],R>(run:(...args:A)=>Promise<R>){return async(...args:A):Promise<R>=>{if(switching||!current)throw new Error('Trwa zmiana konta. Zaczekaj i ponów operację.');operations++;try{return await run(...args);}finally{operations--;}};}
export async function knownMobileAccounts():Promise<{id:string;email:string}[]>{try{const data=JSON.parse(await SecureStore.getItemAsync(KNOWN)||'[]');return Array.isArray(data)?data.filter(item=>typeof item?.id==='string'&&typeof item?.email==='string'):[];}catch{return [];}}
export function selectMobileProfile(userId:string,email?:string){
 const change=async()=>{
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(userId))throw new Error('Nieprawidłowy identyfikator konta.');
  if(current!==userId){switching=true;try{
   const until=Date.now()+15000;while(operations){if(Date.now()>until)throw new Error('Poprzednie konto kończy operacje. Zaczekaj i zaloguj się ponownie.');await new Promise(resolve=>setTimeout(resolve,50));}
   let legacyOwner=await SecureStore.getItemAsync(OWNER);if(!legacyOwner){await SecureStore.setItemAsync(OWNER,userId);legacyOwner=userId;}
   const suffix=legacyOwner===userId?'':`account-${userId}`;
   if(suffix)await FileSystem.makeDirectoryAsync(`${FileSystem.cacheDirectory}mojateczka-profiles/${suffix}/`,{intermediates:true});
   const previous=await SecureStore.getItemAsync(LAST);if(previous&&previous!==userId)try{await require('expo-notifications').cancelAllScheduledNotificationsAsync();}catch{}
   await SecureStore.setItemAsync(LAST,userId);namespace=suffix;current=userId;
  }finally{switching=false;}}
  if(email){const accounts=await knownMobileAccounts();await SecureStore.setItemAsync(KNOWN,JSON.stringify([{id:userId,email},...accounts.filter(item=>item.id!==userId)]));}
 };
 const task=changes.then(change,change);changes=task.catch(()=>undefined);return task;
}
export function closeMobileProfile(){switching=true;const close=async()=>{const until=Date.now()+15000;while(operations){if(Date.now()>until)throw new Error('Poczekaj na zakończenie operacji konta.');await new Promise(resolve=>setTimeout(resolve,50));}current=null;namespace='';};const task=changes.then(close,close);changes=task.catch(()=>undefined);return task.finally(()=>{switching=false;});}
