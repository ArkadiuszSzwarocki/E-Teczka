import { io, type Socket } from 'socket.io-client';
import { getLocalConnection } from './localConnection';

export type MobileRealtimeEvent = 'ocr:done' | 'document:created' | 'backup:done' | 'plan:updated' | 'db_update';

type EventListener = (event: MobileRealtimeEvent, payload: Record<string, unknown>) => void;
type ConnectionListener = (connected: boolean) => void;

let socket: Socket | null = null;
let connectedUrl = '';
let isConnected = false;
const eventListeners = new Set<EventListener>();
const connectionListeners = new Set<ConnectionListener>();

function notifyConnection(next: boolean) {
  if (isConnected === next) return;
  isConnected = next;
  for (const listener of connectionListeners) listener(next);
}

function notifyEvent(event: MobileRealtimeEvent, payload: Record<string, unknown>) {
  for (const listener of eventListeners) listener(event, payload);
}

/** Connects the shared Socket.IO client to the paired MojaTeczka desktop server. */
export async function connectMobileRealtime(): Promise<boolean> {
  const connection = await getLocalConnection().catch(() => null);
  if (!connection) {
    disconnectMobileRealtime();
    return false;
  }
  if (socket && connectedUrl === connection.serverUrl && socket.connected) {
    return true;
  }
  if (socket && connectedUrl !== connection.serverUrl) {
    disconnectMobileRealtime();
  }
  if (!socket) {
    connectedUrl = connection.serverUrl;
    socket = io(connection.serverUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token: connection.accessToken },
      reconnectionDelay: 3000,
      reconnectionDelayMax: 30000,
    });
    socket.on('connect', () => notifyConnection(true));
    socket.on('disconnect', () => notifyConnection(false));
    socket.on('connect_error', () => notifyConnection(false));
    const events: MobileRealtimeEvent[] = ['ocr:done', 'document:created', 'backup:done', 'plan:updated', 'db_update'];
    for (const ev of events) {
      socket.on(ev, (payload: Record<string, unknown> = {}) => notifyEvent(ev, payload));
    }
  } else if (!socket.connected) {
    socket.connect();
  }
  return socket.connected;
}

export function disconnectMobileRealtime(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  connectedUrl = '';
  notifyConnection(false);
}

export function subscribeMobileRealtime(listener: EventListener): () => void {
  eventListeners.add(listener);
  return () => { eventListeners.delete(listener); };
}

export function subscribeMobileConnection(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  listener(isConnected);
  return () => { connectionListeners.delete(listener); };
}
