import { useEffect, useState } from 'react';
import type { FolderRecord } from '../types/domain';
import { getVaultStatus, type VaultLoginMethod } from '../services/folderVaultApi';
import { VAULT_ICON_ID } from '../utils/folderIconCatalog';

const ICONS_KEY = 'eteczka_folder_icons_v1';

function loadIcons(): Record<number, string> {
  try { return JSON.parse(localStorage.getItem(ICONS_KEY) || '{}') as Record<number, string>; } catch { return {}; }
}

type Args = {
  apiUrl: string;
  fetcher: typeof fetch;
  folders: FolderRecord[];
  currentFolderId: number | null;
  onMenusClose: () => void;
};

/** Manages folder icon persistence and Safe Vault setup/unlock gating. */
export function useFolderVaultGuard({ apiUrl, fetcher, folders, currentFolderId, onMenusClose }: Args) {
  const [icons, setIcons] = useState<Record<number, string>>(loadIcons);
  const [unlockedVaultIds, setUnlockedVaultIds] = useState<number[]>([]);
  const [vaultSetupTarget, setVaultSetupTarget] = useState<{ id: number; name: string } | null>(null);
  const [vaultUnlockTarget, setVaultUnlockTarget] = useState<{ id: number; name: string; loginMethod: VaultLoginMethod; afterUnlock: () => void } | null>(null);

  useEffect(() => {
    setUnlockedVaultIds(prev => (prev.length === 0 ? prev : prev.filter(id => id === currentFolderId)));
  }, [currentFolderId]);

  const applyFolderIcon = (id: number, icon: string) => {
    const next = { ...icons, [id]: icon };
    setIcons(next);
    localStorage.setItem(ICONS_KEY, JSON.stringify(next));
    onMenusClose();
  };

  const setFolderIcon = async (id: number, icon: string, folderName?: string) => {
    if (icon === VAULT_ICON_ID) {
      onMenusClose();
      const name = folderName || folders.find(f => f.id === id)?.name || 'Sejf';
      try {
        const st = await getVaultStatus(apiUrl, fetcher, id);
        if (st.configured) { applyFolderIcon(id, icon); return; }
      } catch { /* fall through to setup modal */ }
      setVaultSetupTarget({ id, name });
      return;
    }
    applyFolderIcon(id, icon);
  };

  const openFolderGuarded = async (folderId: number, action: () => void) => {
    if (icons[folderId] !== VAULT_ICON_ID || unlockedVaultIds.includes(folderId)) {
      action();
      return;
    }
    const name = folders.find(f => f.id === folderId)?.name || 'Sejf';
    try {
      const st = await getVaultStatus(apiUrl, fetcher, folderId);
      if (st.configured && st.loginMethod) {
        setVaultUnlockTarget({ id: folderId, name, loginMethod: st.loginMethod, afterUnlock: action });
        return;
      }
    } catch { /* fall through to setup */ }
    setVaultSetupTarget({ id: folderId, name });
  };

  const markVaultConfigured = (targetId: number) => {
    applyFolderIcon(targetId, VAULT_ICON_ID);
    setVaultSetupTarget(null);
  };

  const markVaultUnlocked = () => {
    if (!vaultUnlockTarget) return;
    const target = vaultUnlockTarget;
    setUnlockedVaultIds(prev => (prev.includes(target.id) ? prev : [...prev, target.id]));
    setVaultUnlockTarget(null);
    target.afterUnlock();
  };

  return {
    icons,
    vaultSetupTarget,
    setVaultSetupTarget,
    vaultUnlockTarget,
    setVaultUnlockTarget,
    setFolderIcon,
    openFolderGuarded,
    markVaultConfigured,
    markVaultUnlocked,
  };
}
