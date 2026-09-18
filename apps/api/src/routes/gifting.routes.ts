import {
  birthdayCardSchema,
  contributeSchema,
  createGiftHistoryEntrySchema,
  createGroupGiftSchema,
  createMemorySchema,
  createSurpriseSchema,
  idSchema,
  inviteToGroupGiftSchema,
  markNotificationsReadSchema,
  reactToMessageSchema,
  revealGroupGiftSchema,
  sendBirthdayMessageSchema,
  sendDigitalGiftSchema,
  sendThankYouSchema,
  updateGroupGiftSchema,
  updateMemorySchema,
} from '@bday/shared';
import { z } from 'zod';
import { idParams } from '../http/params';
import { createModule } from '../http/route';
import { paymentLimiter } from '../middleware/rateLimit';
import * as digitalGiftService from '../services/digitalGift.service';
import * as groupGiftService from '../services/groupGift.service';
import * as memoryService from '../services/memory.service';
import * as surpriseService from '../services/surprise.service';
import * as wishService from '../services/wish.service';

/* ------------------------------ group gifts ------------------------------ */

export const groupGifts = createModule('/gifts/group', 'Group gifts');

groupGifts.post(
  '/',
  { summary: 'Start a group gift (optionally with a secret planning chat)', auth: 'user', body: createGroupGiftSchema, status: 201 },
  async ({ userId, body }) => groupGiftService.createGroupGift(userId, body),
);

groupGifts.get('/', { summary: 'Group gifts you organise or take part in', auth: 'user' }, async ({ userId }) => groupGiftService.listMyGroupGifts(userId));

groupGifts.get(
  '/:id',
  { summary: 'Progress, contributors and status', auth: 'user', params: idParams },
  async ({ userId, params }) => groupGiftService.getGroupGift(userId, params.id),
);

groupGifts.patch(
  '/:id',
  { summary: 'Edit title, goal or deadline (organiser)', auth: 'user', params: idParams, body: updateGroupGiftSchema },
  async ({ userId, params, body }) => groupGiftService.updateGroupGift(userId, params.id, body),
);

groupGifts.post(
  '/:id/invite',
  { summary: 'Invite friends (never the birthday person)', auth: 'user', params: idParams, body: inviteToGroupGiftSchema, status: 204 },
  async ({ userId, params, body }) => groupGiftService.inviteToGroupGift(userId, params.id, body),
);

