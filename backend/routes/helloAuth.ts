import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { securityDir } from '../config/paths';
import { encrypt, decrypt } from '../services/backupCrypto';
import { activeSessionWhere } from '../services/sessionPolicy';
import { requireLocalDesktop } from '../middleware/accessControl';
import { createSession, DeviceLimitError } from './auth';
import { AccountMfaRequired } from '../services/accountMfa';

type Credential = { userId: number; publicKey: string; deviceId: string };
export function createHelloAuthRouter(prisma: PrismaClient) {
  const router = express.Router(); router.use(requireLocalDesktop); router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  const filename = path.join(securityDir, 'hello-credentials.enc');
  const pending = new Map<string,{keyId:string;expires:number;failures:number;busy:boolean}>();
  const read = ():Record<string,Credential> => { try{return JSON.parse(decrypt(fs.readFileSync(filename,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;} };
  const save = (data:Record<string,Credential>) => {const temp=filename+'.tmp';fs.writeFileSync(temp,encrypt(JSON.stringify(data)),{mode:0o600});fs.renameSync(temp,filename);};
  const authenticated = async(req:express.Request) => {const token=req.header('authorization')?.replace(/^Bearer\s+/i,'')||'';return prisma.authSession.findFirst({where:{tokenHash:crypto.createHash('sha256').update(token).digest('hex'),...activeSessionWhere()},include:{user:true}});};
  router.post('/enroll',async(req,res)=>{
    try{const session=await authenticated(req);if(!session?.user)return res.status(401).json({error:'Najpierw zaloguj się przez Google lub hasłem i 2FA.'});
      const publicKey=req.body?.publicKey;if(typeof publicKey!=='string'||publicKey.length>1024)return res.sendStatus(400);
      const key=crypto.createPublicKey(publicKey);if(key.asymmetricKeyType!=='ed25519')return res.sendStatus(400);
      const normalized=key.export({type:'spki',format:'pem'}).toString();const keyId=crypto.createHash('sha256').update(normalized).digest('hex');
      const data=read();if(data[keyId]&&data[keyId].userId!==session.user.id)return res.sendStatus(409);
      for(const [id,item] of Object.entries(data))if(item.userId===session.user.id&&item.deviceId===req.body.deviceId)delete data[id];
      const deviceId=typeof req.body.deviceId==='string'&&req.body.deviceId.length>=8?req.body.deviceId.slice(0,128):`hello:${keyId.slice(0,32)}`;
      data[keyId]={userId:session.user.id,publicKey:normalized,deviceId};save(data);return res.json({keyId,email:session.user.email,userId:session.user.id});
    }catch{return res.status(503).json({error:'Nie udało się zapisać zaufanego urządzenia.'});}
  });
  router.post('/revoke',async(req,res)=>{try{const session=await authenticated(req);if(!session?.user)return res.sendStatus(401);const data=read();const keyId=String(req.body?.keyId||'');if(data[keyId]?.userId===session.user.id){delete data[keyId];save(data);}return res.sendStatus(204);}catch{return res.sendStatus(503);}});
  router.post('/challenge',(req,res)=>{
    try{for(const [id,item] of pending)if(item.expires<=Date.now())pending.delete(id);if(pending.size>=64)return res.sendStatus(429);
      const keyId=String(req.body?.keyId||'');if(!read()[keyId])return res.status(401).json({error:'Zaufanie urządzenia wygasło. Zaloguj się przez Google lub hasłem.'});
      const challenge=crypto.randomBytes(32).toString('base64url');pending.set(challenge,{keyId,expires:Date.now()+90000,failures:0,busy:false});return res.json({challenge});
    }catch{return res.sendStatus(503);}
  });
  router.post('/login',async(req,res)=>{
    const challenge=String(req.body?.challenge||'');const item=pending.get(challenge);
    if(!item||item.expires<=Date.now()||item.busy)return res.status(401).json({error:'Potwierdzenie wygasło. Użyj Windows Hello ponownie.'});
    item.busy=true;
    try{const credential=read()[item.keyId];const signature=typeof req.body?.signature==='string'?req.body.signature:'';
      if(!credential||signature.length>200||!crypto.verify(null,Buffer.from(`E-Teczka Hello login:${challenge}`),credential.publicKey,Buffer.from(signature,'base64url'))){pending.delete(challenge);return res.sendStatus(401);}
      const user=await prisma.user.findUnique({where:{id:credential.userId},select:{id:true,email:true,name:true}});if(!user){pending.delete(challenge);return res.sendStatus(401);}
      const session=await createSession(prisma,user.id,user.email,user.name,{mfaCode:req.body?.mfaCode,deviceId:credential.deviceId,deviceName:'MojaTeczka Desktop (Windows Hello)'},'trusted-hello');
      pending.delete(challenge);return res.json(session);
    }catch(error){if(error instanceof AccountMfaRequired){item.failures++;if(item.failures>=5)pending.delete(challenge);return res.status(401).json({code:error.code,error:error.message});}pending.delete(challenge);if(error instanceof Error&&error.message==='CENTRAL_REGISTRATION_REQUIRED')return res.status(409).json({error:'Po aktualizacji zaloguj się raz przez Google lub hasłem MojejTeczki, aby potwierdzić plan i zaufanie komputera.'});if(error instanceof DeviceLimitError)return res.status(403).json({code:'DEVICE_LIMIT_REACHED',error:error.message});return res.status(503).json({error:'Nie udało się zalogować przez Windows Hello.'});}finally{item.busy=false;}
  });
  return router;
}
