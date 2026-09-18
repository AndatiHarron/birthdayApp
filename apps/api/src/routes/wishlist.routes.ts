import {
  createWishlistSchema,
  reorderWishlistItemsSchema,
  reserveItemSchema,
  unfurlUrlSchema,
  updateReservationSchema,
  updateWishlistItemSchema,
  updateWishlistSchema,
  wishlistItemSchema,
} from '@bday/shared';
import QRCode from 'qrcode';
import { z } from 'zod';
import { idParams } from '../http/params';
import { createModule } from '../http/route';
import { unfurlLimiter } from '../middleware/rateLimit';
import * as reservationService from '../services/reservation.service';
import { unfurlProductUrl } from '../services/unfurl.service';
import * as wishlistService from '../services/wishlist.service';

/* -------------------------------- wishlists -------------------------------- */

export const wishlists = createModule('/wishlists', 'Wishlists');

wishlists.get('/mine', { summary: 'Your wishlists', auth: 'user' }, async ({ userId }) => wishlistService.listMyWishlists(userId));

wishlists.post(
  '/',
  { summary: 'Create a wishlist', auth: 'user', body: createWishlistSchema, status: 201 },
  async ({ userId, body }) => wishlistService.createWishlist(userId, body),
);

wishlists.get(
  '/share/:slug',
  { summary: 'Open a shared wishlist link (app.com/wishlist/…)', auth: 'optional', params: z.object({ slug: z.string().trim().min(4).max(40) }) },
  async ({ auth, params }) => wishlistService.getWishlistBySlug(auth?.userId ?? null, params.slug),
);

wishlists.get(
  '/:id',
  { summary: 'A wishlist with items as the viewer may see them', auth: 'optional', params: idParams },
  async ({ auth, params }) => wishlistService.getWishlist(auth?.userId ?? null, params.id),
);

wishlists.patch(
  '/:id',
  { summary: 'Rename or change visibility', auth: 'user', params: idParams, body: updateWishlistSchema },
  async ({ userId, params, body }) => wishlistService.updateWishlist(userId, params.id, body),
);

wishlists.delete(
  '/:id',
  { summary: 'Delete a wishlist', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => wishlistService.deleteWishlist(userId, params.id),
);

wishlists.post(
  '/:id/share/rotate',
  { summary: 'Issue a new share link, invalidating the old one', auth: 'user', params: idParams },
  async ({ userId, params }) => wishlistService.rotateShareSlug(userId, params.id),
);

wishlists.get(
  '/:id/share',
  { summary: 'Share link and QR code for a wishlist', auth: 'user', params: idParams },
  async ({ userId, params }) => {
    const wishlist = await wishlistService.getWishlist(userId, params.id);
    const qrDataUrl = await QRCode.toDataURL(wishlist.shareUrl, { margin: 1, width: 512 });
    return {
      shareUrl: wishlist.shareUrl,
      qrDataUrl,
      message: `🎁 Here's my birthday wishlist: ${wishlist.shareUrl}`,
      visibility: wishlist.visibility,
    };
  },
);

wishlists.post(
  '/:id/reorder',
  { summary: 'Reorder items', auth: 'user', params: idParams, body: reorderWishlistItemsSchema, status: 204 },
  async ({ userId, params, body }) => wishlistService.reorderWishlistItems(userId, params.id, body),
);

/* ------------------------------ wishlist items ------------------------------ */

export const wishlistItems = createModule('/wishlist', 'Wishlists');

wishlistItems.post(
  '/items',
  { summary: 'Add a wishlist item', auth: 'user', body: wishlistItemSchema, status: 201 },
  async ({ userId, body }) => wishlistService.addWishlistItem(userId, body),
);

wishlistItems.post(
  '/unfurl',
  { summary: 'Read name, image and price from a product link', auth: 'user', body: unfurlUrlSchema, middleware: [unfurlLimiter] },
  async ({ body }) => unfurlProductUrl(body.url),
);

wishlistItems.get(
  '/items/:id',
  { summary: 'One wishlist item', auth: 'optional', params: idParams },
  async ({ auth, params }) => wishlistService.getWishlistItem(auth?.userId ?? null, params.id),
);

const updateItem = async ({ userId, params, body }: { userId: string; params: { id: string }; body: z.infer<typeof updateWishlistItemSchema> }) =>
  wishlistService.updateWishlistItem(userId, params.id, body);

wishlistItems.put('/items/:id', { summary: 'Edit a wishlist item', auth: 'user', params: idParams, body: updateWishlistItemSchema }, updateItem);
wishlistItems.patch('/items/:id', { summary: 'Edit a wishlist item', auth: 'user', params: idParams, body: updateWishlistItemSchema }, updateItem);

wishlistItems.delete(
  '/items/:id',
  { summary: 'Remove a wishlist item', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => wishlistService.deleteWishlistItem(userId, params.id),
);

wishlistItems.get(
  '/items/:id/reservations',
  { summary: 'Who is getting this (never available to the owner)', auth: 'user', params: idParams },
  async ({ userId, params }) => reservationService.listItemReservations(userId, params.id),
);

/* ------------------------------ reservations ------------------------------ */

export const gifts = createModule('/gifts', 'Gifts');

gifts.post(
  '/:id/reserve',
  {
    summary: '“I’ll get this” — reserve a wishlist item',
    description: 'Atomic: two people reserving the last unit at the same time cannot both succeed. Fails with GIFT_ALREADY_RESERVED.',
    auth: 'user',
    params: idParams,
    body: reserveItemSchema,
    status: 201,
  },
  async ({ userId, params, body }) => reservationService.reserveItem(userId, params.id, body),
);

gifts.get('/reservations', { summary: 'Gifts you have claimed', auth: 'user' }, async ({ userId }) => reservationService.listMyReservations(userId));

gifts.patch(
  '/reservations/:id',
  { summary: 'Mark a claimed gift purchased, delivered or cancelled', auth: 'user', params: idParams, body: updateReservationSchema, status: 204 },
  async ({ userId, params, body }) => reservationService.updateReservation(userId, params.id, body),
);

gifts.delete(
  '/reservations/:id',
  { summary: 'Release a claim', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => reservationService.cancelReservation(userId, params.id),
);

gifts.get('/received', { summary: 'Wishlist gifts that have been delivered to you', auth: 'user' }, async ({ userId }) => reservationService.listReceivedGifts(userId));
