import {
  createConversationSchema,
  createEventSchema,
  createPollSchema,
  createReportSchema,
  giftMatchSchema,
  giftSuggestionSchema,
  globalSearchSchema,
  idSchema,
  inviteGuestsSchema,
  markNotificationsReadSchema,
  notificationQuerySchema,
  rsvpSchema,
  sendChatMessageSchema,
  updateEventSchema,
  votePollSchema,
} from '@bday/shared';
import multer from 'multer';
import { z } from 'zod';
import { csvArray, idParams, limitQuery } from '../http/params';
import { createModule } from '../http/route';
import { AppError } from '../lib/errors';
import { aiLimiter, searchLimiter, uploadLimiter } from '../middleware/rateLimit';
import { storeUpload, UPLOAD_KINDS, type UploadKind } from '../providers/storage';
import { aiStatus, matchGifts, suggestGifts } from '../services/ai.service';
import { trackEvents, trackEventsSchema } from '../services/analytics.service';
import * as chatService from '../services/chat.service';
import * as eventService from '../services/event.service';
import { getHomeFeed } from '../services/home.service';
import * as notificationService from '../services/notification.service';
import { createReport } from '../services/report.service';
import { globalSearch } from '../services/search.service';

/* ---------------------------------- events ---------------------------------- */

export const events = createModule('/events', 'Events');

events.post(
  '/',
  { summary: 'Create a birthday event with guest list and optional group chat', auth: 'user', body: createEventSchema, status: 201 },
  async ({ userId, body }) => eventService.createEvent(userId, body),
);

events.get(
  '/',
  { summary: 'Events you host or are invited to', auth: 'user', query: z.object({ scope: z.enum(['UPCOMING', 'PAST', 'HOSTING']).default('UPCOMING') }) },
  async ({ userId, query }) => eventService.listMyEvents(userId, query),
);

events.get('/:id', { summary: 'Event detail with RSVP counts', auth: 'user', params: idParams }, async ({ userId, params }) => eventService.getEvent(userId, params.id));

events.patch(
  '/:id',
  { summary: 'Edit an event (host)', auth: 'user', params: idParams, body: updateEventSchema },
  async ({ userId, params, body }) => eventService.updateEvent(userId, params.id, body),
);

events.delete('/:id', { summary: 'Cancel an event (host)', auth: 'user', params: idParams, status: 204 }, async ({ userId, params }) => eventService.cancelEvent(userId, params.id));

events.post(
  '/:id/guests',
  { summary: 'Invite more guests (host)', auth: 'user', params: idParams, body: inviteGuestsSchema },
  async ({ userId, params, body }) => eventService.inviteGuests(userId, params.id, body),
);

events.delete(
  '/:id/guests/:guestId',
  { summary: 'Remove a guest (host)', auth: 'user', params: idParams.extend({ guestId: idSchema }), status: 204 },
  async ({ userId, params }) => eventService.removeGuest(userId, params.id, params.guestId),
);

events.get(
  '/:id/invite-links',
  { summary: 'Personal RSVP links for guests without the app (host)', auth: 'user', params: idParams },
  async ({ userId, params }) => eventService.listInviteLinks(userId, params.id),
);

events.post(
  '/:id/rsvp',
  { summary: 'RSVP: going, maybe or can’t attend', auth: 'user', params: idParams, body: rsvpSchema },
  async ({ userId, params, body }) => eventService.rsvp(userId, params.id, body),
);

