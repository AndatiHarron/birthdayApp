import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

/**
 * Product analytics (spec §53).
 *
 * Only named events on an allow-list are stored, and their properties are
 * restricted to a small set of non-identifying keys. Free-text fields, names,
 * phone numbers and message bodies are dropped before anything is written.
 */

export const ANALYTICS_EVENTS = [
  'app_open',
  'onboarding_completed',
  'birthday_viewed',
  'birthday_added',
  'contacts_imported',
  'wishlist_viewed',
  'wishlist_item_added',
  'wishlist_shared',
  'gift_reserved',
  'group_gift_created',
  'contribution_started',
  'digital_gift_sent',
  'wish_sent',
  'card_created',
  'product_viewed',
  'checkout_started',
  'order_placed',
  'ai_suggestions_requested',
  'surprise_created',
  'event_created',
  'thank_you_sent',
] as const;

const ALLOWED_PROPERTY_KEYS = new Set([
  'screen',
  'source',
  'category',
  'priority',
  'provider',
  'currency',
  'amountMinor',
  'itemCount',
  'giftType',
  'refinement',
  'shareChannel',
  'hasWishlist',
  'daysUntil',
]);

export const trackEventsSchema = z.object({
  events: z
    .array(
      z.object({
        name: z.enum(ANALYTICS_EVENTS),
        properties: z.record(z.union([z.string().max(64), z.number(), z.boolean()])).default({}),
        occurredAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .min(1)
    .max(50),
  sessionId: z.string().trim().max(64).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  appVersion: z.string().trim().max(32).optional(),
});
export type TrackEventsInput = z.infer<typeof trackEventsSchema>;

function sanitise(properties: Record<string, string | number | boolean>): Prisma.InputJsonObject {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (ALLOWED_PROPERTY_KEYS.has(key)) clean[key] = value;
  }
  return clean;
}

export async function trackEvents(userId: string | null, input: TrackEventsInput): Promise<number> {
  const now = Date.now();
  const rows = input.events.map((event) => {
    const occurred = event.occurredAt ? new Date(event.occurredAt) : new Date(now);
    // Clamp client clocks: nothing from the future or more than a week old.
    const createdAt = occurred.getTime() > now || now - occurred.getTime() > 7 * 86_400_000 ? new Date(now) : occurred;
    return {
      userId,
      name: event.name,
      properties: sanitise(event.properties),
      sessionId: input.sessionId ?? null,
      platform: input.platform ?? null,
      appVersion: input.appVersion ?? null,
      createdAt,
    };
  });
  try {
    const result = await prisma.analyticsEvent.createMany({ data: rows });
    return result.count;
  } catch (error) {
    logger.warn({ err: error }, 'analytics write failed');
    return 0;
  }
}

/** Server-side events for actions the API itself observes. */
export function trackServerEvent(userId: string | null, name: (typeof ANALYTICS_EVENTS)[number], properties: Record<string, string | number | boolean> = {}): void {
  void prisma.analyticsEvent
    .create({ data: { userId, name, properties: sanitise(properties), platform: 'server' } })
    .catch((error: unknown) => logger.debug({ err: error, name }, 'server analytics write failed'));
}
