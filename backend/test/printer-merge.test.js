const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { mergeDocuments } = require('../services/mergeDocuments');

test('two scanned JPEG pages become one two-page PDF', async () => {
  const jpeg = fs.readFileSync(path.join(__dirname, 'fixtures', 'printer-page.jpg')).toString('base64');
  const data = `data:image/jpeg;base64,${jpeg}`;
  const result = await mergeDocuments([{ data }, { data }]);
  const pdf = await PDFDocument.load(result);
  assert.equal(pdf.getPageCount(), 2);
});
