import { useState } from 'react';
import { getUseClassicIcons, setUseClassicIcons } from './FolderIconPicker';
import RodoCategoriesPanel from './RodoCategoriesPanel';
import AutomationConsentModal, { type AutomationConsentFeature } from './AutomationConsentModal';
import { APP_ZOOM_PRESETS, getAppZoom, setAppZoom } from '../services/appZoom';
import { getThemePreference, setThemePreference, type ThemePreference } from '../services/theme';
import {
  getBackgroundStyle,
  getCustomBgColor,
  setBackgroundStyle,
  setCustomBgColor,
  type BackgroundStyle,
} from '../services/backgroundStyle';
import {
  getAutoMailSyncEnabled,
  getAutoSuggestFolderEnabled,
  getSensitiveMaskingEnabled,
  setAutoMailSyncEnabled,
  setAutoSuggestFolderEnabled,
  setSensitiveMaskingEnabled,
} from '../services/sensitiveMasking';

type Props = {
  onClose: () => void;
  onOpenSecurity: () => void;
  onOpenBackup: () => void;
  onOpenTags: () => void;
  onOpenPairing: () => void;
};

function OptionSwitch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-700/80 bg-[#0f172a]/60 px-4 py-3.5 transition-colors hover:border-slate-500">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="mt-0.5 text-xs text-slate-400">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-600'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </label>
  );
}

