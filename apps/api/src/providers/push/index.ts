import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Badge count for iOS. */
  badge?: number;
  sound?: 'default' | null;
  /** Custom channel for Android notification grouping. */
  channelId?: string;
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Tokens the provider rejected as unregistered — callers should delete them. */
  invalidTokens: string[];
}

export interface PushProvider {
  readonly name: string;
  send(message: PushMessage): Promise<PushResult>;
}

/**
 * Expo push (spec §62.10).
 *
 * Expo fans out to APNs and FCM, which means one credential set instead of two
 * and no per-platform payload handling. Swapping in raw FCM later only needs a
 * new implementation of this interface.
 */
class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  private readonly expo: Expo;

  constructor() {
    this.expo = new Expo({
      accessToken: env.EXPO_ACCESS_TOKEN,
      useFcmV1: true,
    });
  }

  async send(message: PushMessage): Promise<PushResult> {
    const valid = message.tokens.filter((token) => Expo.isExpoPushToken(token));
    // Typed explicitly: `isExpoPushToken` is a type guard, so the negated
    // filter would otherwise narrow this array to `never[]`.
    const invalidTokens: string[] = message.tokens.filter((token) => !Expo.isExpoPushToken(token));

    if (valid.length === 0) return { sent: 0, failed: 0, invalidTokens };

    const messages: ExpoPushMessage[] = valid.map((token) => ({
      to: token,
      title: message.title,
      body: message.body,
      data: message.data,
      sound: message.sound === null ? undefined : 'default',
      badge: message.badge,
      channelId: message.channelId ?? 'default',
      priority: 'high',
    }));

    let sent = 0;
    let failed = 0;

    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        // A whole-chunk failure is usually a transport problem. Count it and
        // move on: a notification is never worth failing the caller's request.
        failed += chunk.length;
        logger.warn({ err: error, count: chunk.length }, 'push chunk failed');
        continue;
      }

      tickets.forEach((ticket, index) => {
        if (ticket.status === 'ok') {
          sent += 1;
          return;
        }
        failed += 1;
        const token = chunk[index]?.to;
        if (
          ticket.details?.error === 'DeviceNotRegistered' &&
          typeof token === 'string'
        ) {
          invalidTokens.push(token);
        } else {
          logger.warn({ ticket }, 'push ticket rejected');
        }
      });
    }

    return { sent, failed, invalidTokens };
  }
}

/** Development driver: logs instead of sending, so no credentials are needed. */
class ConsolePushProvider implements PushProvider {
  readonly name = 'console';

  async send(message: PushMessage): Promise<PushResult> {
    logger.info(
      { tokens: message.tokens.length, title: message.title, body: message.body, data: message.data },
      '[push] would send',
    );
    return { sent: message.tokens.length, failed: 0, invalidTokens: [] };
  }
}

let provider: PushProvider | null = null;

export function push(): PushProvider {
  if (!provider) {
    provider = env.EXPO_ACCESS_TOKEN || env.isProduction ? new ExpoPushProvider() : new ConsolePushProvider();
    logger.info({ driver: provider.name }, 'push provider ready');
  }
  return provider;
}
