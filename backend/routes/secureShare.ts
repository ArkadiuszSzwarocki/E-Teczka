import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { hasPremium } from '../middleware/premium';
import { activeDocumentIds } from '../services/planRestrictions';
import { getPlan } from '../services/planLedger';
import { ocrOwnerKey } from '../services/ocrPremium';
import { applyWatermarkToDocument } from '../services/documentWatermark';

export function createSecureShareRouter(prisma: PrismaClient) {
  const router=express.Router();
  const table = () => prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS SecureShare (id TEXT PRIMARY KEY, ownerId INTEGER NOT NULL, documentId INTEGER NOT NULL, expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL)');
  const config = () => { const base=process.env.ETECZKA_SHARE_SERVICE_URL, secret=process.env.ETECZKA_SHARE_SERVICE_SECRET; if (!base || !secret || secret.length<32) return null; try { const url=new URL(base); if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) return null; return {base:url.origin,secret}; } catch { return null; } };
  router.get('/', async (_req,res)=>{try{await table();const owner=Number(res.locals.userId||1);const shares=await prisma.$queryRaw<Array<{id:string;documentId:number;expiresAt:string;createdAt:string}>>`SELECT id, documentId, expiresAt, createdAt FROM SecureShare WHERE ownerId=${owner} ORDER BY createdAt DESC`;res.setHeader('Cache-Control','no-store');res.json(shares);}catch{res.status(500).json({error:'Nie udało się pobrać linków.'});}});
  router.post('/', async (req,res)=>{
    try {
      if (!await hasPremium(prisma,res)) return res.status(402).json({code:'PREMIUM_REQUIRED',error:'Bezpieczne linki wymagają planu Premium.'});
      const service=config(); if(!service) return res.status(503).json({error:'Usługa linków nie jest skonfigurowana. Potrzebny jest serwer HTTPS na NAS-ie.'});
      const owner=Number(res.locals.userId||1), id=Number(req.body?.documentId), expires=Number(req.body?.expiresInSeconds), pin=req.body?.pin, singleUse=req.body?.singleUse, watermark=req.body?.watermark;
      if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(expires)||expires<60||expires>604800||(pin!==undefined&&!/^\d{6}$/.test(pin))||(singleUse!==undefined&&typeof singleUse!=='boolean')||(watermark!==undefined&&typeof watermark!=='boolean')) return res.status(400).json({error:'Nieprawidłowe ustawienia linku.'});
      const doc=await prisma.document.findFirst({where:{id,folder:{ownerId:owner},isDeleted:false},select:{id:true,filePath:true,mimeType:true}});
      if(!doc) return res.status(404).json({error:'Nie znaleziono dokumentu.'});
      const active=await activeDocumentIds(prisma,owner,await getPlan(prisma,ocrOwnerKey(res)));if(active&&!active.has(id))return res.status(403).json({code:'PLAN_LIMIT_REACHED',error:'Dokument jest tylko do odczytu w obecnym planie.'});
      if(!['application/pdf','image/jpeg','image/png'].includes(doc.mimeType)||path.basename(doc.filePath)!==doc.filePath)return res.status(400).json({error:'Obsługiwane są dokumenty PDF, JPG i PNG.'});
      const stat=await fs.stat(path.join(uploadsDir,doc.filePath));if(stat.size>50*1024*1024)return res.status(413).json({error:'Maksymalny rozmiar dokumentu to 50 MB.'});
      let bytes: Buffer = await fs.readFile(path.join(uploadsDir,doc.filePath));
      if (watermark) {
        const ownerUser = await prisma.user.findUnique({ where: { id: owner }, select: { email: true } });
        const ownerEmail = ownerUser?.email || String(res.locals.userEmail || 'Właściciel E-Teczki');
        bytes = await applyWatermarkToDocument(bytes, doc.mimeType, ownerEmail);
      }
      const remote=await fetch(`${service.base}/admin/shares`,{method:'POST',headers:{Authorization:`Bearer ${service.secret}`,'Content-Type':'application/json'},body:JSON.stringify({content:bytes.toString('base64'),mimeType:doc.mimeType,expiresInSeconds:expires,pin,singleUse}),signal:AbortSignal.timeout(30000)});
      const result=await remote.json() as {id?:string;url?:string;expiresAt?:string};if(!remote.ok||!result.id||!result.url||!result.expiresAt||!/^[a-f0-9]{64}$/.test(result.id))return res.status(502).json({error:'Serwer linków odrzucił dokument.'});
      const link=new URL(result.url);if(link.protocol!=='https:'||link.origin!==service.base||link.pathname!=='/s'||!/^#[A-Za-z0-9_-]{43}$/.test(link.hash))return res.status(502).json({error:'Serwer zwrócił nieprawidłowy adres linku.'});
      await table();try{await prisma.$executeRaw`INSERT INTO SecureShare(id,ownerId,documentId,expiresAt,createdAt) VALUES (${result.id},${owner},${id},${result.expiresAt},${new Date().toISOString()})`;}catch(error){await fetch(`${service.base}/admin/shares/${result.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${service.secret}`},signal:AbortSignal.timeout(10000)}).catch(()=>undefined);throw error;}
      res.setHeader('Cache-Control','no-store');return res.status(201).json({id:result.id,url:result.url,expiresAt:result.expiresAt});
    } catch(error){console.error('[share] Błąd tworzenia linku:',error instanceof Error ? error.message : 'nieznany');return res.status(500).json({error:'Nie udało się utworzyć linku. Sprawdź połączenie z serwerem.'});}
  });
  router.delete('/:id',async(req,res)=>{try{const service=config();if(!service)return res.status(503).json({error:'Usługa linków nie jest skonfigurowana.'});const owner=Number(res.locals.userId||1),id=req.params.id;if(!/^[a-f0-9]{64}$/.test(id))return res.sendStatus(400);await table();const found=await prisma.$queryRaw<Array<{id:string}>>`SELECT id FROM SecureShare WHERE ownerId=${owner} AND id=${id}`;if(!found.length)return res.sendStatus(404);const result=await fetch(`${service.base}/admin/shares/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${service.secret}`},signal:AbortSignal.timeout(10000)});if(!result.ok)return res.status(502).json({error:'Nie udało się unieważnić linku na serwerze.'});await prisma.$executeRaw`DELETE FROM SecureShare WHERE ownerId=${owner} AND id=${id}`;return res.status(204).end();}catch{return res.status(503).json({error:'Nie udało się połączyć z serwerem linków.'});}});
  return router;
}
