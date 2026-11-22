import path from 'node:path';
import { MfaSetupError, createBackupMfaStore } from '../services/backupMfaStore';
import express from 'express';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { requireLocalDesktop } from '../middleware/accessControl';
import { securityDir } from '../config/paths';
import { accountMfa } from '../services/accountMfa';
import { passwordMatchesAsync } from './auth';
import { centralAccountOrigin, createCentralAccountLinks, verifyCentralSession } from '../services/centralAccountLink';
import { createCentralHandoffs } from '../services/centralHandoff';
import { eraseLocalAccountCompletely } from '../services/accountErasure';
export function createAccountSecurityRouter(prisma: PrismaClient, googleHandoffs = createCentralHandoffs()) {
 const router=express.Router();router.use(requireLocalDesktop);router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!res.locals.userId)return res.status(401).json({error:'Zaloguj się na konto.'});next();});
 const owner=(res:express.Response)=>`login:user:${Number(res.locals.userId)}`;
 const approvals=new Map<string,{userId:number;session:string;action:string;expires:number}>();
 const sessionHash=(req:express.Request)=>createHash('sha256').update(req.header('authorization')||'').digest('hex');
 const bound=(req:express.Request,res:express.Response,handle:string)=>{const item=approvals.get(handle);return item&&item.expires>Date.now()&&item.userId===Number(res.locals.userId)&&item.session===sessionHash(req)?item:null;};
 router.post('/mfa/reauth/start',async(req,res)=>{
  const base=centralAccountOrigin(process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL);const action=req.body?.action;
  if(!base||!['start','disable'].includes(action))return res.status(400).json({error:'Nieprawidłowa operacja.'});
  for(const [handle,item] of approvals)if(item.expires<=Date.now()){approvals.delete(handle);googleHandoffs.finish(handle);}
  if(approvals.size>=64)return res.status(429).json({error:'Zbyt wiele rozpoczętych potwierdzeń.'});
  try{const result=await googleHandoffs.start(base);approvals.set(result.handle,{userId:Number(res.locals.userId),session:sessionHash(req),action,expires:result.expiresAt});const url=new URL(result.url);url.searchParams.set('login','google');url.searchParams.set('purpose','security');return res.json({...result,url:url.href});}catch{return res.status(503).json({error:'Nie można rozpocząć potwierdzenia Google.'});}
 });
 router.post('/mfa/reauth/poll',async(req,res)=>{
  const handle=String(req.body?.handle||'');if(!bound(req,res,handle))return res.status(403).json({error:'Potwierdzenie wygasło lub należy do innej sesji.'});
  try{const result=await googleHandoffs.poll(handle);if(result.status==='approved'){const base=centralAccountOrigin(process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL);if(!base||await createCentralAccountLinks(prisma).find(base,result.user.id)!==Number(res.locals.userId))return res.status(403).json({error:'Wybierz konto Google przypisane do aktualnego konta E‑Teczki.'});}return res.json({status:result.status});}catch{return res.status(400).json({error:'Potwierdzenie wygasło. Rozpocznij je ponownie.'});}
 });
 async function authorizeChange(req:express.Request,res:express.Response,action:string,consume=true){
  const handle=typeof req.body?.googleHandle==='string'?req.body.googleHandle:'';
  if(!handle)return reauthenticate(Number(res.locals.userId),req.body?.password);
  const binding=bound(req,res,handle);if(!binding||binding.action!==action)return false;
  if(!consume){const result=await googleHandoffs.poll(handle);const base=centralAccountOrigin(process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL);return result.status==='approved'&&Boolean(base)&&await createCentralAccountLinks(prisma).find(base!,result.user.id)===Number(res.locals.userId);}
  approvals.delete(handle);
  try{const approved=await googleHandoffs.take(handle);try{return await createCentralAccountLinks(prisma).find(approved.origin,approved.user.id)===Number(res.locals.userId);}finally{await fetch(`${approved.origin}/logout`,{method:'POST',headers:{authorization:`Bearer ${approved.centralToken}`},redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>undefined);}}finally{googleHandoffs.finish(handle);}
 }
 async function reauthenticate(userId:number,password:unknown){
  const base=centralAccountOrigin(process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL);if(!base||typeof password!=='string'||password.length>200)return false;
  const user=await prisma.user.findUnique({where:{id:userId},select:{email:true}});if(!user)return false;
  let token:string|undefined;
  try{const r=await fetch(`${base}/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:user.email,password}),redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)return false;const data=await r.json() as {token?:string};token=data.token;if(!token)return false;const remote=await verifyCentralSession(base,token);return await createCentralAccountLinks(prisma).find(base,remote.id)===userId;}
  finally{if(token)await fetch(`${base}/logout`,{method:'POST',headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>undefined);}
 }
 router.get('/mfa',(_req,res)=>{try{return res.json({enabled:accountMfa.enabled(owner(res)),scope:'desktop'});}catch{return res.status(503).json({error:'Nie można odczytać zabezpieczeń.'});}});
 router.post('/mfa/start',async(req,res)=>{try{if(!await authorizeChange(req,res,'start'))return res.status(401).json({error:'Potwierdź tożsamość przez Google lub hasłem E‑Teczki.'});const {uri,expiresAt}=accountMfa.start(owner(res));return res.json({uri,expiresAt});}catch{return res.status(400).json({error:'Nie udało się rozpocząć konfiguracji. Sprawdź połączenie lub stan Authenticatora.'});}});
 router.post('/mfa/confirm',async(req,res)=>{try{const codes=accountMfa.confirm(owner(res),String(req.body?.code||''));const token=req.header('authorization')?.replace(/^Bearer\s+/i,'')||'';let warning;try{await prisma.authSession.deleteMany({where:{userId:Number(res.locals.userId),tokenHash:{not:createHash('sha256').update(token).digest('hex')}}});}catch{warning='2FA zostało włączone, ale nie udało się wylogować pozostałych sesji.';}return res.json({enabled:true,codes,warning});}catch(error){if(error instanceof MfaSetupError)return res.status(400).json({code:error.code,error:error.message});return res.status(503).json({code:'MFA_SAVE_FAILED',error:'Nie udało się odczytać lub zapisać ustawień 2FA na komputerze. To błąd zapisu, a nie odrzucenie kodu. Spróbuj ponownie.'});}});
 router.post('/mfa/disable',async(req,res)=>{try{if(!await authorizeChange(req,res,'disable',false))return res.status(401).json({error:'Potwierdź tożsamość przez Google lub hasłem E‑Teczki.'});if(!accountMfa.verify(owner(res),String(req.body?.code||'').trim()))return res.status(401).json({code:'MFA_INVALID_CODE',error:'Kod jest nieprawidłowy, wygasł lub był już użyty. Wpisz aktualny kod Authenticatora. Potwierdzenie Google pozostaje ważne do końca tej operacji. Po kilku błędach odczekaj 5 minut.'});if(req.body?.googleHandle&&!await authorizeChange(req,res,'disable'))return res.status(401).json({error:'Potwierdzenie Google wygasło. Rozpocznij ponownie.'});accountMfa.remove(owner(res));return res.json({enabled:false});}catch{return res.status(503).json({error:'Nie udało się wyłączyć weryfikacji.'});}});
 const backupMfa = createBackupMfaStore(path.join(securityDir, 'backup-mfa.enc'));
 router.post('/verify-unmask', async (req, res) => {
  const method = req.body?.method === 'totp' ? 'totp' : req.body?.method === 'password' ? 'password' : null;
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!method || !code) {
   return res.status(400).json({ error: 'Podaj metodę oraz kod lub hasło do odkodowania.' });
  }
  const userId = Number(res.locals.userId);
  if (method === 'totp') {
   const accountEnabled = accountMfa.enabled(owner(res));
   const backupEnabled = backupMfa.enabled(`documents:${userId}`);
   if (!accountEnabled && !backupEnabled) {
    return res.status(400).json({ error: 'Authenticator nie jest skonfigurowany. Użyj hasła lub PIN-u.' });
   }
   const ok = (accountEnabled && accountMfa.verify(owner(res), code))
    || (backupEnabled && backupMfa.verify(`documents:${userId}`, code));
   if (!ok) {
    return res.status(403).json({ error: 'Nieprawidłowy lub wygasły kod Authenticatora.' });
   }
   return res.json({ verified: true });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const localOk = Boolean(user && await passwordMatchesAsync(code, user.passwordHash));
  const centralOk = !localOk && await reauthenticate(userId, code);
  if (!localOk && !centralOk) {
   return res.status(403).json({ error: 'Nieprawidłowe hasło konta.' });
  }
  return res.json({ verified: true });
 });

 router.post('/delete-account', async (req, res) => {
  try {
   if (String(req.body?.confirmation || '').trim().toUpperCase() !== 'USUŃ') {
    return res.status(400).json({ error: 'Wpisz słowo USUŃ, aby potwierdzić trwałe skasowanie konta i wszystkich danych.' });
   }
   const result = await eraseLocalAccountCompletely(prisma, Number(res.locals.userId), {
    deleteCentral: req.body?.deleteCentral === true,
    centralPassword: typeof req.body?.password === 'string' ? req.body.password : undefined,
   });
   return res.json({ success: true, ...result });
  } catch (error) {
   return res.status(500).json({ error: error instanceof Error ? error.message : 'Nie udało się usunąć konta.' });
  }
 });
 return router;
}
