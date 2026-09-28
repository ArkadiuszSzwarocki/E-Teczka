import * as SecureStore from "expo-secure-store";

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

function normalizeServerUrl(value: string) {
  const candidate = value.trim().replace(/\/+$/, "");
  if (!candidate) throw new Error("Podaj adres komputera.");

  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  let parsed: URL;

  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Adres komputera ma nieprawidłowy format.");
  }

  const isLocalName = parsed.hostname === "localhost" || parsed.hostname.endsWith(".local");
  if (!isLocalName && !isPrivateIpv4(parsed.hostname)) {
    throw new Error("Można dodać tylko komputer w sieci lokalnej.");
  }

  return parsed.toString().replace(/\/$/, "");
}

export async function getLocalConnection(): Promise<LocalConnection | null> {
  const value = await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!value) return null;

  try {
    const connection: unknown = JSON.parse(value);
    if (!isLocalConnection(connection)) return null;
    return { serverUrl: normalizeServerUrl(connection.serverUrl), accessToken: connection.accessToken };
  } catch {
    await SecureStore.deleteItemAsync(CONNECTION_KEY);
    return null;
  }
}

export async function saveLocalConnection(serverUrl: string): Promise<LocalConnection> {
  throw new Error("Komputer trzeba najpierw sparować kodem z aplikacji desktopowej.");
}

export async function pairLocalComputer(serverUrl: string, pairingCode: string, deviceName: string) {
  const normalizedUrl = normalizeServerUrl(serverUrl);
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
    if (error instanceof Error && error.name === "AbortError") throw new Error("Komputer nie odpowiedział w ciągu 8 sekund.");
    throw new Error(errorMessage(error));
  } finally { clearTimeout(timeout); }

  const payload: unknown = await response.json().catch(() => null);
  const pairResponse = payload && typeof payload === "object" ? payload as { accessToken?: unknown; error?: unknown } : {};
  const accessToken = pairResponse.accessToken;
  if (!response.ok || typeof accessToken !== "string" || !accessToken) {
    throw new Error(typeof pairResponse.error === "string" ? pairResponse.error : "Nie udało się sparować telefonu.");
  }

  const connection: LocalConnection = { serverUrl: normalizedUrl, accessToken };
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection));
  return connection;
}

export async function getAuthHeaders() {
  const connection = await getLocalConnection();
  if (!connection) throw new Error("Najpierw sparuj telefon z komputerem E‑Teczka.");
  return { Authorization: `Bearer ${connection.accessToken}` };
}

export async function getApiUrl(path: string) {
  const connection = await getLocalConnection();
  if (!connection) throw new Error("Najpierw dodaj komputer E‑Teczka w zakładce Ustawienia.");
  return `${connection.serverUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
