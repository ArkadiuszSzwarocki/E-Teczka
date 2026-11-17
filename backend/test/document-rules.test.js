const test = require('node:test');
const assert = require('node:assert/strict');

const { retentionExpired } = require('../services/retention.js');
const { collectFolderBranch, isDocumentFolder } = require('../services/folders.js');
const { parseSyncChanges } = require('../routes/sync.js');

test('retentionExpired recognizes documents that are past their retention date', () => {
  assert.equal(retentionExpired({
    createdAt: new Date(Date.now() - 2 * 60_000),
    retentionValue: 1,
    retentionUnit: 'minutes',
  }), true);

  assert.equal(retentionExpired({
    createdAt: new Date(Date.now() - 24 * 60 * 60_000),
    retentionValue: 2,
    retentionUnit: 'days',
  }), false);
});

test('retentionExpired rejects an unsupported retention unit', () => {
  assert.equal(retentionExpired({
    createdAt: new Date(2000, 0, 1),
    retentionValue: 1,
    retentionUnit: 'weeks',
  }), false);
});

test('collectFolderBranch returns a whole nested branch', async () => {
  const children = new Map([
    [1, [{ id: 2 }, { id: 3 }]],
    [2, [{ id: 4 }]],
    [3, []],
    [4, []],
  ]);
  const prisma = {
    folder: {
      findMany: async ({ where }) => children.get(where.parentId) ?? [],
    },
  };

  assert.deepEqual(await collectFolderBranch(prisma, 1), [1, 2, 4, 3]);
});

test('documents are allowed in both root and nested folders', async () => {
  const prisma = {
    folder: {
      findUnique: async ({ where }) => {
        if (where.id === 10) return { id: 10, parentId: null };
        if (where.id === 11) return { id: 11, parentId: 10 };
        return null;
      },
    },
  };

  assert.equal(await isDocumentFolder(prisma, 10), true);
  assert.equal(await isDocumentFolder(prisma, 11), true);
  assert.equal(await isDocumentFolder(prisma, 99), false);
  assert.equal(await isDocumentFolder(prisma, 0), false);
});

test('sync parsing accepts valid documents and rejects malformed retention data', () => {
  const result = parseSyncChanges({
    documents: {
      created: [{
        title: '  Umowa  ', filePath: 'umowa.pdf', mimeType: 'application/pdf', folderId: '11', retentionValue: '5', retentionUnit: 'years', thumbnail: null,
      }],
    },
  });
  assert.equal(result.documents.created[0].title, 'Umowa');
  assert.equal(result.documents.created[0].folderId, 11);
  assert.equal(result.documents.created[0].retentionValue, 5);

  assert.equal(parseSyncChanges({ documents: { created: [{ title: 'Zły', filePath: 'zly.pdf', mimeType: 'application/pdf', folderId: 11, retentionValue: 5, retentionUnit: 'weeks' }] } }), null);
  assert.equal(parseSyncChanges({ documents: { created: [{ title: 'Root', filePath: 'root.pdf', mimeType: 'application/pdf', folderId: 0 }] } }), null);
  assert.equal(parseSyncChanges({ documents: { deleted: [1, 'invalid'] } }), null);
  assert.equal(parseSyncChanges({ folders: { deleted: 'invalid' } }), null);
  assert.equal(parseSyncChanges({ folders: { updated: [{ id: 1, name: 'A', updatedAt: 'not-a-date' }] } }), null);
  assert.equal(parseSyncChanges({ folders: { updated: [{ id: -1, name: 'A' }] } }), null);
  const validDoc = { id: 1, title: 'Test', filePath: 'test.pdf', mimeType: 'application/pdf', folderId: 11 };
  assert.equal(parseSyncChanges({ documents: { updated: [{ ...validDoc, isArchived: 'false' }] } }), null);
  assert.equal(parseSyncChanges({ documents: { updated: [{ ...validDoc, retentionValue: 1.5 }] } }), null);
});
