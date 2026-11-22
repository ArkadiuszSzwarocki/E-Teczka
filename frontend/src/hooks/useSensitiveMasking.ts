import { useEffect, useState } from 'react';
import {
  getRodoCategories,
  getRodoSmartDetectionEnabled,
  type RodoCategory,
} from '../services/rodoProtection';
import {
  getAllowServerAiEnabled,
  getAutoMailSyncEnabled,
  getAutoSuggestFolderEnabled,
  getSensitiveMaskingEnabled,
  MASKING_CHANGED_EVENT,
} from '../services/sensitiveMasking';

/** Subscribes to privacy masking and OCR option toggles across the application. */
export function useSensitiveMasking() {
  const [maskingEnabled, setMaskingEnabled] = useState(getSensitiveMaskingEnabled);
  const [autoSuggestEnabled, setAutoSuggestEnabled] = useState(getAutoSuggestFolderEnabled);
  const [allowServerAi, setAllowServerAi] = useState(getAllowServerAiEnabled);
  const [autoMailSync, setAutoMailSync] = useState(getAutoMailSyncEnabled);
  const [rodoCategories, setRodoCategories] = useState<RodoCategory[]>(getRodoCategories);
  const [smartRodoEnabled, setSmartRodoEnabled] = useState(getRodoSmartDetectionEnabled);

  useEffect(() => {
    const sync = () => {
      setMaskingEnabled(getSensitiveMaskingEnabled());
      setAutoSuggestEnabled(getAutoSuggestFolderEnabled());
      setAllowServerAi(getAllowServerAiEnabled());
      setAutoMailSync(getAutoMailSyncEnabled());
      setRodoCategories(getRodoCategories());
      setSmartRodoEnabled(getRodoSmartDetectionEnabled());
    };
    window.addEventListener(MASKING_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(MASKING_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return { maskingEnabled, autoSuggestEnabled, allowServerAi, autoMailSync, rodoCategories, smartRodoEnabled };
}
