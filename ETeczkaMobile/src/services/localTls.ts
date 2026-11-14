import { NativeModules, Platform } from 'react-native';

type LocalTlsModule = { setPending(host: string, pem: string): Promise<void>; commit(): Promise<void>; clearPending(): Promise<void>; isActive(host: string): Promise<boolean>; isPending(host: string): Promise<boolean> };
function native(): LocalTlsModule {
  const module = NativeModules.LocalTls as LocalTlsModule | undefined;
  if (Platform.OS !== 'android' || !module) throw new Error('Ta wersja aplikacji nie obsługuje bezpiecznego parowania. Zainstaluj nową wersję E‑Teczki.');
  return module;
}
export const setPendingComputerCertificate = (url: string, pem: string) => native().setPending(new URL(url).hostname, pem);
export const commitComputerCertificate = () => native().commit();
export const clearPendingComputerCertificate = () => native().clearPending();
export const hasComputerCertificate = (url: string) => native().isActive(new URL(url).hostname);

export const hasPendingComputerCertificate = (url: string) => native().isPending(new URL(url).hostname);
