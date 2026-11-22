const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKsefXml } = require('../services/ksefXmlParser');
const { parseEReceiptPayload } = require('../services/eReceiptParser');

test('parseKsefXml extracts seller, totals, due date, and line items from FA(2) XML', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
    <Naglowek>
      <KodFormularza kodSystemowy="FA (2)" wersjaSchemy="1-0E">FA</KodFormularza>
    </Naglowek>
    <Podmiot1>
      <DaneIdentyfikacyjne>
        <NIP>5261040828</NIP>
        <Nazwa>Energia Polska Sp. z o.o.</Nazwa>
      </DaneIdentyfikacyjne>
    </Podmiot1>
    <Fa>
      <KodWaluty>PLN</KodWaluty>
      <P_1>2026-11-15</P_1>
      <P_2>FV/2026/11/0042</P_2>
      <P_15>349.99</P_15>
      <FaWiersz>
        <P_7>Energia elektryczna czynna</P_7>
        <P_8B>1</P_8B>
        <P_11A>349.99</P_11A>
      </FaWiersz>
      <Platnosc>
        <Zaplacono>0</Zaplacono>
        <TerminPlatnosci>
          <Termin>2026-11-30</Termin>
        </TerminPlatnosci>
      </Platnosc>
    </Fa>
  </Faktura>`;

  const parsed = parseKsefXml(xml);
  assert.ok(parsed);
  assert.equal(parsed.isKsef, true);
  assert.equal(parsed.merchantName, 'Energia Polska Sp. z o.o.');
  assert.equal(parsed.sellerNip, '5261040828');
  assert.equal(parsed.invoiceNumber, 'FV/2026/11/0042');
  assert.equal(parsed.amountCents, 34999);
  assert.equal(parsed.currency, 'PLN');
  assert.equal(parsed.paymentStatus, 'unpaid');
  assert.equal(parsed.dueDate.toISOString().slice(0, 10), '2026-11-30');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].name, 'Energia elektryczna czynna');
  assert.equal(parsed.items[0].totalCents, 34999);
});

test('parseKsefXml returns null for non-KSeF XML documents', () => {
  assert.equal(parseKsefXml('<note><to>Jan</to></note>'), null);
});

test('parseEReceiptPayload parses JSON e-receipt and suggests 2-year warranty for electronics', () => {
  const payload = JSON.stringify({
    merchantName: 'Media Expert',
    currency: 'PLN',
    issuedAt: '2026-11-20',
    total: '1299.00',
    items: [
      { name: 'Monitor 27 cali IPS', quantity: 1, total: '1199.00' },
      { name: 'Kabel HDMI 2m', quantity: 1, total: '100.00' },
    ],
  });

  const parsed = parseEReceiptPayload(payload);
  assert.ok(parsed);
  assert.equal(parsed.source, 'json');
  assert.equal(parsed.merchantName, 'Media Expert');
  assert.equal(parsed.amountCents, 129900);
  assert.equal(parsed.suggestWarrantyYears, 2);
  assert.equal(parsed.items.length, 2);
});

test('parseEReceiptPayload parses QR URL and key-value payloads', () => {
  const fromUrl = parseEReceiptPayload('https://eparagon.example.pl/r?store=Biedronka&total=48.90&date=2026-11-22');
  assert.ok(fromUrl);
  assert.equal(fromUrl.source, 'qr');
  assert.equal(fromUrl.merchantName, 'Biedronka');
  assert.equal(fromUrl.amountCents, 4890);

  const fromKv = parseEReceiptPayload('SKLEP:Rossmann;SUMA:72,50;DATA:2026-11-22');
  assert.ok(fromKv);
  assert.equal(fromKv.merchantName, 'Rossmann');
  assert.equal(fromKv.amountCents, 7250);
});
