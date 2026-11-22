const SAFE_PREFERENCE_KEYS = [
  'mojateczka_theme',
  'mojateczka_bg_style',
  'mojateczka_bg_style_v1',
  'mojateczka_bg_color_v1',
  'mojateczka_classic_icons',
  'mojateczka_folders_view',
  'mojateczka_trash_view',
  'mojateczka_trash_order',
  'mojateczka_auto_mail_sync',
  'mojateczka_sensitive_masking',
  'mojateczka_rodo_categories_v1',
  'mojateczka_rodo_smart_v1',
  'mojateczka_rodo_regions_v1',
  'mojateczka_rodo_phrases_v1',
  'mojateczka_notifications_dock_mode',
  'mojateczka_side_notifications_top',
  'mojateczka_mobile_onboarding',
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
