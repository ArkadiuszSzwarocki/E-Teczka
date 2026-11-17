import { getElectronIpc, isAccessResult } from './electron';

export type VaultLoginMethod = 'pin_totp' | 'password_totp' | 'biometric_totp';

export type VaultStatus = {
  configured: boolean;
  loginMethod: VaultLoginMethod | null;
  biometricEnabled: boolean;
  recoveryEmailConfigured: boolean;
};

/** Ensures the Safe Password and PIN do not match the main E-Teczka app access lock. */
export async function ensureDifferentFromAppAccess(password: string, pin: string): Promise<string | null> {
  const ipc = getElectronIpc();
  if (!ipc) return null;
  try {
    const pRes = await ipc.invoke('eteczka-access-verify', password);
    if (isAccessResult(pRes) && pRes.ok) {
      return 'Hasło do sejfu nie może być takie samo jak hasło lub PIN logowania do aplikacji.';
    }
    const pinRes = await ipc.invoke('eteczka-access-verify', pin);
    if (isAccessResult(pinRes) && pinRes.ok) {
      return 'Kod PIN do sejfu nie może być taki sam jak PIN lub hasło logowania do aplikacji.';
    }
  } catch { /* ignore if access lock unconfigured */ }
  return null;
}

export async function getVaultStatus(apiUrl: string, fetcher: typeof fetch, folderId: number): Promise<VaultStatus> {
  const res = await fetcher(`${apiUrl}/api/folder-vault/${folderId}/status`);
  if (!res.ok) throw new Error('Nie udało się sprawdzić statusu sejfu.');
  return res.json();
}

export async function startVaultSetup(apiUrl: string, fetcher: typeof fetch, folderId: number): Promise<{ uri: string; secret: string }> {
  const res = await fetcher(`${apiUrl}/api/folder-vault/${folderId}/setup/start`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Nie udało się rozpocząć konfiguracji sejfu.');
  return data;
}

export async function confirmVaultSetup(
  apiUrl: string,
  fetcher: typeof fetch,
  folderId: number,
  body: { password: string; pin: string; totpCode: string; loginMethod: VaultLoginMethod; biometricEnabled: boolean; recoveryEmail: string },
): Promise<VaultStatus> {
  const res = await fetcher(`${apiUrl}/api/folder-vault/${folderId}/setup/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Nie udało się zapisać sejfu.');
  return data;
}

export async function unlockVault(
  apiUrl: string,
  fetcher: typeof fetch,
  folderId: number,
  body: { secret?: string; biometricVerified?: boolean; totpCode: string },
): Promise<void> {
  const res = await fetcher(`${apiUrl}/api/folder-vault/${folderId}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Nie udało się otworzyć sejfu.');
}

export async function requestVaultRecovery(apiUrl: string, fetcher: typeof fetch, folderId: number, totpCode: string): Promise<{ sentTo: string }> {
  const res = await fetcher(`${apiUrl}/api/folder-vault/${folderId}/recovery/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totpCode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Nie udało się wysłać kodu na e-mail.');
  return data;
}

export async function completeVaultRecovery(
  apiUrl: string,
  fetcher: typeof fetch,
  folderId: number,
  body: { emailCode: string; totpCode: string; newPassword: string; newPin: string },
): Promise<void> {
  const res = await fetcher(`${apiUrl}/api/folder-vault/${folderId}/recovery/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Nie udało się ustawić nowego hasła i PIN-u.');
}
