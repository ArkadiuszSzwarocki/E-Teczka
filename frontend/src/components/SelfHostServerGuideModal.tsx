import { useState } from 'react';

type Props = {
  onClose: () => void;
  onOpenBackup: () => void;
};

const ENV_SNIPPET = `PORT=3001
DATABASE_URL="file:./prisma/dev.db"
AUTH_SECRET="ustaw-dlugi-losowy-sekret-min-32-znaki"
# Opcjonalnie dla wygasających linków:
# MOJATECZKA_SHARE_SERVICE_URL="https://twoj-serwer.pl"`;

const MIGRATE_SNIPPET = `docker compose up -d
npx prisma migrate deploy`;

/** Step-by-step guide for Premium and Business users on setting up a self-hosted server and migrating the database. */
export default function SelfHostServerGuideModal({ onClose, onOpenBackup }: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(current => (current === key ? null : current)), 2000);
    }).catch(() => undefined);
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="selfhost-guide-title"
        onClick={e => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-blue-500/40 bg-[#0f172a] text-slate-200 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-700 px-6 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">Premium i Firmowy · Własny serwer</p>
            <h2 id="selfhost-guide-title" className="mt-1 text-xl font-bold text-white">Konfiguracja własnego serwera i przeniesienie bazy</h2>
          </div>
          <button type="button" aria-label="Zamknij" onClick={onClose} className="rounded-lg px-2 py-1 text-2xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-sm leading-relaxed">
          <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <h3 className="font-bold text-white">1. Eksport bazy danych i plików z aplikacji</h3>
            <p className="mt-1 text-xs text-slate-300">
              Otwórz <strong>Ustawienia → Kopia zapasowa</strong> i utwórz pełną kopię zapasową (zawiera bazę SQLite <code className="text-blue-300">dev.db</code> oraz katalog dokumentów <code className="text-blue-300">uploads/</code>) lub wyeksportuj zaszyfrowaną paczkę kopii.
            </p>
            <button type="button" onClick={onOpenBackup} className="mt-2.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500">
              Przejdź do Kopii zapasowej →
            </button>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <h3 className="font-bold text-white">2. Przygotowanie środowiska na serwerze (NAS / VPS / Docker)</h3>
            <p className="mt-1 text-xs text-slate-300">
              Skopiuj repozytorium MojejTeczki (lub obraz kontenera) na własny serwer z Node.js / Dockerem oraz skonfiguruj plik <code className="text-blue-300">.env</code> w katalogu <code className="text-blue-300">backend/</code>:
            </p>
            <div className="relative mt-2 rounded-lg border border-slate-700 bg-[#090d16] p-3 font-mono text-xs text-slate-200">
              <pre className="overflow-x-auto whitespace-pre-wrap">{ENV_SNIPPET}</pre>
              <button type="button" onClick={() => copyText('env', ENV_SNIPPET)} className="mt-2 rounded border border-slate-600 px-2.5 py-1 text-[11px] font-sans font-semibold text-slate-300 hover:bg-slate-800">
                {copiedKey === 'env' ? '✓ Skopiowano' : 'Kopiuj .env'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <h3 className="font-bold text-white">3. Przeniesienie bazy i uruchomienie migracji</h3>
            <p className="mt-1 text-xs text-slate-300">
              Skopiuj swój plik <code className="text-blue-300">dev.db</code> do <code className="text-blue-300">backend/prisma/dev.db</code> oraz folder <code className="text-blue-300">uploads/</code> do katalogu głównego serwera. Następnie uruchom kontener i migrację schematu bazy (aby uniknąć niezgodności wersji schematu):
            </p>
            <div className="relative mt-2 rounded-lg border border-slate-700 bg-[#090d16] p-3 font-mono text-xs text-slate-200">
              <pre className="overflow-x-auto whitespace-pre-wrap">{MIGRATE_SNIPPET}</pre>
              <button type="button" onClick={() => copyText('migrate', MIGRATE_SNIPPET)} className="mt-2 rounded border border-slate-600 px-2.5 py-1 text-[11px] font-sans font-semibold text-slate-300 hover:bg-slate-800">
                {copiedKey === 'migrate' ? '✓ Skopiowano' : 'Kopiuj komendy'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
            <h3 className="font-bold text-white">4. Zabezpieczenie HTTPS i połączenie z aplikacją</h3>
            <p className="mt-1 text-xs text-slate-300">
              Wystaw serwer przez odwrotne proxy z HTTPS (np. Nginx, Caddy lub Cloudflare Tunnel), a następnie użyj jego adresu w aplikacji lub skonfiguruj go jako cel kopii zapasowych NAS/WebDAV.
            </p>
          </div>
        </div>

        <footer className="flex justify-end border-t border-slate-700 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-700 px-4 py-2 text-xs font-bold text-white hover:bg-slate-600">Zamknij</button>
        </footer>
      </section>
    </div>
  );
}
