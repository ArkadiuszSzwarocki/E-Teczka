import crypto from 'node:crypto';
import type http from 'node:http';
import type https from 'node:https';
import type { PrismaClient } from '@prisma/client';
import { Server as SocketIOServer } from 'socket.io';
import { activeSessionWhere } from './sessionPolicy';

export type RealtimeEventName =
  | 'ocr:done'
  | 'document:created'
  | 'backup:done'
  | 'plan:updated'
  | 'db_update';

export type RealtimePayload = {
  documentId?: number;
  folderId?: number;
  plan?: string;
  provider?: string;
  title?: string;
  at: string;
};

let ioServer: SocketIOServer | null = null;

function isLoopbackAddress(address?: string): boolean {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** Attaches a single authenticated Socket.IO server to HTTP and HTTPS servers. */
export function attachRealtimeServer(
  servers: Array<http.Server | https.Server>,
  prisma: PrismaClient,
  isAllowedOrigin: (origin?: string) => boolean,
  resolvePairedDeviceOwner?: (token: string) => number | null,
): SocketIOServer {
  if (ioServer) return ioServer;

  const io = new SocketIOServer({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const authToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token.trim() : '';
      const headerAuth = typeof socket.handshake.headers.authorization === 'string'
        ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '').trim()
        : '';
      const token = authToken || headerAuth;

      if (token) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const session = await prisma.authSession.findFirst({
          where: { tokenHash, ...activeSessionWhere() },
          select: { userId: true },
        });
        if (session) {
          socket.data.userId = session.userId;
          return next();
        }
        const pairedOwner = resolvePairedDeviceOwner?.(token);
        if (pairedOwner) {
          socket.data.userId = pairedOwner;
          return next();
        }
      }

      if (isLoopbackAddress(socket.handshake.address)) {
        socket.data.userId = 1;
        return next();
      }

      return next(new Error('UNAUTHORIZED'));
    } catch {
      return next(new Error('AUTH_ERROR'));
    }
  });

  io.on('connection', socket => {
    const userId = Number(socket.data.userId || 1);
    void socket.join(`user:${userId}`);
  });

  for (const server of servers) {
    io.attach(server);
  }

  ioServer = io;
  return io;
}

/** Emits a typed realtime event to a specific user's room (or broadcasts to user:1 when omitted). */
export function emitRealtimeEvent(
  event: RealtimeEventName,
  payload: Omit<RealtimePayload, 'at'> = {},
  ownerId?: number | null,
): void {
  if (!ioServer) return;
  const fullPayload: RealtimePayload = { ...payload, at: new Date().toISOString() };
  const target = ownerId && Number.isInteger(ownerId) && ownerId > 0
    ? ioServer.to(`user:${ownerId}`)
    : ioServer.to('user:1');
  target.emit(event, fullPayload);
  if (event !== 'db_update') {
    target.emit('db_update', { event, ...fullPayload });
  }
}

export function closeRealtimeServer(): void {
  if (!ioServer) return;
  try {
    void ioServer.close();
  } catch { /* ignore shutdown errors */ }
  ioServer = null;
}
