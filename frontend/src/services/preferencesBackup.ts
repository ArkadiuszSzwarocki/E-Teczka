const SAFE_PREFERENCE_KEYS = [
  'eteczka_theme',
  'eteczka_bg_style',
  'eteczka_bg_style_v1',
  'eteczka_bg_color_v1',
  'eteczka_classic_icons',
  'eteczka_folders_view',
  'eteczka_trash_view',
  'eteczka_trash_order',
  'eteczka_auto_mail_sync',
  'eteczka_sensitive_masking',
  'eteczka_rodo_categories_v1',
  'eteczka_rodo_smart_v1',
  'eteczka_rodo_regions_v1',
  'eteczka_rodo_phrases_v1',
  'eteczka_notifications_dock_mode',
  'eteczka_side_notifications_top',
  'eteczka_mobile_onboarding',
] as const;

const SAFE_KEY_SET = new Set<string>(SAFE_PREFERENCE_KEYS);

/** Collects non-secret UI and workflow preferences from localStorage (never auth tokens or device IDs). */
export function collectClientPreferences(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SAFE_PREFERENCE_KEYS) {
    try {
      const val = localStorage.getItem(key);
      if (val !== null) result[key] = val;
    } catch { /* ignore storage errors */ }
  }
  return result;
}

/** Applies validated non-secret UI preferences from a settings backup back into localStorage. */
export function applyClientPreferences(prefs: unknown): number {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return 0;
  let restored = 0;
  for (const [key, val] of Object.entries(prefs as Record<string, unknown>)) {
    if (!SAFE_KEY_SET.has(key) || typeof val !== 'string') continue;
    try {
      localStorage.setItem(key, val);
      restored++;
    } catch { /* ignore storage errors */ }
  }
  return restored;
}
