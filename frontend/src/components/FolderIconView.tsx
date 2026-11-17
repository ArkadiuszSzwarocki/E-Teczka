import eteczkaFolderIcon from '../assets/eteczka-folder.png';
import { useClassicIcons } from '../hooks/useIconStyle';
import { PRESET_ICON_MAP, VAULT_ICON_ID } from '../utils/folderIconCatalog';

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md' | 'lg', { img: string; emoji: string }> = {
  xs: { img: 'inline-block h-3.5 w-3.5 object-contain align-middle', emoji: 'inline-block text-[11px]' },
  sm: { img: 'inline-block h-5 w-5 object-contain align-middle', emoji: 'inline-block text-sm' },
  md: { img: 'inline-block h-8 w-8 object-contain align-middle', emoji: 'inline-block text-2xl' },
  lg: { img: 'h-14 w-14 object-contain', emoji: 'text-5xl' },
};

/** Renders the default E-Teczka folder icon (or classic emoji when enabled). */
export function AppFolderIcon({ size = 'sm' }: { size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const classic = useClassicIcons();
  const cls = SIZE_CLASSES[size];
  if (classic) return <span className={cls.emoji}>📁</span>;
  return <img src={eteczkaFolderIcon} alt="" draggable={false} className={cls.img} />;
}

/** Renders a folder icon by preset id, custom data URL, or emoji. */
export function FolderIconView({ icon, size = 'lg' }: { icon: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const classic = useClassicIcons();
  if (!icon || icon === '📁') {
    const cls = SIZE_CLASSES[size];
    if (classic) return <span className={cls.emoji}>📁</span>;
    return <img src={eteczkaFolderIcon} alt="" draggable={false} className={`${cls.img} cyber-icon-glow`} />;
  }
  const presetSrc = PRESET_ICON_MAP.get(icon);
  if (presetSrc) {
    if (classic) return <span className={SIZE_CLASSES[size].emoji}>{icon === VAULT_ICON_ID ? '🔐' : '📁'}</span>;
    const glow = icon === VAULT_ICON_ID ? 'cyber-icon-vault' : 'cyber-icon-glow';
    return <img src={presetSrc} alt="" draggable={false} className={`${SIZE_CLASSES[size].img} ${glow}`} />;
  }
  if (icon.startsWith('data:image/')) {
    return <img src={icon} alt="" draggable={false} className={size === 'sm' ? 'inline-block h-4 w-4 rounded object-contain' : 'h-12 w-12 rounded-lg object-contain'} />;
  }
  return <span className={SIZE_CLASSES[size].emoji}>{icon}</span>;
}
