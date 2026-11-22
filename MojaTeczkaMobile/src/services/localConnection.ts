import { profileKey, profileOperation } from './mobileProfile';
import * as SecureStore from "expo-secure-store";
import { clearPendingComputerCertificate, commitComputerCertificate, hasComputerCertificate, hasPendingComputerCertificate } from "./localTls";

const CONNECTION_KEY = "eteczka.local-connection.v1";

export type LocalConnection = {
  serverUrl: string;
  accessToken: string;
};

function isLocalConnection(value: unknown): value is LocalConnection {
  if (!value || typeof value !== "object") return false;
  const connection = value as Partial<LocalConnection>;
  return typeof connection.serverUrl === "string" && typeof connection.accessToken === "string" && connection.accessToken.length > 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Nie udało się połączyć z komputerem.";
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

export function normalizeServerUrl(value: string) {
  const candidate = value.trim().replace(/\/+$/, "");
  if (!candidate) throw new Error("Podaj adres komputera.");

  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  let parsed: URL;

  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Adres komputera ma nieprawidłowy format.");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) throw new Error("Adres komputera nie może zawierać ścieżki ani danych logowania.");
  const isLocalName = parsed.hostname === "localhost" || parsed.hostname.endsWith(".local");
  if (!isLocalName && !isPrivateIpv4(parsed.hostname)) {
    throw new Error("Można dodać tylko komputer w sieci lokalnej.");
  }

  return parsed.toString().replace(/\/$/, "");
}

async function getLocalConnectionImpl(): Promise<LocalConnection | null> {
  const value = await SecureStore.getItemAsync(profileKey(CONNECTION_KEY));
  if (!value) return null;

  try {
    const connection: unknown = JSON.parse(value);
    if (!isLocalConnection(connection)) return null;
    return { serverUrl: normalizeServerUrl(connection.serverUrl), accessToken: connection.accessToken };
  } catch {
    await SecureStore.deleteItemAsync(profileKey(CONNECTION_KEY));
    return null;
  }
}

async function saveLocalConnectionImpl(serverUrl: string): Promise<LocalConnection> {
  throw new Error("Komputer trzeba najpierw sparować kodem z aplikacji desktopowej.");
}

async function pairLocalComputerImpl(serverUrl: string, pairingCode: string, deviceName: string) {
  const normalizedUrl = normalizeServerUrl(serverUrl);
  if (!normalizedUrl.startsWith('https://')) throw new Error('Zeskanuj aktualny kod QR z okna parowania na komputerze.');
  if (!await hasPendingComputerCertificate(normalizedUrl)) throw new Error('Najpierw zeskanuj kod QR i zweryfikuj certyfikat komputera.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetch(`${normalizedUrl}/api/pair`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingCode: pairingCode.trim(), deviceName: deviceName.trim() || "Telefon" }),
    });
  } catch (error: unknown) {
    await clearPendingComputerCertificate().catch(() => undefined);
    if (error instanceof Error && error.name === "AbortError") throw new Error("Komputer nie odpowiedział w ciągu 8 sekund.");
    throw new Error(errorMessage(error));
  } finally { clearTimeout(timeout); }

  const payload: unknown = await response.json().catch(() => null);
  const pairResponse = payload && typeof payload === "object" ? payload as { accessToken?: unknown; error?: unknown } : {};
  const accessToken = pairResponse.accessToken;
  if (!response.ok || typeof accessToken !== "string" || !accessToken) {
    await clearPendingComputerCertificate().catch(() => undefined);
    throw new Error(typeof pairResponse.error === "string" ? pairResponse.error : "Nie udało się sparować telefonu.");
  }

  const connection: LocalConnection = { serverUrl: normalizedUrl, accessToken };
  await commitComputerCertificate();
  await SecureStore.setItemAsync(profileKey(CONNECTION_KEY), JSON.stringify(connection));
  return connection;
}

async function getAuthHeadersImpl() {
  const connection = await getLocalConnection();
  if (!connection) throw new Error("Najpierw sparuj telefon z komputerem E‑Teczka.");
  if (!connection.serverUrl.startsWith('https://')) throw new Error('Stare połączenie HTTP jest niezabezpieczone. Sparuj telefon ponownie przez HTTPS.');
  if (!await hasComputerCertificate(connection.serverUrl)) throw new Error('Sparuj komputer ponownie, aby sprawdzić jego certyfikat.');
  return { Authorization: `Bearer ${connection.accessToken}` };
}

async function getApiUrlImpl(path: string) {
  const connection = await getLocalConnection();
  if (!connection) throw new Error("Najpierw dodaj komputer E‑Teczka w zakładce Ustawienia.");
  if (!connection.serverUrl.startsWith('https://')) throw new Error('Stare połączenie HTTP jest niezabezpieczone. Sparuj telefon ponownie przez HTTPS.');
  if (!await hasComputerCertificate(connection.serverUrl)) throw new Error('Sparuj komputer ponownie, aby sprawdzić jego certyfikat.');
  return `${connection.serverUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export const getLocalConnection = profileOperation(getLocalConnectionImpl);
export const saveLocalConnection = profileOperation(saveLocalConnectionImpl);
export const pairLocalComputer = profileOperation(pairLocalComputerImpl);
export const getAuthHeaders = profileOperation(getAuthHeadersImpl);
export const getApiUrl = profileOperation(getApiUrlImpl);
