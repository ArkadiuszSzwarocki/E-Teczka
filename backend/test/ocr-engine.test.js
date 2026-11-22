const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { extractDocumentText } = require('../services/ocrEngine');

test('extracts embedded text on each PDF page without initializing OCR', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-ocr-test-')); const file = path.join(dir, 'text.pdf');
  try {
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('FAKTURA PIERWSZA', { x: 70, y: 700, font, size: 24 });
    pdf.addPage().drawText('UMOWA DRUGA', { x: 70, y: 700, font, size: 24 });
    fs.writeFileSync(file, await pdf.save());
    const text = await extractDocumentText(file, 'application/pdf', { createRecognizer: async () => { throw new Error('OCR should not run'); } });
    assert.match(text, /FAKTURA PIERWSZA/); assert.match(text, /UMOWA DRUGA/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('recognizes an image and a scanned PDF using local language files', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-ocr-image-')); const imagePath = path.join(dir, 'scan.png'); const pdfPath = path.join(dir, 'scan.pdf');
  try {
    const canvas = createCanvas(1200, 280); const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 1200, 280); context.fillStyle = 'black'; context.font = '80px Arial'; context.fillText('FAKTURA TESTOWA 12345', 30, 150);
    const bytes = canvas.toBuffer('image/png'); fs.writeFileSync(imagePath, bytes);
    const pdf = await PDFDocument.create(); const img = await pdf.embedPng(bytes); const page = pdf.addPage([600, 140]); page.drawImage(img, { x: 0, y: 0, width: 600, height: 140 }); fs.writeFileSync(pdfPath, await pdf.save());
    assert.match(await extractDocumentText(imagePath, 'image/png'), /FAKTURA/i);
    assert.match(await extractDocumentText(pdfPath, 'application/pdf'), /FAKTURA/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hybrid and scanned PDF pages retain embedded and recognized text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-ocr-hybrid-')); const file = path.join(dir, 'hybrid.pdf');
  try {
    const canvas = createCanvas(400, 100); const png = canvas.toBuffer('image/png'); const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica); const image = await pdf.embedPng(png);
    const first = pdf.addPage(); first.drawText('TEKST PDF', { x: 20, y: 700, font }); first.drawImage(image, { x: 20, y: 500, width: 200, height: 50 });
    const second = pdf.addPage(); second.drawImage(image, { x: 20, y: 500, width: 200, height: 50 }); fs.writeFileSync(file, await pdf.save());
    let calls = 0; let closed = false;
    const text = await extractDocumentText(file, 'application/pdf', { createRecognizer: async () => ({ recognize: async () => `SKAN ${++calls}`, close: async () => { closed = true; } }) });
    assert.match(text, /TEKST PDF/); assert.match(text, /SKAN 1/); assert.match(text, /SKAN 2/); assert.equal(closed, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
