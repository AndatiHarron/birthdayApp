import { z } from 'zod';
import { Visibility, WishlistItemPriority } from '../enums';
import {
  amountMinorSchema,
  currencySchema,
  idSchema,
  noteSchema,
  urlSchema,
} from './common';

export const createWishlistSchema = z.object({
  title: z.string().trim().min(1, 'Give your wishlist a name').max(60),
  description: noteSchema(500),
  visibility: z.nativeEnum(Visibility).default(Visibility.FRIENDS),
  isDefault: z.boolean().default(false),
});
export type CreateWishlistInput = z.infer<typeof createWishlistSchema>;

export const updateWishlistSchema = createWishlistSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateWishlistInput = z.infer<typeof updateWishlistSchema>;

export const wishlistItemSchema = z.object({
  wishlistId: idSchema.optional(),
  name: z.string().trim().min(1, 'What would you like?').max(140),
  description: noteSchema(1000),
  imageUrl: urlSchema.nullish(),
  priceMinor: amountMinorSchema.nullish(),
  currency: currencySchema.optional(),
  productUrl: urlSchema.nullish(),
  merchant: z.string().trim().max(80).nullish(),
  category: z.string().trim().max(60).nullish(),
  priority: z.nativeEnum(WishlistItemPriority).default(WishlistItemPriority.NICE_TO_HAVE),
  size: z.string().trim().max(40).nullish(),
  color: z.string().trim().max(40).nullish(),
  quantity: z.number().int().min(1).max(99).default(1),
  notes: noteSchema(500),
  preferredVendorId: idSchema.nullish(),
  /** Link the wish to a real catalogue product so gifters can buy in-app. */
  productId: idSchema.nullish(),
});
export type WishlistItemInput = z.infer<typeof wishlistItemSchema>;

export const updateWishlistItemSchema = wishlistItemSchema
  .omit({ wishlistId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateWishlistItemInput = z.infer<typeof updateWishlistItemSchema>;

export const reorderWishlistItemsSchema = z.object({
  /** Item ids in their new display order. */
  itemIds: z.array(idSchema).min(1).max(500),
});
export type ReorderWishlistItemsInput = z.infer<typeof reorderWishlistItemsSchema>;

export const unfurlUrlSchema = z.object({
  url: urlSchema,
});
export type UnfurlUrlInput = z.infer<typeof unfurlUrlSchema>;

/* --------------------------- reservations --------------------------- */

export const reserveItemSchema = z.object({
  quantity: z.number().int().min(1).max(99).default(1),
  /** Note visible to other gifters, never to the wishlist owner. */
  note: noteSchema(280),
  /** Hide the reserver's identity from other gifters too. */
  isAnonymous: z.boolean().default(false),
});
export type ReserveItemInput = z.infer<typeof reserveItemSchema>;

export const updateReservationSchema = z.object({
  status: z.enum(['PURCHASED', 'DELIVERED', 'CANCELLED']),
  note: noteSchema(280),
});
export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;

export const wishlistShareSchema = z.object({
  /** Rotate the public slug, invalidating previously shared links. */
  regenerate: z.boolean().default(false),
});
export type WishlistShareInput = z.infer<typeof wishlistShareSchema>;
