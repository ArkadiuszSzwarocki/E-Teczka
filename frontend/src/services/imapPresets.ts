export type ImapPreset = {
  host: string;
  port: number;
  secure: boolean;
  note?: string;
};

const DOMAIN_PRESETS: Record<string, ImapPreset> = {
  'gmail.com': { host: 'imap.gmail.com', port: 993, secure: true, note: 'Dla Gmaila użyj 16-znakowego Hasła aplikacji Google (nie zwykłego hasła).' },
  'googlemail.com': { host: 'imap.gmail.com', port: 993, secure: true, note: 'Dla Gmaila użyj 16-znakowego Hasła aplikacji Google.' },
  'wp.pl': { host: 'imap.wp.pl', port: 993, secure: true, note: 'Włącz dostęp IMAP w ustawieniach poczty WP.' },
  'onet.pl': { host: 'imap.poczta.onet.pl', port: 993, secure: true, note: 'Włącz dostęp dla programów pocztowych (IMAP) w Onet Poczcie.' },
  'poczta.onet.pl': { host: 'imap.poczta.onet.pl', port: 993, secure: true },
  'op.pl': { host: 'imap.poczta.onet.pl', port: 993, secure: true },
  'vp.pl': { host: 'imap.poczta.onet.pl', port: 993, secure: true },
  'onet.eu': { host: 'imap.poczta.onet.pl', port: 993, secure: true },
  'o2.pl': { host: 'poczta.o2.pl', port: 993, secure: true, note: 'Włącz dostęp IMAP w ustawieniach o2.pl.' },
  'tlen.pl': { host: 'poczta.o2.pl', port: 993, secure: true },
  'go2.pl': { host: 'poczta.o2.pl', port: 993, secure: true },
  'prokonto.pl': { host: 'poczta.o2.pl', port: 993, secure: true },
  'interia.pl': { host: 'poczta.interia.pl', port: 993, secure: true },
  'interia.eu': { host: 'poczta.interia.pl', port: 993, secure: true },
  'poczta.fm': { host: 'poczta.interia.pl', port: 993, secure: true },
  'outlook.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'hotmail.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'live.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'msn.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'yahoo.com': { host: 'imap.mail.yahoo.com', port: 993, secure: true, note: 'Yahoo wymaga wygenerowania hasła aplikacji.' },
  'yahoo.pl': { host: 'imap.mail.yahoo.com', port: 993, secure: true },
  'icloud.com': { host: 'imap.mail.me.com', port: 993, secure: true, note: 'iCloud wymaga hasła aplikacji z konta Apple ID.' },
  'me.com': { host: 'imap.mail.me.com', port: 993, secure: true },
  'mac.com': { host: 'imap.mail.me.com', port: 993, secure: true },
};

/** Infers IMAP host, port, and SSL settings from an email address domain. */
export function detectImapPreset(email: string): ImapPreset | null {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) return null;
  const domain = email.slice(atIndex + 1).trim().toLowerCase();
  if (!domain || !domain.includes('.')) return null;

  if (DOMAIN_PRESETS[domain]) return DOMAIN_PRESETS[domain];
  return {
    host: `imap.${domain}`,
    port: 993,
    secure: true,
    note: `Wykryto własną domenę (${domain}) — sprawdzono domyślny adres imap.${domain}:993.`,
  };
}