/** Dedicated full-page application options view: icons, theme, background, zoom, privacy masking, and OCR toggles. */
export default function AppOptionsPage({ onClose, onOpenSecurity, onOpenBackup, onOpenTags, onOpenPairing }: Props) {
  const [classicIcons, setClassicIconsState] = useState(getUseClassicIcons);
  const [theme, setThemeState] = useState<ThemePreference>(getThemePreference);
  const [bgStyle, setBgStyleState] = useState<BackgroundStyle>(getBackgroundStyle);
  const [customBgColor, setCustomBgColorState] = useState<string>(getCustomBgColor);
  const [zoom, setZoomState] = useState(getAppZoom);
  const [masking, setMaskingState] = useState(getSensitiveMaskingEnabled);
  const [autoSuggest, setAutoSuggestState] = useState(getAutoSuggestFolderEnabled);
  const [autoMailSync, setAutoMailSyncState] = useState(getAutoMailSyncEnabled);
  const [pendingConsent, setPendingConsent] = useState<AutomationConsentFeature | null>(null);

  const toggleClassicIcons = (val: boolean) => { setClassicIconsState(val); setUseClassicIcons(val); };
  const changeTheme = (next: ThemePreference) => { setThemeState(next); setThemePreference(next); };
  const changeBg = (next: BackgroundStyle) => { setBgStyleState(next); setBackgroundStyle(next); };
  const changeCustomBg = (color: string) => { setCustomBgColorState(color); setCustomBgColor(color); };
  const changeZoom = (next: number) => setZoomState(setAppZoom(next));
  const toggleMasking = (val: boolean) => { setMaskingState(val); setSensitiveMaskingEnabled(val); };
  const toggleAutoSuggest = (val: boolean) => {
    if (val) { setPendingConsent('autoSuggest'); return; }
    setAutoSuggestState(false); setAutoSuggestFolderEnabled(false);
  };
  const toggleAutoMailSync = (val: boolean) => {
    if (val) { setPendingConsent('autoMailSync'); return; }
    setAutoMailSyncState(false); setAutoMailSyncEnabled(false);
  };
  const confirmAutomationConsent = () => {
    if (pendingConsent === 'autoSuggest') { setAutoSuggestState(true); setAutoSuggestFolderEnabled(true); }
    else if (pendingConsent === 'autoMailSync') { setAutoMailSyncState(true); setAutoMailSyncEnabled(true); }
    setPendingConsent(null);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Opcje aplikacji</h2>
          <p className="text-sm text-slate-400">Włączaj i wyłączaj funkcje prywatności, wygląd, ikony, tło oraz zachowanie skanera.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-600 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
          ← Powrót do kartotek
        </button>
      </div>

      {/* Section 1: Privacy & Sensitive Data Masking */}
      <section className="cyber-card space-y-3 rounded-xl border border-slate-700 bg-[#1e293b] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-300">Prywatność i maskowanie danych</h3>
            <p className="mt-0.5 text-xs text-slate-400">Dostępne dla każdego planu (Darmowy, Standard, Premium).</p>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${masking ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
            {masking ? 'WŁĄCZONE' : 'WYŁĄCZONE'}
          </span>
        </div>
        <OptionSwitch
          checked={masking}
          onChange={toggleMasking}
          label="Maskuj wrażliwe dane na dokumentach"
          description="Zasłania podgląd dokumentów oraz zamienia wykryte dane RODO na etykiety [RODO: ...]. Odsłonięcie wymaga kodu PIN, hasła lub Authenticatora."
        />
        {masking && <RodoCategoriesPanel />}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={onOpenSecurity} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
            🔐 Skonfiguruj PIN / hasło lokalne
          </button>
        </div>
      </section>

      {/* Section 2: Icons, Theme, Background & Scale */}
      <section className="cyber-card space-y-4 rounded-xl border border-slate-700 bg-[#1e293b] p-5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-300">Wygląd, ikony i tło</h3>

        <OptionSwitch
          checked={!classicIcons}
          onChange={cyber => toggleClassicIcons(!cyber)}
          label="Nowoczesne ikony 3D (zamiast klasycznych emoji)"
          description="Wyłącz, aby przełączyć całą aplikację na lekkie klasyczne ikony systemowe."
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-700/80 bg-[#0f172a]/60 p-4">
            <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-400">Motyw kolorystyczny</p>
            <div className="flex flex-wrap gap-2">
              {([['dark', '🌙 Ciemny'], ['light', '☀️ Jasny'], ['system', '🖥️ Systemowy']] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => changeTheme(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${theme === id ? 'bg-blue-600 text-white' : 'border border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-[#0f172a]/60 p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Tło aplikacji</p>
            <div className="flex flex-wrap gap-2">
              {([['solid', 'Czyste (gładkie)'], ['aurora', 'Poświata'], ['contrast', 'Wysoki kontrast'], ['grid', 'Siatka']] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => changeBg(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${bgStyle === id ? 'bg-cyan-600 text-white' : 'border border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-700/60 pt-2.5">
              <span className="text-xs text-slate-300">Własny kolor tła:</span>
              <input
                type="color"
                value={customBgColor || '#0f172a'}
                onChange={e => changeCustomBg(e.target.value)}
                aria-label="Wybierz własny kolor tła"
                className="h-7 w-10 cursor-pointer rounded border border-slate-600 bg-transparent p-0.5"
              />
              {(['#05080e', '#0f172a', '#18181b', '#f8fafc', '#eef2f6', '#fefce8', '#f0fdf4'] as const).map(swatch => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => changeCustomBg(swatch)}
                  title={`Ustaw kolor ${swatch}`}
                  style={{ backgroundColor: swatch }}
                  className={`h-6 w-6 rounded-full border transition ${customBgColor.toLowerCase() === swatch ? 'scale-110 border-cyan-400 ring-2 ring-cyan-400/60' : 'border-slate-500 hover:scale-105'}`}
                />
              ))}
              {customBgColor && (
                <button
                  type="button"
                  onClick={() => changeCustomBg('')}
                  className="rounded-lg border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                >
                  ↺ Domyślny
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-[#0f172a]/60 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-white">🔍 Skala interfejsu</p>
            <p className="text-xs text-slate-400">Powiększenie przycisków, kartotek i tekstów ({zoom}%).</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => changeZoom(zoom - 5)} className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700">−</button>
            {APP_ZOOM_PRESETS.map(p => (
              <button key={p} type="button" onClick={() => changeZoom(p)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${zoom === p ? 'bg-blue-600 text-white' : 'border border-slate-600 text-slate-300 hover:bg-slate-700'}`}>{p}%</button>
            ))}
            <button type="button" onClick={() => changeZoom(zoom + 5)} className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700">+</button>
          </div>
        </div>
      </section>

      {/* Section 3: Scanner, OCR & AI Privacy */}
      <section className="cyber-card space-y-3 rounded-xl border border-slate-700 bg-[#1e293b] p-5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-cyan-300">Skanowanie, OCR i automatyzacja</h3>
        <OptionSwitch
          checked={autoSuggest}
          onChange={toggleAutoSuggest}
          label="Automatyczna sugestia kartoteki po skanie (offline)"
          description="Analizuje typ dokumentu i zapamiętane korekty lokalnie na urządzeniu bez wysyłania danych w sieć."
        />
        <OptionSwitch
          checked={autoMailSync}
          onChange={toggleAutoMailSync}
          label="Automatycznie skanuj pocztę przy wejściu do E‑Teczki"
          description="Po otwarciu aplikacji automatycznie sprawdza skonfigurowaną skrzynkę IMAP i pyta, czy przydzielić znalezione załączniki do kartotek."
        />
      </section>

      {/* Section 4: Quick links to remaining configuration */}
      <section className="cyber-card flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-[#1e293b] p-4">
        <span className="mr-2 text-xs font-bold uppercase tracking-wider text-slate-400">Pozostałe moduły:</span>
        <button type="button" onClick={onOpenTags} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">🏷️ Tagi dokumentów</button>
        <button type="button" onClick={onOpenBackup} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">☁️ Kopia zapasowa</button>
        <button type="button" onClick={onOpenPairing} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">📱 Telefon i urządzenia</button>
      </section>

      {pendingConsent && (
        <AutomationConsentModal
          feature={pendingConsent}
          onConfirm={confirmAutomationConsent}
          onCancel={() => setPendingConsent(null)}
        />
      )}
    </div>
  );
}
