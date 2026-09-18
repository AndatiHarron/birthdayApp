import type {
  CreateEventInput,
  EventDto,
  EventGuestDto,
  EventSummaryDto,
  InviteGuestsInput,
  RsvpInput,
  UpdateEventInput,
} from '@bday/shared';
import type { Prisma, RsvpStatus } from '@prisma/client';
import { randomToken } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { toActor } from '../mappers/user.mapper';
import { RealtimeEvent, emitToEvent } from '../realtime/emitter';
import { isBlockedEitherWay } from './access.service';
import { notify, notifyMany } from './notification.service';

/**
 * Birthday events and RSVPs (spec §30, §31).
 *
 * Guests without an account are first-class: each guest row carries its own
 * unguessable invite token, so an RSVP link works for someone who never signs
 * up. Only the host and invited guests may read an event.
 */

const USER_SELECT = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarUrl: true } },
} as const;

const EVENT_INCLUDE = {
  host: { select: USER_SELECT },
  guests: { include: { user: { select: USER_SELECT } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.BirthdayEventInclude;

type EventRow = Prisma.BirthdayEventGetPayload<{ include: typeof EVENT_INCLUDE }>;

function counts(guests: EventRow['guests']) {
  const result = { invited: guests.length, going: 0, maybe: 0, declined: 0, pending: 0 };
  for (const guest of guests) {
    if (guest.rsvp === 'GOING') result.going += 1 + guest.plusOnes;
    else if (guest.rsvp === 'MAYBE') result.maybe += 1;
    else if (guest.rsvp === 'DECLINED') result.declined += 1;
    else result.pending += 1;
  }
  return result;
}

function toGuestDto(guest: EventRow['guests'][number]): EventGuestDto {
  return {
    id: guest.id,
    user: toActor(guest.user),
    name: guest.name,
    rsvp: guest.rsvp,
    plusOnes: guest.plusOnes,
    respondedAt: guest.respondedAt?.toISOString() ?? null,
  };
}

function toSummary(event: EventRow, viewerId: string | null): EventSummaryDto {
  const mine = viewerId ? event.guests.find((guest) => guest.userId === viewerId) : undefined;
  return {
    id: event.id,
    name: event.name,
    startsAt: event.startsAt.toISOString(),
    coverImageUrl: event.coverImageUrl,
    venueName: event.venueName,
    hostId: event.hostId,
    myRsvp: mine?.rsvp ?? null,
    guestCount: event.guests.length,
  };
}

function toEventDto(event: EventRow, viewerId: string | null): EventDto {
  const isHost = viewerId === event.hostId;
  return {
    ...toSummary(event, viewerId),
    description: event.description,
    endsAt: event.endsAt?.toISOString() ?? null,
    venueAddress: event.venueAddress,
    latitude: event.latitude,
    longitude: event.longitude,
    host: toActor(event.host)!,
    wishlistId: event.wishlistId,
    conversationId: event.conversationId,
    // Guests see who else is coming; only the host sees the pending and
    // declined lists, which can be awkward to have public.
    guests: isHost ? event.guests.map(toGuestDto) : event.guests.filter((g) => g.rsvp === 'GOING').map(toGuestDto),
    counts: counts(event.guests),
    isHost,
  };
}

async function loadEvent(eventId: string): Promise<EventRow> {
  const event = await prisma.birthdayEvent.findUnique({ where: { id: eventId }, include: EVENT_INCLUDE });
  if (!event || event.cancelledAt) throw new AppError('EVENT_NOT_FOUND');
  return event;
}

function assertCanView(event: EventRow, viewerId: string): void {
  if (event.hostId === viewerId) return;
  if (!event.guests.some((guest) => guest.userId === viewerId)) throw new AppError('EVENT_NOT_FOUND');
}

async function assertHost(eventId: string, userId: string): Promise<EventRow> {
  const event = await loadEvent(eventId);
  if (event.hostId !== userId) throw new AppError('NOT_EVENT_HOST');
  return event;
}

async function eligibleGuestIds(hostId: string, userIds: string[]): Promise<string[]> {
  const unique = Array.from(new Set(userIds.filter((id) => id !== hostId)));
  if (unique.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, deletedAt: null, status: { not: 'SUSPENDED' } },
    select: { id: true },
  });
  const allowed: string[] = [];
  for (const user of users) {
    if (!(await isBlockedEitherWay(hostId, user.id))) allowed.push(user.id);
  }
  return allowed;
}

/* ------------------------------- host actions ------------------------------- */

export async function createEvent(hostId: string, input: CreateEventInput): Promise<EventDto> {
  if (input.wishlistId) {
    const wishlist = await prisma.wishlist.findFirst({
      where: { id: input.wishlistId, ownerId: hostId, deletedAt: null },
      select: { id: true },
    });
    if (!wishlist) throw new AppError('NOT_FOUND', { message: 'You can only attach one of your own wishlists.' });
  }

  const guestIds = await eligibleGuestIds(hostId, input.guestUserIds);
  const guestUsers = await prisma.user.findMany({ where: { id: { in: guestIds } }, select: USER_SELECT });

  const eventId = await prisma.$transaction(async (tx) => {
    let conversationId: string | null = null;
    if (input.createGroupChat) {
      const conversation = await tx.conversation.create({
        data: {
          type: 'EVENT',
          title: input.name,
          imageUrl: input.coverImageUrl ?? null,
          createdById: hostId,
          members: {
            create: [{ userId: hostId, isAdmin: true }, ...guestIds.map((userId) => ({ userId }))],
          },
        },
        select: { id: true },
      });
      conversationId = conversation.id;
    }

    const event = await tx.birthdayEvent.create({
      data: {
        hostId,
        name: input.name,
        description: input.description ?? null,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        venueName: input.venueName ?? null,
        venueAddress: input.venueAddress ?? null,
        latitude: input.location?.latitude ?? null,
        longitude: input.location?.longitude ?? null,
        coverImageUrl: input.coverImageUrl ?? null,
        wishlistId: input.wishlistId ?? null,
        conversationId,
        allowPlusOnes: input.allowPlusOnes,
        guests: {
          create: [
            ...guestUsers.map((user) => ({
              userId: user.id,
              name: user.profile?.displayName ?? user.username,
              inviteToken: randomToken(18),
            })),
            ...input.guestNames.map((name) => ({ name, inviteToken: randomToken(18) })),
          ],
        },
      },
      select: { id: true },
    });
    return event.id;
  });

  const host = await prisma.user.findUnique({ where: { id: hostId }, select: USER_SELECT });
  await notifyMany(guestIds, {
    type: 'EVENT_INVITE',
    title: '🎉 You are invited!',
    body: `${host?.profile?.displayName ?? host?.username ?? 'A friend'} invited you to “${input.name}”.`,
    deepLink: `events/${eventId}`,
    data: { eventId },
  });

  return toEventDto(await loadEvent(eventId), hostId);
}

export async function updateEvent(hostId: string, eventId: string, input: UpdateEventInput): Promise<EventDto> {
  const event = await assertHost(eventId, hostId);
  if (input.wishlistId) {
    const wishlist = await prisma.wishlist.findFirst({
      where: { id: input.wishlistId, ownerId: hostId, deletedAt: null },
      select: { id: true },
    });
    if (!wishlist) throw new AppError('NOT_FOUND', { message: 'You can only attach one of your own wishlists.' });
  }
  const startsAt = input.startsAt ? new Date(input.startsAt) : event.startsAt;
  const endsAt = input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : event.endsAt;
  if (endsAt && endsAt <= startsAt) {
    throw new AppError('VALIDATION_ERROR', { fieldErrors: { 'body.endsAt': ['The end time must be after the start time'] } });
  }

  await prisma.birthdayEvent.update({
    where: { id: eventId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      startsAt,
      endsAt,
      ...(input.venueName !== undefined ? { venueName: input.venueName ?? null } : {}),
      ...(input.venueAddress !== undefined ? { venueAddress: input.venueAddress ?? null } : {}),
      ...(input.location !== undefined
        ? { latitude: input.location?.latitude ?? null, longitude: input.location?.longitude ?? null }
        : {}),
      ...(input.coverImageUrl !== undefined ? { coverImageUrl: input.coverImageUrl ?? null } : {}),
      ...(input.wishlistId !== undefined ? { wishlistId: input.wishlistId ?? null } : {}),
      ...(input.allowPlusOnes !== undefined ? { allowPlusOnes: input.allowPlusOnes } : {}),
    },
  });

  const timeChanged = input.startsAt !== undefined && startsAt.getTime() !== event.startsAt.getTime();
  const venueChanged = input.venueName !== undefined || input.venueAddress !== undefined;
  if (timeChanged || venueChanged) {
    const guestIds = event.guests
      .filter((guest) => guest.userId && guest.rsvp !== 'DECLINED')
      .map((guest) => guest.userId!);
    await notifyMany(guestIds, {
      type: 'EVENT_INVITE',
      title: 'Event updated',
      body: `“${input.name ?? event.name}” has a new ${timeChanged ? 'time' : 'venue'}.`,
      deepLink: `events/${eventId}`,
      data: { eventId },
    });
  }

  emitToEvent(eventId, RealtimeEvent.EVENT_RSVP_UPDATED, { eventId });
  return toEventDto(await loadEvent(eventId), hostId);
}

export async function cancelEvent(hostId: string, eventId: string): Promise<void> {
  const event = await assertHost(eventId, hostId);
  await prisma.birthdayEvent.update({ where: { id: eventId }, data: { cancelledAt: new Date() } });
  const guestIds = event.guests.filter((guest) => guest.userId).map((guest) => guest.userId!);
  await notifyMany(guestIds, {
    type: 'EVENT_INVITE',
    title: 'Event cancelled',
    body: `“${event.name}” has been cancelled.`,
    deepLink: 'events',
    data: { eventId },
  });
  emitToEvent(eventId, RealtimeEvent.EVENT_RSVP_UPDATED, { eventId, cancelled: true });
}

export async function inviteGuests(hostId: string, eventId: string, input: InviteGuestsInput): Promise<EventDto> {
  const event = await assertHost(eventId, hostId);
  const existing = new Set(event.guests.map((guest) => guest.userId).filter(Boolean));
  const guestIds = (await eligibleGuestIds(hostId, input.userIds)).filter((id) => !existing.has(id));
  const users = await prisma.user.findMany({ where: { id: { in: guestIds } }, select: USER_SELECT });

  await prisma.$transaction(async (tx) => {
    await tx.eventGuest.createMany({
      data: [
        ...users.map((user) => ({
          eventId,
          userId: user.id,
          name: user.profile?.displayName ?? user.username,
          inviteToken: randomToken(18),
        })),
        ...input.names.map((name) => ({ eventId, name, inviteToken: randomToken(18) })),
      ],
      skipDuplicates: true,
    });
    if (event.conversationId && guestIds.length > 0) {
      await tx.conversationMember.createMany({
        data: guestIds.map((userId) => ({ conversationId: event.conversationId!, userId })),
        skipDuplicates: true,
      });
    }
  });

  await notifyMany(guestIds, {
    type: 'EVENT_INVITE',
    title: '🎉 You are invited!',
    body: `${event.host.profile?.displayName ?? event.host.username} invited you to “${event.name}”.`,
    deepLink: `events/${eventId}`,
    data: { eventId },
  });

  emitToEvent(eventId, RealtimeEvent.EVENT_RSVP_UPDATED, { eventId });
  return toEventDto(await loadEvent(eventId), hostId);
}

export async function removeGuest(hostId: string, eventId: string, guestId: string): Promise<void> {
  const event = await assertHost(eventId, hostId);
  const guest = event.guests.find((row) => row.id === guestId);
  if (!guest) throw new AppError('NOT_FOUND');
  await prisma.$transaction(async (tx) => {
    await tx.eventGuest.delete({ where: { id: guestId } });
    if (guest.userId && event.conversationId) {
      await tx.conversationMember.updateMany({
        where: { conversationId: event.conversationId, userId: guest.userId },
        data: { leftAt: new Date() },
      });
    }
  });
  emitToEvent(eventId, RealtimeEvent.EVENT_RSVP_UPDATED, { eventId });
}

/** Per-guest invite links for guests without the app (host only). */
export async function listInviteLinks(hostId: string, eventId: string) {
  const event = await assertHost(eventId, hostId);
  return event.guests.map((guest) => ({
    guestId: guest.id,
    name: guest.name,
    token: guest.inviteToken,
  }));
}

/* ------------------------------- guest actions ------------------------------- */

export async function getEvent(viewerId: string, eventId: string): Promise<EventDto> {
  const event = await loadEvent(eventId);
  assertCanView(event, viewerId);
  return toEventDto(event, viewerId);
}

export async function listMyEvents(
  userId: string,
  options: { scope: 'UPCOMING' | 'PAST' | 'HOSTING' },
): Promise<EventSummaryDto[]> {
  const now = new Date();
  const where: Prisma.BirthdayEventWhereInput = {
    cancelledAt: null,
    ...(options.scope === 'HOSTING'
      ? { hostId: userId }
      : { OR: [{ hostId: userId }, { guests: { some: { userId } } }] }),
    ...(options.scope === 'UPCOMING' ? { startsAt: { gte: new Date(now.getTime() - 6 * 3_600_000) } } : {}),
    ...(options.scope === 'PAST' ? { startsAt: { lt: now } } : {}),
  };
  const rows = await prisma.birthdayEvent.findMany({
    where,
    orderBy: { startsAt: options.scope === 'PAST' ? 'desc' : 'asc' },
    take: 100,
    include: EVENT_INCLUDE,
  });
  return rows.map((row) => toSummary(row, userId));
}

async function applyRsvp(
  event: EventRow,
  guest: EventRow['guests'][number],
  input: RsvpInput,
): Promise<void> {
  const plusOnes = event.allowPlusOnes && input.status === 'GOING' ? input.plusOnes : 0;
  await prisma.eventGuest.update({
    where: { id: guest.id },
    data: {
      rsvp: input.status as RsvpStatus,
      plusOnes,
      note: input.note ?? null,
      respondedAt: new Date(),
    },
  });

  emitToEvent(event.id, RealtimeEvent.EVENT_RSVP_UPDATED, { eventId: event.id, guestId: guest.id, rsvp: input.status });

  if (input.status !== guest.rsvp) {
    const label = input.status === 'GOING' ? 'is going' : input.status === 'MAYBE' ? 'might come' : "can't attend";
    await notify({
      userId: event.hostId,
      type: 'EVENT_RSVP',
      title: 'New RSVP',
      body: `${guest.name} ${label} to “${event.name}”.`,
      deepLink: `events/${event.id}`,
      data: { eventId: event.id },
      silent: true,
    }).catch(() => undefined);
  }
}

export async function rsvp(userId: string, eventId: string, input: RsvpInput): Promise<EventDto> {
  const event = await loadEvent(eventId);
  const guest = event.guests.find((row) => row.userId === userId);
  if (!guest) throw new AppError('NOT_INVITED');
  if (input.status === 'PENDING') throw new AppError('VALIDATION_ERROR', { message: 'Choose going, maybe or can’t attend.' });
  await applyRsvp(event, guest, input);
  return toEventDto(await loadEvent(eventId), userId);
}

/** Public, token-authenticated view for guests who do not have the app. */
export async function getEventByInviteToken(token: string) {
  const guest = await prisma.eventGuest.findUnique({ where: { inviteToken: token }, select: { eventId: true, id: true } });
  if (!guest) throw new AppError('NOT_INVITED');
  const event = await loadEvent(guest.eventId);
  const me = event.guests.find((row) => row.id === guest.id)!;
  return {
    event: {
      id: event.id,
      name: event.name,
      description: event.description,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      coverImageUrl: event.coverImageUrl,
      host: toActor(event.host),
      allowPlusOnes: event.allowPlusOnes,
    },
    guest: toGuestDto(me),
  };
}

export async function rsvpByInviteToken(token: string, input: RsvpInput) {
  const guest = await prisma.eventGuest.findUnique({ where: { inviteToken: token }, select: { eventId: true, id: true } });
  if (!guest) throw new AppError('NOT_INVITED');
  const event = await loadEvent(guest.eventId);
  const row = event.guests.find((entry) => entry.id === guest.id)!;
  if (input.status === 'PENDING') throw new AppError('VALIDATION_ERROR', { message: 'Choose going, maybe or can’t attend.' });
  await applyRsvp(event, row, input);
  return getEventByInviteToken(token);
}

/** ICS export for calendar integration (spec §30). */
export async function eventIcs(viewerId: string, eventId: string): Promise<string> {
  const event = await loadEvent(eventId);
  assertCanView(event, viewerId);
  const format = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const end = event.endsAt ?? new Date(event.startsAt.getTime() + 3 * 3_600_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Birthday App//Events//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@birthday-app`,
    `DTSTAMP:${format(new Date())}`,
    `DTSTART:${format(event.startsAt)}`,
    `DTEND:${format(end)}`,
    `SUMMARY:${escape(event.name)}`,
    ...(event.description ? [`DESCRIPTION:${escape(event.description)}`] : []),
    ...(event.venueName || event.venueAddress
      ? [`LOCATION:${escape([event.venueName, event.venueAddress].filter(Boolean).join(', '))}`]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