events.get(
  '/:id/calendar.ics',
  { summary: 'Add to calendar (iCalendar file)', auth: 'user', params: idParams, raw: true },
  async ({ userId, params, res }) => {
    const ics = await eventService.eventIcs(userId, params.id);
    res.setHeader('content-type', 'text/calendar; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="event-${params.id}.ics"`);
    res.send(ics);
  },
);

export const rsvpLinks = createModule('/rsvp', 'Events');

const tokenParams = z.object({ token: z.string().trim().min(16).max(64) });

rsvpLinks.get('/:token', { summary: 'Event invitation for a guest link', auth: 'public', params: tokenParams }, async ({ params }) => eventService.getEventByInviteToken(params.token));

rsvpLinks.post(
  '/:token',
  { summary: 'RSVP through a guest link', auth: 'public', params: tokenParams, body: rsvpSchema },
  async ({ params, body }) => eventService.rsvpByInviteToken(params.token, body),
);

/* ----------------------------------- chat ----------------------------------- */

export const conversations = createModule('/conversations', 'Chat');

conversations.get('/', { summary: 'Your conversations with unread counts', auth: 'user' }, async ({ userId }) => chatService.listConversations(userId));

conversations.post(
  '/',
  { summary: 'Open a one-to-one chat with a friend', auth: 'user', body: createConversationSchema, status: 201 },
  async ({ userId, body }) => chatService.createConversation(userId, body),
);

conversations.get('/:id', { summary: 'One conversation', auth: 'user', params: idParams }, async ({ userId, params }) => chatService.getConversation(userId, params.id));

conversations.get(
  '/:id/messages',
  { summary: 'Messages, newest first', auth: 'user', params: idParams, query: limitQuery },
  async ({ userId, params, query }) => chatService.listMessages(userId, params.id, query),
);

conversations.post(
  '/:id/messages',
  { summary: 'Send a text, image or voice note', auth: 'user', params: idParams, body: sendChatMessageSchema, status: 201 },
  async ({ userId, params, body }) => chatService.sendMessage(userId, params.id, body),
);

conversations.post('/:id/read', { summary: 'Mark as read', auth: 'user', params: idParams, status: 204 }, async ({ userId, params }) => chatService.markConversationRead(userId, params.id));

conversations.post('/:id/leave', { summary: 'Leave a conversation', auth: 'user', params: idParams, status: 204 }, async ({ userId, params }) => chatService.leaveConversation(userId, params.id));

conversations.post(
  '/:id/mute',
  { summary: 'Mute for a number of hours (null to unmute)', auth: 'user', params: idParams, body: z.object({ hours: z.number().int().min(1).max(8760).nullable() }), status: 204 },
  async ({ userId, params, body }) => chatService.muteConversation(userId, params.id, body.hours),
);

conversations.post(
  '/:id/polls',
  { summary: 'Start a poll in the group', auth: 'user', params: idParams, body: createPollSchema, status: 201 },
  async ({ userId, params, body }) => chatService.createPoll(userId, params.id, body),
);

export const chatActions = createModule('', 'Chat');

chatActions.post(
  '/polls/:id/vote',
  { summary: 'Vote in a poll', auth: 'user', params: idParams, body: votePollSchema },
  async ({ userId, params, body }) => chatService.votePoll(userId, params.id, body),
);

chatActions.delete('/messages/:id', { summary: 'Delete a message', auth: 'user', params: idParams, status: 204 }, async ({ userId, params }) => chatService.deleteMessage(userId, params.id));

/* ------------------------------- notifications ------------------------------- */

export const notifications = createModule('/notifications', 'Notifications');

notifications.get(
  '/',
  { summary: 'Notification inbox', auth: 'user', query: notificationQuerySchema },
  async ({ userId, query }) => notificationService.listNotifications(userId, query),
);

notifications.get('/unread-count', { summary: 'Badge count', auth: 'user' }, async ({ userId }) => ({ count: await notificationService.unreadCount(userId) }));

notifications.post(
  '/read',
  { summary: 'Mark some or all as read', auth: 'user', body: markNotificationsReadSchema },
  async ({ userId, body }) => ({ updated: await notificationService.markRead(userId, body) }),
);

notifications.delete('/:id', { summary: 'Delete a notification', auth: 'user', params: idParams, status: 204 }, async ({ userId, params }) => notificationService.deleteNotification(userId, params.id));

/* ------------------------------------ AI ------------------------------------ */

export const ai = createModule('/ai', 'AI gift assistant');

ai.get('/status', { summary: 'Whether the assistant is configured', auth: 'public' }, async () => aiStatus());

ai.post(
  '/gift-suggestions',
  {
    summary: 'Conversational gift ideas for a person and budget',
    description: 'Uses a daily quota (higher for premium). Refine with CHEAPER, PREMIUM, ROMANTIC, FUNNY, UNEXPECTED, MORE_LIKE_THIS or SURPRISE_ME.',
    auth: 'user',
    body: giftSuggestionSchema,
    middleware: [aiLimiter],
  },
  async ({ userId, auth, body }) => suggestGifts({ userId, isPremium: auth?.isPremium ?? false }, body),
);

ai.get(
  '/gift-matches',
  { summary: 'Recipient + interests + wishlist + budget matched to real gifts', auth: 'user', query: giftMatchSchema },
  async ({ userId, query }) => matchGifts(userId, query),
);

/* ------------------------------- home & search ------------------------------- */

export const home = createModule('/home', 'Home');
home.get('/', { summary: 'Home dashboard in one request', auth: 'user' }, async ({ userId }) => getHomeFeed(userId));

export const search = createModule('/search', 'Search');

const SEARCH_TYPES = ['PEOPLE', 'PRODUCTS', 'WISHLISTS', 'EVENTS', 'VENDORS'] as const;

search.get(
  '/',
  {
    summary: 'Search people, gifts, wishlists, events and shops',
    auth: 'user',
    query: globalSearchSchema.extend({
      types: csvArray(z.enum(SEARCH_TYPES)).transform((value) => value ?? [...SEARCH_TYPES]),
      minPriceMinor: z.coerce.number().int().min(0).optional(),
      maxPriceMinor: z.coerce.number().int().min(0).optional(),
    }),
    middleware: [searchLimiter],
  },
  async ({ userId, query }) => globalSearch(userId, query),
);

/* ---------------------------------- uploads ---------------------------------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(...Object.values(UPLOAD_KINDS).map((kind) => kind.maxBytes)), files: 1 },
});

export const uploads = createModule('/uploads', 'Uploads');

uploads.post(
  '/:kind',
  {
    summary: 'Upload a photo, video or voice note (multipart field "file")',
    description: `Kinds: ${Object.keys(UPLOAD_KINDS).join(', ')}. File contents are checked against their declared type.`,
    auth: 'user',
    params: z.object({ kind: z.enum(Object.keys(UPLOAD_KINDS) as [UploadKind, ...UploadKind[]]) }),
    status: 201,
    middleware: [uploadLimiter, upload.single('file')],
  },
  async ({ req, params }) => {
    if (!req.file) throw new AppError('VALIDATION_ERROR', { fieldErrors: { file: ['Attach a file'] } });
    const stored = await storeUpload(params.kind, req.file);
    return { url: stored.url, key: stored.key, contentType: stored.contentType, size: stored.size };
  },
);

/* ----------------------------- reports & analytics ----------------------------- */

export const reports = createModule('/reports', 'Safety');

reports.post(
  '/',
  { summary: 'Report a person, product, shop, message or order', auth: 'user', body: createReportSchema, status: 201 },
  async ({ userId, body }) => createReport(userId, body),
);

export const analytics = createModule('/analytics', 'Analytics');

analytics.post(
  '/events',
  { summary: 'Record anonymous product analytics events', auth: 'optional', body: trackEventsSchema, status: 202 },
  async ({ auth, body }) => ({ accepted: await trackEvents(auth?.userId ?? null, body) }),
);
