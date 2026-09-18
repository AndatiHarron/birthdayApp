import { RealtimeEvent, type RealtimeEnvelope } from '@bday/shared';
import type { Server as SocketServer } from 'socket.io';
import { logger } from '../lib/logger';

/**
 * Realtime fan-out (spec §43).
 *
 * Services call `emitTo*` without knowing whether a socket server is running —
 * during tests, in the worker process and before `attachRealtime` has been
 * called, these are no-ops. A realtime update is an enhancement; nothing in the
 * request path may depend on one being delivered.
 */

let io: SocketServer | null = null;

export function setRealtimeServer(server: SocketServer | null): void {
  io = server;
}

export function realtimeServer(): SocketServer | null {
  return io;
}

/** Room naming. Every room is derived from an id the server controls. */
export const rooms = {
  user: (userId: string) => `user:${userId}`,
  wishlist: (wishlistId: string) => `wishlist:${wishlistId}`,
  groupGift: (groupGiftId: string) => `groupGift:${groupGiftId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  order: (orderId: string) => `order:${orderId}`,
  event: (eventId: string) => `event:${eventId}`,
} as const;

function emit(room: string, event: RealtimeEvent, payload: unknown): void {
  if (!io) return;
  const envelope: RealtimeEnvelope = {
    event,
    room,
    payload,
    at: new Date().toISOString(),
  };
  try {
    io.to(room).emit(event, envelope);
  } catch (error) {
    logger.warn({ err: error, room, event }, 'realtime emit failed');
  }
}

export function emitToUser(userId: string, event: RealtimeEvent, payload: unknown): void {
  emit(rooms.user(userId), event, payload);
}

export function emitToUsers(userIds: string[], event: RealtimeEvent, payload: unknown): void {
  for (const userId of new Set(userIds)) emitToUser(userId, event, payload);
}

export function emitToWishlist(wishlistId: string, event: RealtimeEvent, payload: unknown): void {
  emit(rooms.wishlist(wishlistId), event, payload);
}

export function emitToGroupGift(groupGiftId: string, event: RealtimeEvent, payload: unknown): void {
  emit(rooms.groupGift(groupGiftId), event, payload);
}

export function emitToConversation(
  conversationId: string,
  event: RealtimeEvent,
  payload: unknown,
): void {
  emit(rooms.conversation(conversationId), event, payload);
}

export function emitToOrder(orderId: string, event: RealtimeEvent, payload: unknown): void {
  emit(rooms.order(orderId), event, payload);
}

export function emitToEvent(eventId: string, event: RealtimeEvent, payload: unknown): void {
  emit(rooms.event(eventId), event, payload);
}

export { RealtimeEvent };
