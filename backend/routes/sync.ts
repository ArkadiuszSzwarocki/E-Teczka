import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { errorMessage } from '../utils/errors';
import { withSyncReceipt } from '../services/syncReceipt';
import { ocrOwnerKey } from '../services/ocrPremium';
import { getPlan, checkDocumentCapacity, PlanLimitError } from '../services/planLedger';
import { activeDocumentIds } from '../services/planRestrictions';
import { assertUniqueDocument, DuplicateDocumentError, hashFile } from '../services/duplicateDocuments';
import { uploadsDir } from '../config/paths';
import path from 'path';

type Unit = 'years'|'months'|'days'|'minutes';
type DocChange = { id?: number; title: string; filePath: string; mimeType: string; folderId: number; retentionValue?: number; retentionUnit?: Unit; thumbnail?: string|null; isArchived?: boolean; isDeleted?: boolean; updatedAt?: string };
type FolderChange = { id?: number; clientId?: string; name: string; parentId?: number|null; order?: number; updatedAt?: string };
const units = new Set<Unit>(['years','months','days','minutes']);
const record = (v: unknown): Record<string, unknown>|null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(new Date(v).getTime());
export function parseSyncChanges(changes: unknown) {
  const root=record(changes), fs=record(root?.folders), ds=record(root?.documents); if (!root) return null;
  const ids=(v: unknown): number[] | null => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) return null;
    const parsed = v.map(Number);
    return parsed.every(n => Number.isInteger(n) && n > 0) ? parsed : null;
  };
  const folder=(v: unknown): FolderChange|null=>{const x=record(v);if(!x||typeof x.name!=='string')return null;const p=x.parentId==null?null:Number(x.parentId),o=x.order===undefined?0:Number(x.order);if(p!==null&&(!Number.isInteger(p)||p<1)||!Number.isInteger(o))return null;return{id:x.id===undefined?undefined:Number(x.id),clientId:typeof x.clientId==='string'?x.clientId:undefined,name:x.name.trim(),parentId:p,order:o,updatedAt:date(x.updatedAt)?String(x.updatedAt):undefined};};
  const doc=(v: unknown): DocChange|null=>{const x=record(v);if(!x||typeof x.title!=='string'||typeof x.filePath!=='string'||typeof x.mimeType!=='string')return null;const f=Number(x.folderId),rv=x.retentionValue===undefined?undefined:Number(x.retentionValue),ru=x.retentionUnit;if(!Number.isInteger(f)||f<1||(rv!==undefined&&(!Number.isFinite(rv)||rv<1))||(ru!==undefined&&(typeof ru!=='string'||!units.has(ru as Unit))))return null;return{id:x.id===undefined?undefined:Number(x.id),title:x.title.trim(),filePath:x.filePath,mimeType:x.mimeType,folderId:f,retentionValue:rv,retentionUnit:ru as Unit|undefined,thumbnail:x.thumbnail as string|null|undefined,isArchived:Boolean(x.isArchived),isDeleted:Boolean(x.isDeleted),updatedAt:date(x.updatedAt)?String(x.updatedAt):undefined};};
  const list=(v: unknown, fn: (v:unknown)=>unknown)=>v===undefined?[]:Array.isArray(v)?v.map(item => {
    const value = record(item);
    if (!value || (value.id !== undefined && (!Number.isInteger(Number(value.id)) || Number(value.id) < 1)) || (value.updatedAt !== undefined && !date(value.updatedAt))) return null;
    if (fn === doc && ((value.isArchived !== undefined && typeof value.isArchived !== 'boolean') || (value.isDeleted !== undefined && typeof value.isDeleted !== 'boolean') || (value.retentionEnabled !== undefined && typeof value.retentionEnabled !== 'boolean') || (value.retentionValue !== undefined && !Number.isInteger(Number(value.retentionValue))))) return null;
    return fn(item);
  }):null;
  const fc=list(fs?.created,folder),fu=list(fs?.updated,folder),dc=list(ds?.created,doc),du=list(ds?.updated,doc); if([fc,fu,dc,du].some(x=>x===null||(x as unknown[]).some(y=>y===null)))return null;
  const deletedFolders = ids(fs?.deleted), deletedDocuments = ids(ds?.deleted);
  if (!deletedFolders || !deletedDocuments) return null;
  return {folders:{created:fc as FolderChange[],updated:fu as FolderChange[],deleted:deletedFolders},documents:{created:dc as DocChange[],updated:du as DocChange[],deleted:deletedDocuments}};
}

