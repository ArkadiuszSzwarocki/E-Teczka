const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReceiptFromOcr } = require('../services/receiptOcrParser');

test('parses Polish pharmacy receipt without store header or date', () => {
  const ocr = [
    'PARAGON FISKALNY',
    'Ketonal Active kaps.twarde 0,05 g.1539B',
    '1 x38,00 38,00B',
    'Bez recepty 38,00',
    'Cetigran tabl.powl. 0,01 g 10 tab.6029B',
    '1 x9,00 9,00B',
    'Bez recepty 9,00',
    'Torby papierowe 230 mm x 175 mm 1.6528A',
    '1 x1,00 1,00A',
    'Bez recepty 1,00',
    'SPRZEDAZ OPODATKOWANA A 1,00',
    'SUMA PLN 48,00',
    'Do zapłaty PLN',
    '48,00',
  ].join('\n');

  const result = parseReceiptFromOcr(ocr);
  assert.equal(result.isReceipt, true);
  assert.equal(result.paymentStatus, 'paid');
  assert.equal(result.amountCents, 4800);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].name, 'Ketonal Active kaps.twarde 0,05 g');
  assert.equal(result.items[0].totalCents, 3800);
  assert.equal(result.items[1].totalCents, 900);
  assert.equal(result.items[2].totalCents, 100);
});

test('ignores PODSUMA, calculation lines, and non-receipt reports', () => {
  const fuel = parseReceiptFromOcr([
    'ORLEN',
    'PARAGON FISKALNY',
    'EFECTA DIESEL',
    '19,38 * 6,19 =',
    '119,96 A',
    'PODSUMA 119,96',
    'SUMA PLN 119,96',
  ].join('\n'));
  assert.equal(fuel.isReceipt, true);
  assert.equal(fuel.amountCents, 11996);
  assert.equal(fuel.items.every(i => !/podsuma|=/i.test(i.name)), true);

  const report = parseReceiptFromOcr('Raport z usługi Historia pojazdu\nŚrednie zużycie paliwa na 100km 10,51\nwords');
  assert.equal(report.isReceipt, false);
  assert.equal(report.items.length, 0);
  assert.equal(report.merchantName, null);
});
