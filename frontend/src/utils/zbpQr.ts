/**
 * Builds a Polish ZBP (Związek Banków Polskich) 2D QR transfer payload compatible with
 * PKO BP, mBank, ING, Pekao, Santander, Millennium, Alior, and BNP Paribas mobile apps.
 * Format: NIP|PL|26-digit-NRB|GROSZE_6_DIGITS|RECIPIENT(<=20)|TITLE(<=32)|||
 */
export function buildZbpTransferQr(input: {
  nip?: string | null;
  iban?: string | null;
  amountGross?: number | string | null;
  recipient?: string | null;
  title?: string | null;
}): string | null {
  const rawAccount = String(input.iban || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const nrb = rawAccount.startsWith('PL') ? rawAccount.slice(2) : rawAccount;
  if (!/^\d{26}$/.test(nrb)) return null;

  const nip = String(input.nip || '').replace(/[^0-9]/g, '').slice(0, 10);
  const parsedAmount = typeof input.amountGross === 'number'
    ? input.amountGross
    : Number(String(input.amountGross || '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  const grosze = Number.isFinite(parsedAmount) && parsedAmount > 0
    ? String(Math.round(parsedAmount * 100)).padStart(6, '0')
    : '000000';

  const sanitize = (value: string, maxLen: number) =>
    value
      .replace(/[|\r\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);

  const recipient = sanitize(input.recipient || 'Odbiorca', 20);
  const title = sanitize(input.title || 'Faktura', 32);

  return `${nip}|PL|${nrb}|${grosze}|${recipient}|${title}|||`;
}
