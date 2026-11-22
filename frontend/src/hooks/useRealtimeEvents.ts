import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

export type RealtimeEventPayload = {
  documentId?: number;
  folderId?: number;
  plan?: string;
  provider?: string;
  title?: string;
  at?: string;
};

type Args = {
  apiUrl: string;
  enabled: boolean;
  onRefresh: () => Promise<void> | void;
  onToast?: (message: string, type?: string) => void;
};

/** Subscribes to backend Socket.IO events (OCR, mobile scans, backups, plan updates) with debounced refresh. */
export function useRealtimeEvents({ apiUrl, enabled, onRefresh, onToast }: Args): void {
  const onRefreshRef = useRef(onRefresh);
  const onToastRef = useRef(onToast);
  onRefreshRef.current = onRefresh;
  onToastRef.current = onToast;

  useEffect(() => {
    if (!enabled || !apiUrl) return;
    let socket: Socket | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void onRefreshRef.current();
      }, 300);
    };

    const token = localStorage.getItem('mojateczka_auth_token') || '';
    socket = io(apiUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: token ? { token } : undefined,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
    });

    socket.on('ocr:done', () => scheduleRefresh());
    socket.on('document:created', (payload: RealtimeEventPayload) => {
      scheduleRefresh();
      if (payload?.title) onToastRef.current?.(`Dodano dokument: ${payload.title}`, 'success');
    });
    socket.on('backup:done', () => {
      scheduleRefresh();
      onToastRef.current?.('Kopia zapasowa została zakończona.', 'success');
    });
    socket.on('plan:updated', () => scheduleRefresh());

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      socket?.disconnect();
    };
  }, [apiUrl, enabled]);
}
