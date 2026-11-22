import { useState } from 'react';

type HelpEntry = {
  id: string;
  provider: string;
  server: string;
  steps: string[];
};

const IMAP_HELP_PROVIDERS: HelpEntry[] = [
  {
    id: 'wp',
    provider: 'WP Poczta (wp.pl)',
    server: 'imap.wp.pl · port 993 · SSL/TLS',
    steps: [
      'Wyłączony dostęp IMAP — włącz ręcznie: Poczta WP → Opcje → Dostęp z programów pocztowych → włącz IMAP.',
      'Jeśli masz włączone logowanie dwuetapowe (1login / 2FA), zwykłe hasło WWW nie zadziała — wygeneruj osobne hasło aplikacji w ustawieniach bezpieczeństwa konta WP.',
    ],
  },
  {
    id: 'gmail',
    provider: 'Gmail / Google (gmail.com, googlemail.com)',
    server: 'imap.gmail.com · port 993 · SSL/TLS',
    steps: [
      'Google blokuje zwykłe hasło w programach IMAP. Włącz weryfikację dwuetapową na koncie Google i wygeneruj 16-znakowe Hasło aplikacji (Konto Google → Bezpieczeństwo → Hasła aplikacji).',
      'Sprawdź w Gmail WWW: Ustawienia → Przekazywanie i POP/IMAP → Włącz protokół IMAP.',
    ],
  },
  {
    id: 'o2',
    provider: 'o2 / Tlen / Go2 / Prokonto (o2.pl, tlen.pl, go2.pl)',
    server: 'poczta.o2.pl · port 993 · SSL/TLS',
    steps: [
      'Włącz dostęp dla programów pocztowych (IMAP) w ustawieniach poczty o2.',
      'Przy włączonym logowaniu dwuetapowym (1login) użyj hasła aplikacji zamiast hasła do strony WWW.',
    ],
  },
  {
    id: 'onet',
    provider: 'Onet Poczta (onet.pl, op.pl, vp.pl, onet.eu)',
    server: 'imap.poczta.onet.pl · port 993 · SSL/TLS',
    steps: [
      'Wymagane włączenie dostępu: Onet Poczta → Ustawienia → Dostęp z programów pocztowych → włącz IMAP.',
      'Jako login wpisz pełny adres e-mail. Jeśli masz 2FA, użyj wygenerowanego hasła aplikacji.',
    ],
  },
  {
    id: 'interia',
    provider: 'Interia / Poczta.fm / Buziaczek (interia.pl, poczta.fm, buziaczek.pl)',
    server: 'poczta.interia.pl · port 993 · SSL/TLS',
    steps: [
      'Włącz dostęp z programów pocztowych: Poczta Interia → Ustawienia → Dostęp z programów pocztowych (IMAP/POP3).',
      'Jako login podaj pełny adres e-mail (razem z @domena) oraz pozostaw włączone SSL/TLS na porcie 993.',
    ],
  },
  {
    id: 'icloud',
    provider: 'Apple iCloud (icloud.com, me.com, mac.com)',
    server: 'imap.mail.me.com · port 993 · SSL/TLS',
    steps: [
      'Zwykłe hasło do Apple ID nigdy nie działa w IMAP.',
      'Zaloguj się na appleid.apple.com → Logowanie i zabezpieczenia → Hasła do aplikacji → wygeneruj hasło i wklej je tutaj.',
    ],
  },
  {
    id: 'yahoo',
    provider: 'Yahoo Mail (yahoo.com, yahoo.pl)',
    server: 'imap.mail.yahoo.com · port 993 · SSL/TLS',
    steps: [
      'Yahoo wymaga osobnego hasła aplikacji: Informacje o koncie → Bezpieczeństwo konta → Wygeneruj hasło aplikacji.',
    ],
  },
  {
    id: 'outlook',
    provider: 'Outlook / Hotmail / Live / MSN',
    server: 'outlook.office365.com · port 993 · SSL/TLS',
    steps: [
      'Microsoft wyłącza klasyczne logowanie hasłem na kontach osobistych. Włącz weryfikację dwuetapową w koncie Microsoft i utwórz hasło aplikacji (jeśli dostępne dla Twojego typu konta).',
    ],
  },
  {
    id: 'custom',
    provider: 'Własna domena / hosting (home.pl, nazwa.pl, OVH, cyber_Folks)',
    server: 'imap.twojadomena.pl lub adres z panelu hostingu · port 993 (SSL) / 143',
    steps: [
      'Sprawdź dokładną nazwę serwera IMAP w panelu hostingu (często jest to np. mail.domena.pl lub serwerXXX.home.pl, a nie imap.domena.pl).',
      'Jeśli serwer używa portu 143 (STARTTLS) zamiast 993, wpisz port 143 i odznacz SSL/TLS.',
      'Upewnij się, że zapora/antywirus lub blokada kraju (GeoIP) na hostingu nie blokuje połączenia.',
    ],
  },
];

type Props = {
  open: boolean;
  onToggle: () => void;
};

/** Collapsible troubleshooting guide explaining IMAP setup and common login errors across major email providers. */
export function MailImapHelpPanel({ open, onToggle }: Props) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const visible = q
    ? IMAP_HELP_PROVIDERS.filter(p =>
      p.provider.toLowerCase().includes(q)
      || p.server.toLowerCase().includes(q)
      || p.steps.some(s => s.toLowerCase().includes(q)),
    )
    : IMAP_HELP_PROVIDERS;

  return (
    <div className="rounded-xl border border-slate-700/80 bg-[#0f172a]/70">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-xs font-semibold text-cyan-200 hover:text-cyan-100"
      >
        <span>{open ? '▾' : '▸'} ❓ Pomoc: dlaczego poczta nie łączy? (WP, Gmail, o2, Onet, Interia, Buziaczek, iCloud, własne)</span>
        <span className="shrink-0 text-[11px] text-slate-400">{open ? 'Zwiń' : 'Rozwiń instrukcję'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-700/80 p-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-slate-300">
              Samo poprawne logowanie przez przeglądarkę nie wystarcza — większość dostawców domyślnie blokuje IMAP lub wymaga hasła aplikacji.
            </p>
            <input
              type="search"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filtruj dostawcę (np. wp, gmail, buziaczek)…"
              aria-label="Filtruj pomoc IMAP"
              className={`w-64 rounded-lg border px-2.5 py-1 text-xs placeholder-slate-500 transition focus:border-cyan-400 focus:outline-none ${
                q
                  ? 'border-cyan-400 bg-cyan-950/45 text-cyan-100 ring-2 ring-cyan-400/50'
                  : 'border-slate-700 bg-slate-900 text-white'
              }`}
            />
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {visible.map(item => (
              <div key={item.id} className="rounded-lg border border-slate-700/80 bg-[#1e293b]/70 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <h4 className="font-bold text-white">{item.provider}</h4>
                  <span className="font-mono text-[10px] text-cyan-300">{item.server}</span>
                </div>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-300">
                  {item.steps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {visible.length === 0 && (
            <p className="text-slate-400">Brak pasującego dostawcy. Sprawdź sekcję „Własna domena / hosting” czyszcząc filtr.</p>
          )}
        </div>
      )}
    </div>
  );
}
