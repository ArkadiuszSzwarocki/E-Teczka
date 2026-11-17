import { useEffect, useRef } from 'react';
import { closeExternalAccountPopup, getElectronIpc, getScaledElementBounds, openExternalAccountUrl, updateExternalAccountBounds } from '../services/electron';
import GoogleIcon from './GoogleIcon';
import HelloSignIn from './HelloSignIn';
import { useCentralSignIn, type CentralUser } from '../hooks/useCentralSignIn';

type Props = { apiUrl: string; origin: string; deviceId: string; onBack: () => void; onAuthenticated: (user: CentralUser) => void; googleRegistration?: boolean; onSessionStateChange?: (active: boolean) => void };

export default function CentralSignIn({ apiUrl, origin, deviceId, onAuthenticated, googleRegistration = false, onSessionStateChange }: Props) {
  const s = useCentralSignIn(apiUrl, origin, deviceId, onAuthenticated);
  const embedSlotRef = useRef<HTMLDivElement | null>(null);
  const isElectron = Boolean(getElectronIpc());
  const hasSessionOverlay = Boolean(s.start || s.user || s.deviceLimitReached || s.needsLink);
  useEffect(() => {
    onSessionStateChange?.(hasSessionOverlay);
  }, [hasSessionOverlay, onSessionStateChange]);

  useEffect(() => {
    if (!isElectron || !s.start || s.user) return;
    const slot = embedSlotRef.current;
    const bounds = getScaledElementBounds(slot);
    if (!bounds) return;
    void openExternalAccountUrl(s.start.url, origin, bounds);
    const syncBounds = () => {
      const next = getScaledElementBounds(embedSlotRef.current);
      if (next) void updateExternalAccountBounds(next);
    };
    const observer = typeof ResizeObserver !== 'undefined' && slot ? new ResizeObserver(syncBounds) : null;
    if (observer && slot) observer.observe(slot);
    window.addEventListener('resize', syncBounds);
    window.addEventListener('scroll', syncBounds, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.removeEventListener('scroll', syncBounds, true);
      closeExternalAccountPopup();
    };
  }, [isElectron, s.start, s.user, origin]);
  const input = 'mt-2 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white';
  const button = 'mt-3 w-full rounded-lg bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50';

  return (
    <div>
      {googleRegistration && !s.start && <div className="mt-4 border-t border-slate-700 pt-3"><p className="text-center text-sm text-slate-400">lub utwórz konto przez Google</p><button type="button" disabled={s.busy} onClick={() => void s.beginBrowser(isElectron ? { x: 0, y: 0, width: 320, height: 340 } : undefined)} className="mt-3 w-full rounded-xl border border-slate-600 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><span className="flex items-center justify-center gap-3"><GoogleIcon />{s.busy ? 'Otwieranie Google…' : 'Zarejestruj przez Google'}</span></button></div>}
      {!googleRegistration && !s.start && s.tab !== 'reset' && (
        <div className="mt-4">
          <HelloSignIn onAuthenticated={onAuthenticated}/>
          <input aria-label="E-mail konta" value={s.centralEmail} onChange={e => s.setCentralEmail(e.target.value)} placeholder="E-mail" type="email" autoComplete="email" className={input} />
          <input aria-label="Hasło konta" value={s.centralPassword} onChange={e => s.setCentralPassword(e.target.value)} placeholder="Hasło (min. 8 znaków)" type="password" autoComplete="current-password" className={input} />
          <button disabled={s.busy} onClick={() => void s.submitDirect()} className={button}>Zaloguj e-mailem</button>
          <button type="button" disabled={s.busy} onClick={() => void s.beginBrowser(isElectron ? { x: 0, y: 0, width: 320, height: 340 } : undefined)} className="mt-3 w-full rounded-lg border border-slate-600 px-4 py-2.5 text-sm text-slate-200 disabled:opacity-50">
            <span className="flex items-center justify-center gap-3"><GoogleIcon />Zaloguj przez Google</span>
          </button>
          <button type="button" onClick={() => s.setTab('reset')} className="mt-3 w-full text-sm text-slate-300 hover:text-white">
            Resetuj hasło
          </button>
        </div>
      )}

      {!s.start && s.tab === 'reset' && (
        <div className="mt-4">
          <p className="text-sm text-slate-300">Podaj adres e-mail konta, aby otrzymać link do zmiany hasła.</p>
          <input aria-label="E-mail konta" value={s.centralEmail} onChange={e => s.setCentralEmail(e.target.value)} placeholder="E-mail" type="email" autoComplete="email" className={input} />
          <button disabled={s.busy} onClick={() => void s.submitDirect()} className={button}>Wyślij link resetu</button>
          <button type="button" onClick={() => s.setTab('login')} className="mt-3 w-full text-sm text-blue-300">
            Wróć do logowania
          </button>
        </div>
      )}

      {s.start && !s.user && (
        isElectron ? (
          <div className="mt-4 space-y-2.5">
            <p className="text-xs text-slate-400">Potwierdź logowanie Google poniżej:</p>
            <div ref={embedSlotRef} className="h-[420px] w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950" />
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-slate-600 p-4">
            <p className="text-sm text-slate-300">Dokończ logowanie w oknie Google. E‑Teczka otworzy się automatycznie po zalogowaniu.</p>
            <button className="mt-3 text-sm text-blue-300" onClick={() => void openExternalAccountUrl(s.start!.url, origin)}>Otwórz przeglądarkę ponownie</button>
          </div>
        )
      )}

      {s.user && !s.needsLink && (
        <>
          <p className="mt-4 text-sm text-slate-200">Potwierdzono konto: <strong>{s.user.email}</strong></p>
          {s.needsMfa && <label className="mt-3 block text-sm text-slate-300">Kod z aplikacji uwierzytelniającej lub kod odzyskiwania<input value={s.mfaCode} onChange={e => s.setMfaCode(e.target.value)} autoComplete="one-time-code" className={input} /></label>}
          <button disabled={s.busy} onClick={() => void s.finish()} className={button}>
            {s.deviceFreed ? `Zaloguj jako ${s.user.email}` : `Kontynuuj jako ${s.user.email}`}
          </button>
        </>
      )}

      {s.needsLink && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-300">Jeśli używasz danych na tym komputerze, potwierdź PIN lub hasło aplikacji.</p>
          <input aria-label="PIN lub hasło aplikacji" value={s.desktopSecret} onChange={e => s.setDesktopSecret(e.target.value)} placeholder="PIN lub hasło aplikacji" type="password" autoComplete="off" className={input} />
          <button disabled={s.busy} onClick={() => void s.linkDesktop()} className={button}>Połącz z danymi tego komputera</button>
          <p className="text-sm text-slate-300">Lub połącz z istniejącym kontem lokalnym:</p>
          <input aria-label="E-mail konta lokalnego" value={s.email} onChange={e => s.setEmail(e.target.value)} placeholder="E-mail konta lokalnego" autoComplete="email" className={input} />
          <input aria-label="Hasło konta lokalnego" value={s.password} onChange={e => s.setPassword(e.target.value)} placeholder="Hasło konta lokalnego" type="password" autoComplete="current-password" className={input} />
          <button disabled={s.busy} onClick={() => void s.linkExisting()} className={button}>Połącz z kontem lokalnym</button>
          <p className="text-sm text-slate-300">Nowe konto potrzebuje osobnego hasła lokalnego do pracy offline.</p>
          <input aria-label="Nowe hasło lokalne" value={s.newLocalPassword} onChange={e => s.setNewLocalPassword(e.target.value)} placeholder="Nowe hasło lokalne (min. 8 znaków)" type="password" autoComplete="new-password" className={input} />
          <button disabled={s.busy} onClick={() => void s.createLocal()} className="w-full rounded-lg border border-slate-600 px-4 py-3 text-sm text-slate-200 disabled:opacity-50">Utwórz nowe konto na tym komputerze</button>
        </div>
      )}

      {s.info && <p role="status" className="mt-3 text-sm text-emerald-300">{s.info}</p>}
      {s.message && <p role="status" className="mt-3 text-sm text-red-300">{s.message}</p>}
      {s.deviceLimitReached && (
        <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-200">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <p className="font-semibold text-white">Zaufane sesje i urządzenia</p>
            {s.deviceLimits.desktop !== null && (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                Komputery: {s.trustedDevices.filter(d => d.kind === 'desktop').length}/{s.deviceLimits.desktop}
              </span>
            )}
          </div>
          {s.devicesLoading ? (
            <p className="py-3 text-center text-slate-400">Ładowanie listy urządzeń…</p>
          ) : s.devicesError ? (
            <p className="py-3 text-center text-red-300">{s.devicesError}</p>
          ) : s.trustedDevices.length === 0 ? (
            <p className="py-3 text-center text-slate-400">Brak aktywnych urządzeń na koncie.</p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
              {s.trustedDevices.map(device => {
                const isCurrent = device.deviceId === deviceId;
                const isMobile = device.kind === 'mobile';
                return (
                  <li key={device.deviceId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden="true" className="text-lg">{isMobile ? '📱' : '💻'}</span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-100">
                          {device.name || (isMobile ? 'Urządzenie mobilne' : 'Komputer')}
                          {isCurrent && <span className="ml-1.5 text-[10px] font-normal text-blue-300">(to urządzenie)</span>}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {isMobile ? 'Urządzenie mobilne' : 'Komputer / przeglądarka'}
                          {device.lastSeen > 0 ? ` · ${new Date(device.lastSeen).toLocaleDateString('pl-PL')}` : ''}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={s.revokingDeviceId === device.deviceId}
                      onClick={() => void s.revokeTrustedDevice(device.deviceId)}
                      className="shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {s.revokingDeviceId === device.deviceId ? 'Usuwanie…' : 'Usuń'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {hasSessionOverlay && (
        <button
          type="button"
          onClick={() => { closeExternalAccountPopup(); s.resetToLogin(); }}
          className="mt-3 w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          ← Wróć do logowania
        </button>
      )}
      {import.meta.env.DEV && (
        <a href="/developer" className="mt-3 block text-center text-xs text-amber-300 underline">
          Otwórz panel dewelopera (odświeżanie, plany, omijanie limitów)
        </a>
      )}
    </div>
  );
}
