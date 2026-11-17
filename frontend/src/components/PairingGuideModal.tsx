import QRCode from 'react-qr-code';
import MobileAppDownload from './MobileAppDownload';

type PairedPhone = { id: string; name: string };

type Props = {
  localAddresses: string[];
  pairingCode: string;
  phoneConnected: boolean;
  pairingLimit: number | null;
  pairedPhones: PairedPhone[];
  replacementBusy: boolean;
  replacementNotice: string;
  localCaFingerprint: string;
  onReplacePhone: (deviceId: string) => void;
  onClose: () => void;
};

/** Modal guiding local Wi-Fi QR pairing between desktop E-Teczka and mobile devices. */
export default function PairingGuideModal({
  localAddresses, pairingCode, phoneConnected, pairingLimit, pairedPhones,
  replacementBusy, replacementNotice, localCaFingerprint, onReplacePhone, onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-6" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-600 bg-[#1e293b] p-7 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between gap-5">
          <div>
            <h2 className="text-2xl font-bold text-white">Połącz z urządzeniem mobilnym</h2>
            <p className="mt-1 text-slate-400">Połączenie działa wyłącznie w Twojej sieci lokalnej.</p>
          </div>
          <button type="button" onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">Adres IP i port komputera</p>
            <p className="mt-2 break-all font-mono text-lg font-semibold text-white">{localAddresses[0] || 'Brak adresu w sieci lokalnej'}</p>
          </div>
          <div className="rounded-xl border border-blue-500/50 bg-blue-950/30 p-4">
            <p className="text-xs text-blue-200">Kod parowania</p>
            <p className="mt-2 font-mono text-2xl font-bold tracking-widest text-white">{pairingCode || 'Wczytywanie…'}</p>
          </div>
          <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">Urządzenie mobilne</p>
            <p className={`mt-2 font-semibold ${phoneConnected ? 'text-emerald-300' : 'text-slate-300'}`}>{phoneConnected ? '● Połączone' : '○ Niepołączone'}</p>
          </div>
        </div>
        <div className="mb-5">
          <MobileAppDownload />
          <p className="mt-3 rounded-xl border border-blue-500/30 bg-blue-950/30 p-4 text-sm leading-6 text-blue-100">
            Kod QR lub kod parowania łączy telefon z tym komputerem jako zaufanym urządzeniem. Dzięki temu skanujesz dokumenty telefonem i przesyłasz je do archiwum przez Wi‑Fi. Konto indywidualne obsługuje jeden telefon; plany Rodzinny i Firmowy dla wielu telefonów są w przygotowaniu.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-blue-500/50 bg-blue-950/30 p-5">
            <div className="mb-3 text-4xl">🖥️</div>
            <div className="font-bold text-blue-300">1. Połącz urządzenia z Wi‑Fi</div>
            <p className="mt-2 text-sm text-slate-300">Telefon i komputer muszą być w tej samej sieci lokalnej. Otwórz E‑Teczkę na obu urządzeniach.</p>
          </div>
          <div className="rounded-xl border border-emerald-500/50 bg-emerald-950/30 p-5">
            <div className="mb-3 text-4xl">📱</div>
            <div className="font-bold text-emerald-300">2. Zeskanuj kod QR</div>
            <p className="mt-2 text-sm text-slate-300">W telefonie wybierz <b>Połączenie z komputerem → Skanuj kod QR</b> i skieruj aparat na ekran.</p>
          </div>
          <div className="rounded-xl border border-violet-500/50 bg-violet-950/30 p-5">
            <div className="mb-3 text-4xl">🔐</div>
            <div className="font-bold text-violet-300">3. Postępuj według wskazówek</div>
            <p className="mt-2 text-sm text-slate-300">Telefon pobierze i sprawdzi certyfikat przez Wi‑Fi. Następnie wybierz „Połącz” w aplikacji mobilnej.</p>
          </div>
        </div>
        <section className="mt-4 rounded-xl border border-slate-600 p-4">
          <p className="text-sm text-slate-300">Ten plan pozwala połączyć komputer z {pairingLimit ?? 1} urządzeniem mobilnym. Logowanie do konta na telefonie nie zajmuje dodatkowego miejsca komputera.</p>
          {pairedPhones.length > 0 && (
            <>
              <p className="mt-3 text-sm font-semibold text-white">Zapisane telefony</p>
              {pairedPhones.map(phone => (
                <div key={phone.id} className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-300">{phone.name}</span>
                  <button type="button" disabled={replacementBusy} onClick={() => onReplacePhone(phone.id)} className="rounded-lg border border-blue-500 px-3 py-2 text-sm text-blue-200 disabled:opacity-50">
                    Zastąp parowanie
                  </button>
                </div>
              ))}
              <p className="mt-2 text-xs text-slate-400">Użyj tej opcji także wtedy, gdy ponownie łączysz ten sam telefon po zmianie konta lub konfiguracji aplikacji.</p>
            </>
          )}
          {replacementNotice && <p role="status" className="mt-3 text-sm text-blue-200">{replacementNotice}</p>}
        </section>
        <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-cyan-500/40 bg-cyan-950/20 p-5">
          <h3 className="font-bold text-cyan-200">Szyfrowane połączenie z telefonem</h3>
          <p className="text-center text-sm text-slate-300">Na telefonie otwórz Połączenie z komputerem i zeskanuj kod QR. Aplikacja sprawdzi certyfikat przez Wi‑Fi i zapisze go w E‑Teczce. Nie musisz instalować certyfikatu w ustawieniach telefonu.</p>
          <p className="max-w-full break-all text-center font-mono text-xs text-slate-400">Odcisk SHA-256 certyfikatu: {localCaFingerprint || 'niedostępny'}</p>
          <p className="text-center text-sm text-slate-300">W aplikacji mobilnej wybierz „Skanuj kod QR”.</p>
          {localAddresses[0] && pairingCode && localCaFingerprint ? (
            <div className="rounded-lg bg-white p-4">
              <QRCode value={JSON.stringify({ serverUrl: `https://${localAddresses[0]}`, pairingCode, caFingerprint: localCaFingerprint })} size={190} />
            </div>
          ) : (
            <p className="text-sm text-amber-200">Serwer HTTPS nie jest gotowy. Uruchom ponownie E‑Teczkę na komputerze, a potem odśwież to okno.</p>
          )}
          <p className="font-mono text-xs text-slate-400">{localAddresses[0] || 'brak adresu'} · {pairingCode || 'brak kodu'}</p>
        </div>
        <div className="mt-5 grid items-center gap-5 rounded-xl border border-amber-500/40 bg-amber-950/30 p-5 md:grid-cols-[1fr_auto]">
          <div>
            <h3 className="font-bold text-amber-200">Dlaczego adres IP czasem się zmienia?</h3>
            <p className="mt-1 text-sm text-slate-300">Router przydziela adresy automatycznie (DHCP). Po restarcie routera lub komputera może przydzielić komputerowi inny adres.</p>
            <p className="mt-3 text-sm text-slate-300"><b>Jak temu zapobiec:</b> w ustawieniach routera utwórz rezerwację DHCP dla tego komputera (najbezpieczniejsze rozwiązanie). Router będzie zawsze przydzielał mu ten sam adres.</p>
          </div>
          <div className="text-center text-5xl">📡<div className="mt-2 text-xs text-amber-200">Rezerwacja DHCP</div></div>
        </div>
      </div>
    </div>
  );
}
