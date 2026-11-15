import express from 'express';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { requireLocalDesktop } from '../middleware/accessControl';
import { accountMfa } from '../services/accountMfa';
import { centralAccountOrigin, createCentralAccountLinks, verifyCentralSession } from '../services/centralAccountLink';
export function createAccountSecurityRouter(prisma: PrismaClient) {
 const router=express.Router();router.use(requireLocalDesktop);router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!res.locals.userId)return res.status(401).json({error:'Zaloguj się na konto.'});next();});
 const owner=(res:express.Response)=>`login:user:${Number(res.locals.userId)}`;
 async function reauthenticate(userId:number,password:unknown){
  const base=centralAccountOrigin(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);if(!base||typeof password!=='string'||password.length>200)return false;
  const user=await prisma.user.findUnique({where:{id:userId},select:{email:true}});if(!user)return false;
  let token:string|undefined;
  try{const r=await fetch(`${base}/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:user.email,password}),redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)return false;const data=await r.json() as {token?:string};token=data.token;if(!token)return false;const remote=await verifyCentralSession(base,token);return await createCentralAccountLinks(prisma).find(base,remote.id)===userId;}
  finally{if(token)await fetch(`${base}/logout`,{method:'POST',headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>undefined);}
 }
 router.get('/mfa',(_req,res)=>{try{return res.json({enabled:accountMfa.enabled(owner(res)),scope:'desktop'});}catch{return res.status(503).json({error:'Nie można odczytać zabezpieczeń.'});}});
 router.post('/mfa/start',async(req,res)=>{try{if(!await reauthenticate(Number(res.locals.userId),req.body?.password))return res.status(401).json({error:'Nieprawidłowe hasło konta.'});const {uri}=accountMfa.start(owner(res));return res.json({uri});}catch{return res.status(400).json({error:'Nie udało się rozpocząć konfiguracji. Sprawdź połączenie lub stan Authenticatora.'});}});
 router.post('/mfa/confirm',async(req,res)=>{try{const codes=accountMfa.confirm(owner(res),String(req.body?.code||''));const token=req.header('authorization')?.replace(/^Bearer\s+/i,'')||'';await prisma.authSession.deleteMany({where:{userId:Number(res.locals.userId),tokenHash:{not:createHash('sha256').update(token).digest('hex')}}});return res.json({enabled:true,codes});}catch{return res.status(400).json({error:'Nieprawidłowy kod, konfiguracja wygasła lub nie udało się zapisać ustawień.'});}});
 router.post('/mfa/disable',async(req,res)=>{try{if(!await reauthenticate(Number(res.locals.userId),req.body?.password))return res.status(401).json({error:'Nieprawidłowe hasło konta.'});if(!accountMfa.verify(owner(res),String(req.body?.code||'').trim()))return res.status(401).json({error:'Nieprawidłowy lub użyty kod. Po kilku błędach odczekaj 5 minut.'});accountMfa.remove(owner(res));return res.json({enabled:false});}catch{return res.status(503).json({error:'Nie udało się wyłączyć weryfikacji.'});}});
 return router;
}
