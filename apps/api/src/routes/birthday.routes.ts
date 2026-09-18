import {
  RelationshipType,
  calendarQuerySchema,
  confirmContactImportSchema,
  contactImportSchema,
  createFriendGroupSchema,
  createInviteSchema,
  createTrackedBirthdaySchema,
  friendRequestSchema,
  idSchema,
  respondToFriendRequestSchema,
  upcomingBirthdaysSchema,
  updateFriendGroupSchema,
  updateFriendshipSchema,
  updateTrackedBirthdaySchema,
} from '@bday/shared';
import { z } from 'zod';
import { idParams } from '../http/params';
import { createModule } from '../http/route';
import * as birthdayService from '../services/birthday.service';
import * as friendService from '../services/friend.service';

/* ------------------------------- birthdays ------------------------------- */

export const birthdays = createModule('/birthdays', 'Birthdays');

birthdays.get(
  '/upcoming',
  { summary: 'Birthdays coming up, soonest first', auth: 'user', query: upcomingBirthdaysSchema },
  async ({ userId, query }) => birthdayService.listUpcomingBirthdays(userId, query),
);

birthdays.get(
  '/calendar',
  { summary: 'Month view with birthdays and events', auth: 'user', query: calendarQuerySchema },
  async ({ userId, query }) => birthdayService.getCalendarMonth(userId, query),
);

birthdays.get(
  '/',
  {
    summary: 'Every birthday on your calendar',
    auth: 'user',
    query: z.object({ relationship: z.nativeEnum(RelationshipType).optional(), groupId: idSchema.optional() }),
  },
  async ({ userId, query }) => birthdayService.listAllBirthdays(userId, query),
);

birthdays.post(
  '/',
  { summary: 'Add a birthday manually', auth: 'user', body: createTrackedBirthdaySchema, status: 201 },
  async ({ userId, body }) => birthdayService.createTrackedBirthday(userId, body),
);

birthdays.post(
  '/import/preview',
  { summary: 'Match device contacts against the calendar and platform users', auth: 'user', body: contactImportSchema },
  async ({ userId, body }) => birthdayService.previewContactImport(userId, body),
);

birthdays.post(
  '/import/confirm',
  { summary: 'Import the selected contacts', auth: 'user', body: confirmContactImportSchema },
  async ({ userId, body }) => birthdayService.confirmContactImport(userId, body),
);

birthdays.get(
  '/today/me',
  { summary: 'Celebration summary when it is your birthday today', auth: 'user' },
  async ({ userId }) => birthdayService.myBirthdayToday(userId),
);

birthdays.get(
  '/:id',
  { summary: 'One birthday with countdown', auth: 'user', params: idParams },
  async ({ userId, params }) => birthdayService.getTrackedBirthday(userId, params.id),
);

birthdays.patch(
  '/:id',
  { summary: 'Edit a birthday, its groups or its reminder schedule', auth: 'user', params: idParams, body: updateTrackedBirthdaySchema },
  async ({ userId, params, body }) => birthdayService.updateTrackedBirthday(userId, params.id, body),
);

birthdays.delete(
  '/:id',
  { summary: 'Remove a birthday from your calendar', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => birthdayService.deleteTrackedBirthday(userId, params.id),
);

/* -------------------------------- invites -------------------------------- */

export const invites = createModule('/invites', 'Birthdays');

invites.post(
  '/',
  { summary: 'Create an invitation link and QR code', auth: 'user', body: createInviteSchema, status: 201 },
  async ({ userId, body }) => birthdayService.createInvite(userId, body),
);

invites.get('/', { summary: 'Invitations you have sent', auth: 'user' }, async ({ userId }) => birthdayService.listInvites(userId));

invites.get(
  '/:code',
  { summary: 'Preview an invitation before signing up', auth: 'public', params: z.object({ code: z.string().trim().min(6).max(32) }) },
  async ({ params }) => birthdayService.previewInvite(params.code),
);

/* -------------------------------- friends -------------------------------- */

export const friends = createModule('/friends', 'Friends');

friends.get(
  '/',
  {
    summary: 'Your connections',
    auth: 'user',
    query: z.object({
      groupId: idSchema.optional(),
      relationship: z.nativeEnum(RelationshipType).optional(),
      favoritesOnly: z.coerce.boolean().optional(),
    }),
  },
  async ({ userId, query }) => friendService.listFriends(userId, query),
);

friends.post(
  '/request',
  { summary: 'Send a friend request', auth: 'user', body: friendRequestSchema, status: 201 },
  async ({ userId, body }) => friendService.sendFriendRequest(userId, body),
);

friends.post(
  '/accept',
  { summary: 'Accept a friend request', auth: 'user', body: respondToFriendRequestSchema.omit({ action: true }) },
  async ({ userId, body }) => friendService.respondToFriendRequest(userId, { ...body, action: 'ACCEPT' }),
);

friends.post(
  '/respond',
  { summary: 'Accept or decline a friend request', auth: 'user', body: respondToFriendRequestSchema },
  async ({ userId, body }) => friendService.respondToFriendRequest(userId, body),
);

friends.get(
  '/requests',
  { summary: 'Pending requests', auth: 'user', query: z.object({ direction: z.enum(['INCOMING', 'OUTGOING']).default('INCOMING') }) },
  async ({ userId, query }) => friendService.listFriendRequests(userId, query.direction),
);

friends.delete(
  '/requests/:id',
  { summary: 'Cancel a request you sent', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => friendService.cancelFriendRequest(userId, params.id),
);

friends.patch(
  '/:id',
  { summary: 'Relationship, favourite, groups and reminders for a friend', auth: 'user', params: idParams, body: updateFriendshipSchema, status: 204 },
  async ({ userId, params, body }) => friendService.updateFriendship(userId, params.id, body),
);

friends.delete(
  '/:id',
  { summary: 'Remove a friend', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => friendService.removeFriend(userId, params.id),
);

/* ------------------------------ friend groups ------------------------------ */

export const friendGroups = createModule('/friend-groups', 'Friends');

friendGroups.get('/', { summary: 'Your groups (Family, Work, custom…)', auth: 'user' }, async ({ userId }) => friendService.listFriendGroups(userId));

friendGroups.post(
  '/',
  { summary: 'Create a custom group', auth: 'user', body: createFriendGroupSchema, status: 201 },
  async ({ userId, body }) => friendService.createFriendGroup(userId, body),
);

friendGroups.patch(
  '/:id',
  { summary: 'Rename, recolour or change members', auth: 'user', params: idParams, body: updateFriendGroupSchema },
  async ({ userId, params, body }) => friendService.updateFriendGroup(userId, params.id, body),
);

friendGroups.delete(
  '/:id',
  { summary: 'Delete a custom group', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => friendService.deleteFriendGroup(userId, params.id),
);
