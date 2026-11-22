import type { LocalDocument, LocalFolder, LocalTag } from '../types/localTesterDb';
import { readBlobDataUrl, readLocalDb, writeLocalDb } from './localTesterDisk';

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function collectBranchIds(folders: LocalFolder[], rootId: number): number[] {
  const result = [rootId];
  for (let i = 0; i < result.length; i++) {
    const current = result[i];
    for (const f of folders) if (f.parentId === current && !result.includes(f.id)) result.push(f.id);
  }
  return result;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? 0 : Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

export async function handleFolderRoutes(key: string, pathname: string, method: string, body: Record<string, any>): Promise<Response | null> {
  if (pathname === '/api/folders' && method === 'GET') {
    const db = await readLocalDb(key);
    return jsonResponse(db.folders.slice().sort((a, b) => a.order - b.order).map(f => ({
      ...f,
      _count: { documents: db.documents.filter(d => d.folderId === f.id && !d.isArchived && !d.isDeleted).length },
    })));
  }

  if (pathname === '/api/folders' && method === 'POST') {
    const db = await readLocalDb(key);
    const now = new Date().toISOString();
    const parentId = body.parentId ? Number(body.parentId) : null;
    const folder: LocalFolder = {
      id: db.nextFolderId++,
      name: String(body.name || 'Nowa kartoteka').trim(),
      parentId,
      ownerId: 1,
      order: db.folders.filter(f => f.parentId === parentId).length,
      createdAt: now,
      updatedAt: now,
    };
    db.folders.push(folder);
    await writeLocalDb(key, db);
    return jsonResponse(folder);
  }

  if (pathname === '/api/folders/reorder' && method === 'POST') {
    const db = await readLocalDb(key);
    const ids = Array.isArray(body.orderedIds) ? (body.orderedIds as number[]).map(Number) : [];
    ids.forEach((id, idx) => { const f = db.folders.find(item => item.id === id); if (f) f.order = idx; });
    await writeLocalDb(key, db);
    return jsonResponse({ success: true });
  }

  const folderMatch = /^\/api\/folders\/(\d+)(\/delete-preview|\/delete-safely|\/move)?$/.exec(pathname);
  if (!folderMatch) return null;

  const folderId = Number(folderMatch[1]);
  const suffix = folderMatch[2] || '';
  const db = await readLocalDb(key);
  const folder = db.folders.find(f => f.id === folderId);
  if (!folder) return jsonResponse({ error: 'Nie znaleziono kartoteki.' }, 404);

  if (!suffix && method === 'PATCH') {
    if (typeof body.name === 'string' && body.name.trim()) folder.name = body.name.trim();
    if (body.parentId !== undefined) folder.parentId = body.parentId === null ? null : Number(body.parentId);
    folder.updatedAt = new Date().toISOString();
    await writeLocalDb(key, db);
    return jsonResponse(folder);
  }

  if (suffix === '/delete-preview' && method === 'GET') {
    const ids = collectBranchIds(db.folders, folderId);
    const docs = db.documents.filter(d => ids.includes(d.folderId));
    return jsonResponse({
      folderIds: ids,
      documentCount: docs.filter(d => !d.isDeleted && !d.isArchived).length,
      archivedCount: docs.filter(d => !d.isDeleted && d.isArchived).length,
      trashedCount: docs.filter(d => d.isDeleted).length,
    });
  }

  if (suffix === '/delete-safely' && method === 'POST') {
    const ids = collectBranchIds(db.folders, folderId);
    const targetId = body.transferFolderId ? Number(body.transferFolderId) : null;
    if (body.mode === 'trash') {
      const fallback = db.folders.find(f => !ids.includes(f.id));
      for (const d of db.documents) {
        if (ids.includes(d.folderId)) {
          if (!fallback) return jsonResponse({ error: 'Pozostaw przynajmniej jedną inną kartotekę.' }, 409);
          d.isDeleted = true; d.isArchived = false; d.deletedAt = new Date().toISOString(); d.folderId = fallback.id;
        }
      }
    } else if (targetId) {
      for (const d of db.documents) if (ids.includes(d.folderId)) d.folderId = targetId;
    }
    db.folders = db.folders.filter(f => !ids.includes(f.id));
    await writeLocalDb(key, db);
    return jsonResponse({ success: true });
  }

  return null;
}

export async function handleDocumentRoutes(key: string, pathname: string, method: string, searchParams: URLSearchParams, body: Record<string, any>): Promise<Response | null> {
  if (pathname === '/api/documents' && method === 'GET') {
    const db = await readLocalDb(key);
    const folderIdParam = searchParams.get('folderId');
    const filtered = folderIdParam ? db.documents.filter(d => Number(d.folderId) === Number(folderIdParam)) : db.documents;
    return jsonResponse(filtered.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).map(doc => ({
      ...doc,
      folderId: Number(doc.folderId),
      fileSize: db.blobs?.[doc.filePath]?.size || 0,
      readOnly: false,
      tags: (Array.isArray(doc.tagIds) ? doc.tagIds : []).map(tid => {
        const tag = db.tags.find(t => t.id === tid);
        return tag ? { documentId: doc.id, tagId: tid, tag: { ...tag, inactive: false } } : null;
      }).filter(Boolean),
    })));
  }

  if (pathname === '/api/documents/upload-base64' && method === 'POST') {
    const db = await readLocalDb(key);
    const files = Array.isArray(body.files) ? body.files as Array<{ name: string; data: string; thumbnail?: string | null }> : [];
    const retentions = Array.isArray(body.retentions) ? body.retentions as Array<{ enabled?: boolean; value?: number; unit?: string }> : [];
    const folderId = Number(body.folderId);
    const savedDocs: LocalDocument[] = [];
    const changedFiles: Array<{ name: string; dataUrl: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ret = retentions[i] || {};
      const match = /^data:([^;,]+);base64,/.exec(f.data || '');
      const mimeType = match?.[1] || 'application/octet-stream';
      const filePath = `local_${Date.now()}_${db.nextDocId}_${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const now = new Date().toISOString();
      db.blobs[filePath] = { mimeType, dataUrl: f.data, size: estimateDataUrlBytes(f.data) };
      changedFiles.push({ name: filePath, dataUrl: f.data });
      const doc: LocalDocument = {
        id: db.nextDocId++, title: f.name, filePath, mimeType, folderId,
        physicalLocation: body.physicalLocation || null,
        retentionEnabled: ret.enabled !== false, retentionValue: Number(ret.value) || 5, retentionUnit: String(ret.unit || 'years'),
        thumbnail: f.thumbnail || null, isArchived: false, isDeleted: false, deletedAt: null,
        createdAt: now, updatedAt: now, tagIds: [], merchantName: null, amountCents: null, currency: 'PLN', dueDate: null, paymentStatus: null,
      };
      db.documents.push(doc);
      savedDocs.push(doc);
    }
    await writeLocalDb(key, db, changedFiles);
    return jsonResponse({ success: true, savedDocs, skippedDuplicates: [] });
  }

  if (pathname === '/api/documents/empty-trash' && method === 'POST') {
    const db = await readLocalDb(key);
    const toRemove = db.documents.filter(d => d.isDeleted);
    const deletedFiles = toRemove.map(d => { delete db.blobs[d.filePath]; return d.filePath; });
    db.documents = db.documents.filter(d => !d.isDeleted);
    await writeLocalDb(key, db, undefined, deletedFiles);
    return jsonResponse({ deleted: toRemove.length, failedFiles: 0 });
  }

  const docMatch = /^\/api\/documents\/(\d+)(\/data-url)?$/.exec(pathname);
  if (!docMatch) return null;

  const docId = Number(docMatch[1]);
  const isDataUrl = docMatch[2] === '/data-url';
  const db = await readLocalDb(key);
  const doc = db.documents.find(d => d.id === docId);
  if (!doc) return jsonResponse({ error: 'Nie znaleziono dokumentu.' }, 404);

  if (isDataUrl && method === 'GET') {
    const blob = await readBlobDataUrl(key, db, doc.filePath);
    return blob ? jsonResponse({ dataUrl: blob.dataUrl, mimeType: blob.mimeType, title: doc.title }) : jsonResponse({ error: 'Brak pliku.' }, 404);
  }
  if (method === 'PATCH') {
    if (typeof body.title === 'string') doc.title = body.title;
    if (body.folderId !== undefined) doc.folderId = Number(body.folderId);
    if (body.physicalLocation !== undefined) doc.physicalLocation = body.physicalLocation;
    if (body.isArchived !== undefined) doc.isArchived = Boolean(body.isArchived);
    if (body.isDeleted !== undefined) { doc.isDeleted = Boolean(body.isDeleted); doc.deletedAt = doc.isDeleted ? new Date().toISOString() : null; }
    if (body.retentionEnabled !== undefined) doc.retentionEnabled = Boolean(body.retentionEnabled);
    if (body.retentionValue !== undefined) doc.retentionValue = Number(body.retentionValue);
    if (body.retentionUnit !== undefined) doc.retentionUnit = String(body.retentionUnit);
    if (Array.isArray(body.tagIds)) doc.tagIds = body.tagIds.map(Number);
    doc.updatedAt = new Date().toISOString();
    await writeLocalDb(key, db);
    return jsonResponse(doc);
  }
  if (method === 'DELETE') {
    delete db.blobs[doc.filePath];
    db.documents = db.documents.filter(d => d.id !== docId);
    await writeLocalDb(key, db, undefined, [doc.filePath]);
    return jsonResponse({ deleted: 1 });
  }
  return null;
}

export async function handleTagRoute(key: string, pathname: string, method: string, body: Record<string, any>): Promise<Response | null> {
  if (pathname === '/api/tags' && method === 'GET') {
    return jsonResponse((await readLocalDb(key)).tags);
  }
  if (pathname === '/api/tags' && method === 'POST') {
    const db = await readLocalDb(key);
    const tag: LocalTag = { id: db.nextTagId++, name: String(body.name || 'Tag').trim(), color: String(body.color || '#3b82f6') };
    db.tags.push(tag);
    await writeLocalDb(key, db);
    return jsonResponse(tag);
  }
  const tagMatch = /^\/api\/tags\/(\d+)$/.exec(pathname);
  if (tagMatch && method === 'DELETE') {
    const tagId = Number(tagMatch[1]);
    const db = await readLocalDb(key);
    db.tags = db.tags.filter(t => t.id !== tagId);
    for (const d of db.documents) d.tagIds = d.tagIds.filter(id => id !== tagId);
    await writeLocalDb(key, db);
    return jsonResponse({ success: true });
  }
  return null;
}