export function createSyncRouter(prisma: PrismaClient) {
  const router=express.Router(); const owner=(res:express.Response)=>Number(res.locals.userId||1);
  router.post('/operation', async (req, res) => {
    const operationId = req.body?.operationId;
    const operation = req.body?.operation;
    if (typeof operationId === 'string' && operationId.trim() && operationId.length <= 128 && operation?.entity === 'folders' && operation?.type === 'updated') {
      const changes = parseSyncChanges({ folders: { updated: [operation.value] } });
      const folder = changes?.folders.updated[0];
      if (!folder?.id || !folder.name || !folder.updatedAt) return res.status(400).json({ error: 'Zmiana kartoteki wymaga identyfikatora, nazwy i daty.' });
      const ownerId = owner(res);
      try {
        const receipt = await withSyncReceipt(prisma, `user:${ownerId}`, operationId, operation, async tx => {
          const current = await tx.folder.findFirst({ where: { id: folder.id, ownerId } });
          if (!current) throw new Error('Nie znaleziono kartoteki.');
          if (!operation.force && current.updatedAt > new Date(folder.updatedAt!)) return { id: current.id, conflict: true };
          const updated = await tx.folder.update({ where: { id: current.id }, data: { name: folder.name, order: folder.order } });
          return { id: updated.id, conflict: false };
        });
        return res.json({ success: true, ...receipt });
      } catch (error) {
        console.error('[POST /api/sync/operation]', errorMessage(error));
        return res.status(409).json({ error: 'Nie udało się zastosować zmiany kartoteki.' });
      }
    }
    if (typeof operationId === 'string' && operationId.trim() && operationId.length <= 128 && operation?.entity === 'folders' && operation?.type === 'deleted') {
      const id = Number(operation.value?.id);
      if (!Number.isInteger(id) || id < 1 || !date(operation.value?.updatedAt)) return res.status(400).json({ error: 'Usunięcie kartoteki wymaga identyfikatora i daty.' });
      const ownerId = owner(res);
      try {
        const receipt = await withSyncReceipt(prisma, `user:${ownerId}`, operationId, operation, async tx => {
          const folder = await tx.folder.findFirst({ where: { id, ownerId }, select: { id: true, updatedAt: true } });
          if (!folder) throw new Error('Nie znaleziono kartoteki.');
          if (!operation.force && folder.updatedAt > new Date(operation.value.updatedAt)) throw new Error('Kartoteka została zmieniona na komputerze.');
          const [documents, children] = await Promise.all([tx.document.count({ where: { folderId: id } }), tx.folder.count({ where: { parentId: id } })]);
          if (documents || children) throw new Error('Kartoteka nie jest pusta.');
          await tx.folder.delete({ where: { id } });
          return { id };
        });
        return res.json({ success: true, ...receipt });
      } catch (error) {
        console.error('[POST /api/sync/operation]', errorMessage(error));
        return res.status(409).json({ error: 'Nie udało się usunąć kartoteki. Sprawdź, czy jest pusta.' });
      }
    }
    if (typeof operationId === 'string' && operationId.trim() && operationId.length <= 128 && operation?.entity === 'documents' && operation?.type === 'updated') {
      const changes = parseSyncChanges({ documents: { updated: [operation.value] } });
      const document = changes?.documents.updated[0];
      if (!document?.id || !document.updatedAt) return res.status(400).json({ error: 'Zmiana dokumentu wymaga identyfikatora i daty.' });
      if (operation.value.retentionEnabled !== undefined && typeof operation.value.retentionEnabled !== 'boolean') return res.status(400).json({ error: 'Nieprawidłowe ustawienie retencji.' });
      const ownerId = owner(res);
      try {
        const activeDocuments = await activeDocumentIds(prisma, ownerId, await getPlan(prisma, ocrOwnerKey(res)));
        const receipt = await withSyncReceipt(prisma, `user:${ownerId}`, operationId, operation, async tx => {
          const current = await tx.document.findFirst({ where: { id: document.id, folder: { ownerId } } });
          if (!current) throw new Error('Nie znaleziono dokumentu.');
          if (activeDocuments !== null && !activeDocuments.has(current.id)) {
            const onlyDelete = document.isDeleted === true && document.title === current.title && document.folderId === current.folderId && document.isArchived === current.isArchived && (document.retentionValue === undefined || document.retentionValue === current.retentionValue) && (document.retentionUnit === undefined || document.retentionUnit === current.retentionUnit) && (operation.value.retentionEnabled === undefined || operation.value.retentionEnabled === current.retentionEnabled);
            if (!onlyDelete) throw new PlanLimitError('dokumenty tylko do odczytu', 0);
          }
          if (!operation.force && current.updatedAt > new Date(document.updatedAt!)) return { id: current.id, conflict: true };
          const destination = await tx.folder.findFirst({ where: { id: document.folderId, ownerId }, select: { id: true } });
          if (!destination) throw new Error('Nie znaleziono kartoteki docelowej.');
          if (current.folderId !== document.folderId || (current.isDeleted && !document.isDeleted)) {
            if (path.basename(current.filePath) !== current.filePath) throw new Error('Nieprawidłowy plik dokumentu.');
            await assertUniqueDocument(tx, ownerId, document.folderId, await hashFile(path.join(uploadsDir, current.filePath)), current.id);
          }
          const updated = await tx.document.update({ where: { id: current.id }, data: { title: document.title, folderId: document.folderId, retentionValue: document.retentionValue, retentionUnit: document.retentionUnit, retentionEnabled: operation.value.retentionEnabled, isArchived: document.isArchived, isDeleted: document.isDeleted, deletedAt: document.isDeleted ? new Date() : null } });
          return { id: updated.id, conflict: false };
        });
        return res.json({ success: true, ...receipt });
      } catch (error) {
        if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message });
        if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: 'Dokument przekracza limit planu i jest tylko do odczytu.' });
        console.error('[POST /api/sync/operation]', errorMessage(error));
        return res.status(409).json({ error: 'Nie udało się zastosować zmiany dokumentu.' });
      }
    }
    if (typeof operationId !== 'string' || !operationId.trim() || operationId.length > 128 || operation?.entity !== 'folders' || operation?.type !== 'created') {
      return res.status(400).json({ error: 'Nieprawidłowa lub nieobsługiwana operacja synchronizacji.' });
    }
    const changes = parseSyncChanges({ folders: { created: [operation.value] } });
    const folder = changes?.folders.created[0];
    if (!folder || !folder.name || !folder.clientId || folder.id !== undefined) return res.status(400).json({ error: 'Nieprawidłowe dane kartoteki.' });
    const ownerId = owner(res);
    try {
      const receipt = await withSyncReceipt(prisma, `user:${ownerId}`, operationId, operation, async tx => {
        if (folder.parentId !== null && folder.parentId !== undefined) {
          const parent = await tx.folder.findFirst({ where: { id: folder.parentId, ownerId }, select: { id: true } });
          if (!parent) throw new Error('Nie znaleziono nadrzędnej kartoteki.');
        }
        const created = await tx.folder.create({ data: { name: folder.name, parentId: folder.parentId ?? null, order: folder.order ?? 0, ownerId } });
        return { clientId: folder.clientId, id: created.id };
      });
      return res.json({ success: true, ...receipt });
    } catch (error) {
      console.error('[POST /api/sync/operation]', errorMessage(error));
      return res.status(409).json({ error: 'Nie udało się zastosować operacji synchronizacji.' });
    }
  });
  router.get('/',async(req,res)=>{const n=req.query.lastPulledAt?Number(req.query.lastPulledAt):0;if(!Number.isFinite(n)||n<0)return res.status(400).json({error:'Nieprawidłowy znacznik synchronizacji.'});const since=new Date(Math.max(0,n-1000)),user=owner(res),pullStartedAt=Date.now();try{const [cf,uf,cd,ud]=await Promise.all([prisma.folder.findMany({where:{ownerId:user,createdAt:{gt:since}}}),prisma.folder.findMany({where:{ownerId:user,updatedAt:{gt:since},createdAt:{lte:since}}}),prisma.document.findMany({where:{OR:[{userId:user},{folder:{ownerId:user}}],createdAt:{gt:since}}}),prisma.document.findMany({where:{OR:[{userId:user},{folder:{ownerId:user}}],updatedAt:{gt:since},createdAt:{lte:since}}})]);res.json({changes:{folders:{created:cf,updated:uf,deleted:[]},documents:{created:cd.map(({ ocrText: _ocrText, ...document }) => document),updated:ud.map(({ ocrText: _ocrText, ...document }) => document),deleted:[]}},timestamp:pullStartedAt});}catch(e){const details=errorMessage(e);console.error('[GET /api/sync]',details);res.status(500).json({error:'Błąd pobierania synchronizacji.',details});}});
  router.post('/',async(req,res)=>{const changes=parseSyncChanges(req.body?.changes);if(!changes)return res.status(400).json({error:'Nieprawidłowe dane synchronizacji.'});const user=owner(res),folderMap:Record<string,number>={},isOwnFolder=async(id:number)=>Boolean(await prisma.folder.findFirst({where:{id,ownerId:user},select:{id:true}}));try{const plan=await getPlan(prisma,ocrOwnerKey(res));const active=await activeDocumentIds(prisma,user,plan);if(active && [...changes.documents.created,...changes.documents.updated].some(d=>d.id && !active.has(d.id)))return res.status(403).json({code:'PLAN_LIMIT_REACHED',error:'Dokument przekracza limit planu i jest tylko do odczytu.'});let applied=0;for(const f of changes.folders.created){if(!f.name)continue;const parent=f.parentId&&await isOwnFolder(f.parentId)?f.parentId:null;const x=await prisma.folder.create({data:{name:f.name,parentId:parent,order:f.order||0,ownerId:user}});if(f.clientId)folderMap[f.clientId]=x.id;applied++;}for(const f of changes.folders.updated){if(!f.id||!await isOwnFolder(f.id))continue;const x=await prisma.folder.findUnique({where:{id:f.id}});if(f.updatedAt&&x&&x.updatedAt>new Date(f.updatedAt))continue;await prisma.folder.update({where:{id:f.id},data:{name:f.name,order:f.order}});applied++;}if(changes.folders.deleted.length){await prisma.folder.deleteMany({where:{id:{in:changes.folders.deleted},ownerId:user}});applied+=changes.folders.deleted.length;}for(const d of [...changes.documents.created,...changes.documents.updated]){const folder=await prisma.folder.findFirst({where:{id:d.folderId,ownerId:user},select:{id:true}});if(!folder||!d.title)continue;const old=d.id?await prisma.document.findFirst({where:{id:d.id,OR:[{userId:user},{folder:{ownerId:user}}]}}):null;if(old&&d.updatedAt&&old.updatedAt>new Date(d.updatedAt))continue;const data={title:d.title,filePath:d.filePath,mimeType:d.mimeType,folderId:d.folderId,retentionValue:d.retentionValue??5,retentionUnit:d.retentionUnit??'years',thumbnail:d.thumbnail??null,isArchived:Boolean(d.isArchived),isDeleted:Boolean(d.isDeleted),deletedAt:d.isDeleted?new Date():null,userId:user};if(old && (old.folderId!==d.folderId || (old.isDeleted && !d.isDeleted))){if(path.basename(old.filePath)!==old.filePath)throw new Error('Nieprawidłowy plik dokumentu.');await assertUniqueDocument(prisma,user,d.folderId,await hashFile(path.join(uploadsDir,old.filePath)),old.id);}if(old)await prisma.document.update({where:{id:old.id},data});else await prisma.$transaction(async tx=>{if(path.basename(d.filePath)!==d.filePath)throw new Error('Nieprawidłowy plik dokumentu.');await assertUniqueDocument(tx,user,d.folderId,await hashFile(path.join(uploadsDir,d.filePath)));await checkDocumentCapacity(tx,user,plan,1);await tx.document.create({data});});applied++;}if(changes.documents.deleted.length){await prisma.document.updateMany({where:{id:{in:changes.documents.deleted},OR:[{userId:user},{folder:{ownerId:user}}]},data:{isDeleted:true,deletedAt:new Date()}});applied+=changes.documents.deleted.length;}res.json({success:true,applied,folderMap,timestamp:Date.now()});}catch(e){if(e instanceof DuplicateDocumentError)return res.status(409).json({code:e.code,error:e.message});if(e instanceof PlanLimitError)return res.status(403).json({code:e.code,error:e.message});const details=errorMessage(e);console.error('[POST /api/sync]',details);res.status(500).json({error:'Błąd zapisu synchronizacji.',details});}});return router;
}
