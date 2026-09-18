import type { Server as HttpServer } from 'node:http';
import { RealtimeEvent } from '@bday/shared';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { verifyAccessToken } from '../lib/jwt';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { isMember } from '../services/chat.service';
import { assertCanViewWishlist } from '../services/wishlist.service';
import { rooms, setRealtimeServer } from './emitter';

/**
 * Socket.IO server (spec §43).
 *
 * Clients authenticate with the same access token as the REST API and are
 * joined to their personal room automatically. Every other room must be
 * requested with `subscribe`, and each request is authorised against the
 * database — a room name is never trusted just because a client knows it.
 *
 * The wishlist owner is deliberately refused from their own wishlist room:
 * reservation changes are broadcast there, and spec §58 rule 2 says the owner
 * must not learn about them.
 */

interface SocketData {
  userId: string;
  role: string;
}

const subscribeSchema = z.object({
  room: z.enum(['wishlist', 'groupGift', 'conversation', 'order', 'event']),
  id: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

type AuthorizedSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

async function authorise(userId: string, role: string, room: z.infer<typeof subscribeSchema>): Promise<string> {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  switch (room.room) {
    case 'wishlist': {
      const wishlist = await prisma.wishlist.findFirst({
        where: { id: room.id, deletedAt: null },
        select: { id: true, ownerId: true, visibility: true },
      });
      if (!wishlist) throw new AppError('NOT_FOUND');
      if (wishlist.ownerId === userId) throw new AppError('OWNER_CANNOT_VIEW_RESERVATIONS');
      await assertCanViewWishlist(wishlist, userId);
      return rooms.wishlist(room.id);
    }
    case 'groupGift': {
      const gift = await prisma.groupGift.findUnique({
        where: { id: room.id },
        select: { organizerId: true, beneficiaryUserId: true, revealedAt: true },
      });
      if (!gift) throw new AppError('NOT_FOUND');
      if (gift.beneficiaryUserId === userId && !gift.revealedAt) throw new AppError('NOT_FOUND');
      if (gift.organizerId !== userId && gift.beneficiaryUserId !== userId) {
        const member = await prisma.groupGiftMember.findUnique({
          where: { groupGiftId_userId: { groupGiftId: room.id, userId } },
          select: { userId: true },
        });
        if (!member) throw new AppError('NOT_GROUP_MEMBER');
      }
      return rooms.groupGift(room.id);
    }
    case 'conversation': {
      if (!(await isMember(room.id, userId))) throw new AppError('NOT_GROUP_MEMBER');
      return rooms.conversation(room.id);
    }
    case 'order': {
      const order = await prisma.order.findUnique({
        where: { id: room.id },
        select: { buyerId: true, items: { select: { vendor: { select: { ownerUserId: true } } } } },
      });
      if (!order) throw new AppError('NOT_FOUND');
      const isVendor = order.items.some((item) => item.vendor.ownerUserId === userId);
      if (!isAdmin && order.buyerId !== userId && !isVendor) throw new AppError('NOT_FOUND');
      return rooms.order(room.id);
    }
    case 'event': {
      const event = await prisma.birthdayEvent.findFirst({
        where: { id: room.id, cancelledAt: null },
        select: { hostId: true, guests: { where: { userId }, select: { id: true } } },
      });
      if (!event || (event.hostId !== userId && event.guests.length === 0)) throw new AppError('EVENT_NOT_FOUND');
      return rooms.event(room.id);
    }
    default:
      throw new AppError('NOT_FOUND');
  }
}

export function attachRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: '/realtime',
    cors: { origin: env.corsOrigins, credentials: true },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 64 * 1024,
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth as { token?: unknown } | undefined)?.token ??
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    void verifyAccessToken(token)
      .then(async (claims) => {
        const user = await prisma.user.findUnique({
          where: { id: claims.sub },
          select: { status: true, deletedAt: true, role: true },
        });
        if (!user || user.deletedAt || user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
          next(new Error('UNAUTHENTICATED'));
          return;
        }
        (socket as AuthorizedSocket).data = { userId: claims.sub, role: user.role };
        next();
      })
      .catch((error: unknown) => next(new Error(error instanceof AppError ? error.code : 'UNAUTHENTICATED')));
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as unknown as AuthorizedSocket;
    const { userId, role } = socket.data;
    void socket.join(rooms.user(userId));

    // Each subscription is an authorisation check; a client that spams them
    // is cut off rather than allowed to hammer the database.
    let subscriptions = 0;

    (socket as unknown as Socket).on('subscribe', (payload: unknown, ack?: (response: unknown) => void) => {
      const parsed = subscribeSchema.safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, code: 'VALIDATION_ERROR' });
        return;
      }
      subscriptions += 1;
      if (subscriptions > 200) {
        ack?.({ ok: false, code: 'RATE_LIMITED' });
        socket.disconnect(true);
        return;
      }
      void authorise(userId, role, parsed.data)
        .then(async (room) => {
          await socket.join(room);
          ack?.({ ok: true, room });
        })
        .catch((error: unknown) => ack?.({ ok: false, code: error instanceof AppError ? error.code : 'FORBIDDEN' }));
    });

    (socket as unknown as Socket).on('unsubscribe', (payload: unknown) => {
      const parsed = subscribeSchema.safeParse(payload);
      if (!parsed.success) return;
      const name = `${parsed.data.room}:${parsed.data.id}`;
      void socket.leave(name);
    });

    (socket as unknown as Socket).on('chat.typing', (payload: unknown) => {
      const parsed = z.object({ conversationId: z.string().min(8).max(64), isTyping: z.boolean() }).safeParse(payload);
      if (!parsed.success) return;
      const room = rooms.conversation(parsed.data.conversationId);
      // Only members who have subscribed are in the room, so membership was
      // already checked when they joined it.
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit(RealtimeEvent.CHAT_TYPING, {
        event: RealtimeEvent.CHAT_TYPING,
        room,
        payload: { conversationId: parsed.data.conversationId, userId, isTyping: parsed.data.isTyping },
        at: new Date().toISOString(),
      });
    });
  });

  setRealtimeServer(io);
  logger.info('realtime server attached at /realtime');
  return io;
}
