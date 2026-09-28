const test = require('node:test');
const assert = require('node:assert/strict');

const { retentionExpired } = require('../services/retention.js');
const { collectFolderBranch, isDocumentFolder } = require('../services/folders.js');
const { parseCreatedDocuments } = require('../routes/sync.js');

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

test('documents are allowed only in a non-root folder', async () => {
  const prisma = {
    folder: {
      findUnique: async ({ where }) => {
        if (where.id === 10) return { parentId: null };
        if (where.id === 11) return { parentId: 10 };
        return null;
      },
    },
  };

  assert.equal(await isDocumentFolder(prisma, 10), false);
  assert.equal(await isDocumentFolder(prisma, 11), true);
  assert.equal(await isDocumentFolder(prisma, 99), false);
});

test('sync parsing accepts valid documents and rejects malformed retention data', () => {
  assert.deepEqual(parseCreatedDocuments({
    documents: {
      created: [{
        title: '  Umowa  ', filePath: 'umowa.pdf', mimeType: 'application/pdf', folderId: '11', retentionValue: '5', retentionUnit: 'years', thumbnail: null,
      }],
    },
  }), [{
    title: 'Umowa', filePath: 'umowa.pdf', mimeType: 'application/pdf', folderId: 11, retentionValue: 5, retentionUnit: 'years', thumbnail: null,
  }]);

  assert.equal(parseCreatedDocuments({ documents: { created: [{ title: 'Zły', filePath: 'zly.pdf', mimeType: 'application/pdf', folderId: 11, retentionValue: 5, retentionUnit: 'weeks' }] } }), null);
  assert.equal(parseCreatedDocuments({ documents: { created: [{ title: 'Root', filePath: 'root.pdf', mimeType: 'application/pdf', folderId: 0 }] } }), null);
});
