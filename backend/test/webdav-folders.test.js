const test = require('node:test');
const assert = require('node:assert/strict');
const { listWebDavFolders, createWebDavFolder, webDavFileUrl, normalizeWebDavEndpoint, findLatestWebDavBackup } = require('../services/webdavFolders');

test('WebDAV lists only immediate collections and creates an encoded folder', async () => {
  const old = global.fetch; const calls = [];
  global.fetch = async (url, options) => { calls.push({ url: String(url), options }); return new Response(options.method === 'PROPFIND' ? `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/dav/Dokumenty%20domowe/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/dav/plik.pdf</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>` : null, { status: options.method === 'PROPFIND' ? 207 : 201 }); };
  try {
    const connection = { endpoint: 'https://nas.local/dav', username: 'user', password: 'secret' };
    assert.deepEqual(await listWebDavFolders(connection, ''), [{ name: 'Dokumenty domowe', path: 'Dokumenty domowe' }]);
    await createWebDavFolder(connection, 'Dokumenty domowe', 'Kopie 2026');
    assert.equal(calls[1].url, 'https://nas.local/dav/Dokumenty%20domowe/Kopie%202026/');
    assert.equal(calls[1].options.redirect, 'error');
    assert.equal(webDavFileUrl(connection.endpoint, 'Kopie #1', 'dokument.zip.enc'), 'https://nas.local/dav/Kopie%20%231/dokument.zip.enc');
    await assert.rejects(createWebDavFolder(connection, '', '../inne'));
    await assert.rejects(listWebDavFolders({ ...connection, endpoint: 'http://nas.local' }, ''));
  } finally { global.fetch = old; }
});

test('selects newest backup by WebDAV properties and keeps it inside selected folder', () => {
  const item = (href, date) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype/><d:getlastmodified>${date}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  const xml = `<d:multistatus xmlns:d="DAV:">${item('/dav/Kopie%20domowe/stara.zip.enc', 'Fri, 13 Nov 2026 10:00:00 GMT')}${item('/dav/Kopie%20domowe/kopia%20nowa.zip.enc', 'Sat, 14 Nov 2026 10:00:00 GMT')}${item('/dav/inny/zla.zip.enc', 'Sun, 15 Nov 2026 10:00:00 GMT')}${item('https://other.example/dav/Kopie%20domowe/zla.zip.enc', 'Sun, 15 Nov 2026 10:00:00 GMT')}</d:multistatus>`;
  assert.equal(findLatestWebDavBackup(xml, 'https://nas.local/dav/Kopie%20domowe/'), 'kopia nowa.zip.enc');
  assert.equal(findLatestWebDavBackup('<d:multistatus xmlns:d="DAV:"/>', 'https://nas.local/dav/'), null);
  assert.throws(() => findLatestWebDavBackup('<html/>', 'https://nas.local/dav/'));
});

test('NAS endpoint accepts IP or hostname and rejects unsafe URL forms', () => {
  assert.equal(normalizeWebDavEndpoint('192.168.0.12:5001'), 'https://192.168.0.12:5001');
  assert.equal(normalizeWebDavEndpoint('nas.local:5006/webdav'), 'https://nas.local:5006/webdav');
  assert.throws(() => normalizeWebDavEndpoint('http://nas.local:5005'));
  assert.throws(() => normalizeWebDavEndpoint('https://user:secret@nas.local'));
  assert.throws(() => normalizeWebDavEndpoint(''));
});