groupGifts.post(
  '/:id/leave',
  { summary: 'Leave a group gift', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => groupGiftService.leaveGroupGift(userId, params.id),
);

groupGifts.post(
  '/:id/cancel',
  { summary: 'Cancel before any money is collected (organiser)', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => groupGiftService.cancelGroupGift(userId, params.id),
);

groupGifts.post(
  '/:id/contribute',
  {
    summary: 'Contribute money',
    description: 'Creates a PENDING contribution and payment. Progress only moves once the payment provider confirms.',
    auth: 'user',
    params: idParams,
    body: contributeSchema,
    status: 201,
    middleware: [paymentLimiter],
  },
  async ({ userId, params, body }) => groupGiftService.contribute(userId, params.id, body),
);

groupGifts.get(
  '/:id/contributions',
  { summary: 'Contribution list (hidden from the birthday person until revealed)', auth: 'user', params: idParams },
  async ({ userId, params }) => groupGiftService.listContributions(userId, params.id),
);

groupGifts.post(
  '/:id/purchased',
  { summary: 'Mark the funded gift as bought (organiser)', auth: 'user', params: idParams },
  async ({ userId, params }) => groupGiftService.markGroupGiftPurchased(userId, params.id),
);

groupGifts.post(
  '/:id/reveal',
  { summary: 'Reveal the surprise to the birthday person', auth: 'user', params: idParams, body: revealGroupGiftSchema },
  async ({ userId, params, body }) => groupGiftService.revealGroupGift(userId, params.id, body),
);

/** Spec §42 shape: POST /gifts/contribute with the gift id in the body. */
export const contributions = createModule('/gifts', 'Group gifts');

contributions.post(
  '/contribute',
  {
    summary: 'Contribute to a group gift (gift id in body)',
    auth: 'user',
    body: contributeSchema.extend({ groupGiftId: idSchema }),
    status: 201,
    middleware: [paymentLimiter],
  },
  async ({ userId, body }) => {
    const { groupGiftId, ...input } = body;
    return groupGiftService.contribute(userId, groupGiftId, input);
  },
);

contributions.get('/contributions', { summary: 'Your contributions', auth: 'user' }, async ({ userId }) => groupGiftService.listMyContributions(userId));

/* ------------------------------- surprises ------------------------------- */

export const surprises = createModule('/surprises', 'Surprises');

surprises.post(
  '/',
  { summary: 'Create a birthday surprise with a private planning group', auth: 'user', body: createSurpriseSchema, status: 201 },
  async ({ userId, body }) => surpriseService.createSurprise(userId, body),
);

surprises.get('/', { summary: 'Surprises you are planning', auth: 'user' }, async ({ userId }) => surpriseService.listMySurprises(userId));

surprises.get(
  '/:id',
  { summary: 'A surprise (never visible to its subject)', auth: 'user', params: idParams },
  async ({ userId, params }) => surpriseService.getSurprise(userId, params.id),
);

surprises.post(
  '/:id/members',
  { summary: 'Add planners', auth: 'user', params: idParams, body: z.object({ memberIds: z.array(idSchema).min(1).max(50) }), status: 204 },
  async ({ userId, params, body }) => surpriseService.addSurpriseMembers(userId, params.id, body.memberIds),
);

surprises.post(
  '/:id/leave',
  { summary: 'Leave the planning group', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => surpriseService.leaveSurprise(userId, params.id),
);

surprises.post(
  '/:id/group-gift',
  { summary: 'Link a group gift to the surprise', auth: 'user', params: idParams, body: z.object({ groupGiftId: idSchema }), status: 204 },
  async ({ userId, params, body }) => surpriseService.attachGroupGift(userId, params.id, body.groupGiftId),
);

surprises.post(
  '/:id/reveal',
  { summary: 'Mark the surprise revealed', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => surpriseService.markSurpriseRevealed(userId, params.id),
);

/* ------------------------------ digital gifts ------------------------------ */

export const digitalGifts = createModule('/digital-gifts', 'Digital gifts');

digitalGifts.get('/catalog', { summary: 'Digital gift types, fees and suggested values', auth: 'public' }, async () => digitalGiftService.digitalGiftCatalog());

digitalGifts.post(
  '/',
  { summary: 'Send a digital gift now or on a scheduled date', auth: 'user', body: sendDigitalGiftSchema, status: 201, middleware: [paymentLimiter] },
  async ({ userId, auth, body }) => digitalGiftService.sendDigitalGift(userId, body, auth?.isPremium ?? false),
);

digitalGifts.get('/received', { summary: 'Digital gifts you received', auth: 'user' }, async ({ userId }) => digitalGiftService.listReceivedDigitalGifts(userId));
digitalGifts.get('/sent', { summary: 'Digital gifts you sent', auth: 'user' }, async ({ userId }) => digitalGiftService.listSentDigitalGifts(userId));

digitalGifts.get(
  '/:id',
  { summary: 'One digital gift', auth: 'user', params: idParams },
  async ({ userId, params }) => digitalGiftService.getDigitalGift(userId, params.id),
);

digitalGifts.post(
  '/:id/open',
  { summary: 'Open (unwrap) a gift you received', auth: 'user', params: idParams },
  async ({ userId, params }) => digitalGiftService.openDigitalGift(userId, params.id),
);

export const wallet = createModule('/wallet', 'Payments');
wallet.get('/', { summary: 'Wallet balance and ledger', auth: 'user' }, async ({ userId }) => digitalGiftService.getWallet(userId));

/* ---------------------------- birthday wishes ---------------------------- */

export const wishes = createModule('/birthday-messages', 'Wishes');

wishes.post(
  '/',
  { summary: 'Send a birthday wish (text, media, voice or card)', auth: 'user', body: sendBirthdayMessageSchema, status: 201 },
  async ({ userId, auth, body }) => wishService.sendBirthdayMessage(userId, body, auth?.isPremium ?? false),
);

wishes.get(
  '/received',
  {
    summary: 'Your wish inbox',
    auth: 'user',
    query: z.object({
      celebrationYear: z.coerce.number().int().min(1900).max(2200).optional(),
      cursor: z.string().max(256).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
  },
  async ({ userId, query }) => wishService.listReceivedWishes(userId, query),
);

wishes.get('/sent', { summary: 'Wishes you sent', auth: 'user' }, async ({ userId }) => wishService.listSentWishes(userId));

wishes.post(
  '/read',
  { summary: 'Mark wishes as read', auth: 'user', body: markNotificationsReadSchema },
  async ({ userId, body }) => ({ updated: await wishService.markWishesRead(userId, body.all ? undefined : body.ids) }),
);

wishes.post(
  '/:id/reactions',
  { summary: 'React to a wish', auth: 'user', params: idParams, body: reactToMessageSchema, status: 204 },
  async ({ userId, params, body }) => wishService.reactToWish(userId, params.id, body),
);

wishes.delete(
  '/:id/reactions/:emoji',
  { summary: 'Remove a reaction', auth: 'user', params: idParams.extend({ emoji: z.string().min(1).max(16) }), status: 204 },
  async ({ userId, params }) => wishService.removeWishReaction(userId, params.id, params.emoji),
);

wishes.delete(
  '/:id',
  { summary: 'Delete a wish you sent (or hide one you received)', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => wishService.deleteWish(userId, params.id),
);

export const cards = createModule('/cards', 'Wishes');

cards.get('/templates', { summary: 'Birthday card templates', auth: 'optional' }, async ({ auth }) => wishService.listCardTemplates(auth?.isPremium ?? false));
cards.get('/styles', { summary: 'Card styles', auth: 'public' }, async () => wishService.cardStyleCatalog());

cards.post(
  '/',
  { summary: 'Design a personalised card', auth: 'user', body: birthdayCardSchema, status: 201 },
  async ({ userId, auth, body }) => wishService.createStandaloneCard(userId, body, auth?.isPremium ?? false),
);

export const thankYous = createModule('/thank-yous', 'Wishes');

thankYous.post(
  '/',
  { summary: 'Thank someone for a gift', auth: 'user', body: sendThankYouSchema, status: 201 },
  async ({ userId, body }) => wishService.sendThankYou(userId, body),
);

thankYous.get(
  '/',
  { summary: 'Thank-yous received or sent', auth: 'user', query: z.object({ direction: z.enum(['RECEIVED', 'SENT']).default('RECEIVED') }) },
  async ({ userId, query }) => wishService.listThankYous(userId, query.direction),
);

/* ---------------------------- memories & history ---------------------------- */

export const memories = createModule('/memories', 'Memories');

memories.post(
  '/',
  { summary: 'Save a birthday memory for a year (adds to it if it exists)', auth: 'user', body: createMemorySchema, status: 201 },
  async ({ userId, body }) => memoryService.createOrUpdateMemory(userId, body),
);

memories.get('/', { summary: 'Your birthday history', auth: 'user' }, async ({ userId }) => memoryService.listMemories(userId, userId));

memories.get(
  '/:id',
  { summary: 'One year of memories', auth: 'user', params: idParams },
  async ({ userId, params }) => memoryService.getMemory(userId, params.id),
);

memories.patch(
  '/:id',
  { summary: 'Edit a memory', auth: 'user', params: idParams, body: updateMemorySchema },
  async ({ userId, params, body }) => memoryService.updateMemory(userId, params.id, body),
);

memories.delete(
  '/:id',
  { summary: 'Delete a memory', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => memoryService.deleteMemory(userId, params.id),
);

memories.delete(
  '/media/:id',
  { summary: 'Remove a photo or video from a memory', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => memoryService.deleteMemoryMedia(userId, params.id),
);

export const giftHistory = createModule('/gift-history', 'Memories');

giftHistory.get(
  '/',
  {
    summary: 'Your private gift history',
    auth: 'user',
    query: z.object({
      direction: z.enum(['RECEIVED', 'SENT']).optional(),
      year: z.coerce.number().int().min(1900).max(2200).optional(),
      counterpartyId: idSchema.optional(),
    }),
  },
  async ({ userId, query }) => memoryService.listMyGiftHistory(userId, query),
);

giftHistory.post(
  '/',
  { summary: 'Record a gift by hand', auth: 'user', body: createGiftHistoryEntrySchema, status: 201 },
  async ({ userId, body }) => memoryService.createGiftHistoryEntry(userId, body),
);

giftHistory.delete(
  '/:id',
  { summary: 'Delete a hand-written history entry', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => memoryService.deleteGiftHistoryEntry(userId, params.id),
);
