import { useState } from 'react';
import { customIconLimit, DEFAULT_FOLDER_ICONS, fileToIconDataUrl, loadCustomIcons, saveCustomIcons, type CustomFolderIcon } from '../services/customIcons';
import { PRESET_FOLDER_ICONS, suggestFolderIcon, VAULT_ICON_ID } from '../utils/folderIconCatalog';
import { getUseClassicIcons, setUseClassicIcons, useClassicIcons } from '../hooks/useIconStyle';
import { AppFolderIcon, FolderIconView } from './FolderIconView';

export { VAULT_ICON_ID, PRESET_FOLDER_ICONS, suggestFolderIcon, getUseClassicIcons, setUseClassicIcons, useClassicIcons, AppFolderIcon, FolderIconView };

/** Dropdown picker allowing selection of default, preset, or custom folder icons. */
export default function FolderIconPicker({ plan, onSelect }: { plan: 'free' | 'standard' | 'premium' | 'family' | 'business'; onSelect: (icon: string) => void }) {
  const [customIcons, setCustomIcons] = useState<CustomFolderIcon[]>(loadCustomIcons);
  const [error, setError] = useState('');
  const limit = customIconLimit(plan);
  const atLimit = limit !== null && customIcons.length >= limit;

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (atLimit) {
      setError(`Limit własnych ikon dla planu (${limit}) został osiągnięty.`);
      return;
    }
    try {
      const dataUrl = await fileToIconDataUrl(file);
      const next = [...customIcons, { id: `ci_${Date.now()}`, dataUrl }];
      setCustomIcons(next);
      saveCustomIcons(next);
      onSelect(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się dodać ikony.');
    }
  };

  const removeCustom = (id: string) => {
    const next = customIcons.filter(item => item.id !== id);
    setCustomIcons(next);
    saveCustomIcons(next);
    setError('');
  };

  return (
    <div className="border-y border-slate-700 bg-slate-950 p-2" onClick={e => e.stopPropagation()}>
      <div className="grid grid-cols-4 gap-1">
        {DEFAULT_FOLDER_ICONS.map(ic => (
          <button key={ic} type="button" onClick={() => onSelect(ic)} className="flex items-center justify-center rounded p-1 text-lg hover:bg-slate-800">
            {ic === '📁' ? <FolderIconView icon={ic} size="sm" /> : ic}
          </button>
        ))}
      </div>
      <div className="mt-2 grid max-h-48 grid-cols-4 gap-1 overflow-y-auto border-t border-slate-800 pt-2">
        {PRESET_FOLDER_ICONS.map(item => (
          <button key={item.id} type="button" title={item.label} onClick={() => onSelect(item.id)} className="flex items-center justify-center rounded p-1 hover:bg-slate-800">
            <img src={item.src} alt={item.label} className="h-7 w-7 object-contain" />
          </button>
        ))}
      </div>
      {customIcons.length > 0 && (
        <div className="mt-2 grid max-h-48 grid-cols-4 gap-1 overflow-y-auto border-t border-slate-800 pt-2">
          {customIcons.map(item => (
            <div key={item.id} className="group relative flex items-center justify-center rounded hover:bg-slate-800">
              <button type="button" onClick={() => onSelect(item.dataUrl)} className="p-1">
                <img src={item.dataUrl} alt="" className="h-6 w-6 rounded object-contain" />
              </button>
              <button type="button" aria-label="Usuń ikonę" onClick={() => removeCustom(item.id)} className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white group-hover:flex">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 border-t border-slate-800 pt-2">
        <p className="mb-1 text-[10px] text-slate-400">
          Własne ikony: <strong className="text-slate-200">{customIcons.length}</strong> / {limit === null ? 'bez limitu' : limit}
        </p>
        <label className={`block rounded px-2 py-1 text-center text-[11px] font-semibold ${atLimit ? 'cursor-not-allowed bg-slate-800 text-slate-500' : 'cursor-pointer bg-blue-600 text-white hover:bg-blue-500'}`}>
          + Dodaj własną
          <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" disabled={atLimit} onChange={e => { void handleUpload(e.target.files?.[0]); e.target.value = ''; }} className="hidden" />
        </label>
        {atLimit && <p className="mt-1 text-[10px] text-amber-300">Limit planu osiągnięty ({limit}/{limit}).</p>}
        {error && <p className="mt-1 text-[10px] text-red-300">{error}</p>}
      </div>
    </div>
  );
}
