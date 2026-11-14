const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const AdmZip = require('adm-zip');
process.env.AUTH_SECRET ||= 'isolated-restore-http-test-secret';
const { createBackupRouter } = require('../routes/backup');

test('restore API requires explicit replacement mode before modifying data', async () => {
  let transactions = 0;
  const tx = { folderShare:{count:async()=>0}, folder:{count:async()=>0,findMany:async()=>[],deleteMany:async()=>({})}, document:{findMany:async()=>[],deleteMany:async()=>({})} };
  const prisma = { $transaction: async action => { transactions++; return action(tx); } };
  const app = express(); app.use(express.json()); app.use('/api/backup', createBackupRouter(prisma));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const zip = new AdmZip(); zip.addFile('manifest.json', Buffer.from(JSON.stringify({version:1,folders:[],documents:[]})));
  const request = async mode => { const body = new FormData(); if(mode) body.append('restoreMode',mode); body.append('backup',new Blob([zip.toBuffer()]),'backup.zip'); return fetch(`http://127.0.0.1:${server.address().port}/api/backup/restore`,{method:'POST',body}); };
  try {
    let response = await request(); assert.equal(response.status,400); assert.match((await response.json()).error,/potwierdź/i); assert.equal(transactions,0);
    response = await request('replace'); assert.equal(response.status,200); assert.equal((await response.json()).success,true); assert.equal(transactions,1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
