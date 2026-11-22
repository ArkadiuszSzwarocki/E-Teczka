const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFinanceFromOcr } = require('../services/financeOcrParser');
const { buildAnalyticsSummary } = require('../services/analyticsSummary');

test('extractFinanceFromOcr ignores contract/fee-schedule amounts in non-billable documents', () => {
  const contractText = `
    Glowne zalaczniki do umowy OMI z dnia 13 lutego 2026.
    Maksymalna suma gwarancyjna wynosi 5 878 462,55 PLN.
    Tabela oplat i prowizji: oplata 0,30 PLN.
  `;
  const result = extractFinanceFromOcr(contractText, 'Glowne zalaczniki do umowy OMI.pdf');
  assert.equal(result.amountCents, null);
});

test('extractFinanceFromOcr extracts amount and due date from real invoices', () => {
  const invoiceText = `
    FAKTURA VAT nr 12/2026
    Sprzedawca: Energia S.A.
    Termin platnosci: 2026-12-10
    Razem do zaplaty: 245,50 PLN
  `;
  const result = extractFinanceFromOcr(invoiceText, 'Faktura_Energia.pdf');
  assert.equal(result.amountCents, 24550);
  assert.equal(result.currency, 'PLN');
  assert.ok(result.dueDate instanceof Date);
  assert.equal(result.dueDate.toISOString().slice(0, 10), '2026-12-10');
});

test('extractFinanceFromOcr extracts general Razem total only for billable documents', () => {
  const billable = extractFinanceFromOcr('Faktura nr 5\nRazem: 120,00 PLN', 'Faktura.pdf');
  assert.equal(billable.amountCents, 12000);

  const nonBillable = extractFinanceFromOcr('Pakiet dokumentow\nRazem: 156 810,00 PLN', 'Pakiet dokumentow - Mars Polska.pdf');
  assert.equal(nonBillable.amountCents, null);
});

test('buildAnalyticsSummary excludes non-receipt non-invoice documents from receipt insights', async () => {
  const now = new Date();
  const prisma = {
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async () => [],
    $queryRaw: async () => [],
    folder: { findMany: async () => [{ id: 1, name: 'Dokumenty', parentId: null }] },
    document: {
      findMany: async () => [
        {
          id: 10,
          title: 'Glowne zalaczniki do umowy OMI.pdf',
          createdAt: now,
          mimeType: 'application/pdf',
          folderId: 1,
          retentionEnabled: false,
          retentionValue: 5,
          retentionUnit: 'years',
          isArchived: false,
          merchantName: null,
          amountCents: 587846255,
          currency: 'PLN',
          dueDate: null,
          paymentStatus: 'unpaid',
          lineItems: [],
        },
        {
          id: 11,
          title: 'Paragon Biedronka.jpg',
          createdAt: now,
          mimeType: 'image/jpeg',
          folderId: 1,
          retentionEnabled: false,
          retentionValue: 5,
          retentionUnit: 'years',
          isArchived: false,
          merchantName: 'Biedronka',
          amountCents: 4599,
          currency: 'PLN',
          dueDate: null,
          paymentStatus: 'paid',
          lineItems: [],
        },
      ],
      count: async () => 0,
    },
  };

  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const summary = await buildAnalyticsSummary(prisma, 1, month, { allowReceiptInvoiceReading: true });
  assert.equal(summary.receiptMerchants.length, 1);
  assert.equal(summary.receiptMerchants[0].name, 'Biedronka');
  assert.equal(summary.receiptMerchants[0].totalCents, 4599);
});
