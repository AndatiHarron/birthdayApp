import { RealtimeEvent, type RealtimeEnvelope } from '@bday/shared';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshSession } from './api';
import { API_URL } from './config';
import { queryClient } from './query';

/**
 * Realtime updates (spec §43). One socket per signed-in session. Screens call
 * `useRealtimeRoom` to subscribe to a wishlist, group gift, chat or order; the
 * server authorises every subscription.
 */

let socket: Socket | null = null;

export function connectRealtime(): Socket {
  if (socket) return socket;
  socket = io(API_URL, {
    path: '/realtime',
    transports: ['websocket'],
    auth: (callback) => callback({ token: getAccessToken() }),
    reconnectionDelayMax: 10_000,
  });

  socket.on('connect_error', (error) => {
    if (error.message === 'TOKEN_EXPIRED' || error.message === 'UNAUTHENTICATED') {
      void refreshSession()
        .catch(() => null)
        .then(() => socket?.connect());
    }
  });

  // Global invalidations: whatever screen is open picks up the change.
  socket.on(RealtimeEvent.NOTIFICATION_CREATED, () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
  });
  socket.on(RealtimeEvent.PAYMENT_UPDATED, () => {
    void queryClient.invalidateQueries({ queryKey: ['group-gift'] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  });
  socket.on(RealtimeEvent.DELIVERY_UPDATED, (envelope: RealtimeEnvelope<{ orderId: string }>) => {
    void queryClient.invalidateQueries({ queryKey: ['order', envelope.payload.orderId] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  });
  return socket;
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

type Room = 'wishlist' | 'groupGift' | 'conversation' | 'order' | 'event';

export function useRealtimeRoom(room: Room, id: string | undefined, handlers: Partial<Record<RealtimeEvent, (envelope: RealtimeEnvelope) => void>>): void {
  useEffect(() => {
    if (!id || !socket) return;
    const current = socket;
    const subscribe = () => current.emit('subscribe', { room, id });
    subscribe();
    current.on('connect', subscribe);
    const entries = Object.entries(handlers) as Array<[RealtimeEvent, (envelope: RealtimeEnvelope) => void]>;
    entries.forEach(([event, handler]) => current.on(event, handler));
    return () => {
      current.emit('unsubscribe', { room, id });
      current.off('connect', subscribe);
      entries.forEach(([event, handler]) => current.off(event, handler));
    };
    // Handlers are expected to be stable per render of the owning screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, id]);
}

export function emitTyping(conversationId: string, isTyping: boolean): void {
  socket?.emit('chat.typing', { conversationId, isTyping });
}
