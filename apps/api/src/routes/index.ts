import { Router } from 'express';
import type { ApiModule } from '../http/route';
import admin, { adminNotificationAlias } from './admin.routes';
import auth from './auth.routes';
import { birthdays, friendGroups, friends, invites } from './birthday.routes';
import { addresses, catalog, orders, payments, products, vendor } from './commerce.routes';
import {
  cards,
  contributions,
  digitalGifts,
  giftHistory,
  groupGifts,
  memories,
  surprises,
  thankYous,
  wallet,
  wishes,
} from './gifting.routes';
import {
  ai,
  analytics,
  chatActions,
  conversations,
  events,
  home,
  notifications,
  reports,
  rsvpLinks,
  search,
  uploads,
} from './social.routes';
import users, { interests } from './user.routes';
import { globalBirthdays } from './global.routes';
import { gifts, wishlistItems, wishlists } from './wishlist.routes';

/**
 * Mount order matters where prefixes overlap: `/gifts/group` must be matched
 * before `/gifts/:id/reserve`, and the admin `POST /notifications` alias sits
 * after the user notification routes it shares a prefix with.
 */
export const modules: ApiModule[] = [
  auth,
  users,
  interests,
  home,
  birthdays,
  invites,
  friends,
  friendGroups,
  wishlists,
  wishlistItems,
  groupGifts,
  contributions,
  gifts,
  surprises,
  digitalGifts,
  wallet,
  wishes,
  globalBirthdays,
  cards,
  thankYous,
  memories,
  giftHistory,
  products,
  catalog,
  vendor,
  orders,
  addresses,
  payments,
  events,
  rsvpLinks,
  conversations,
  chatActions,
  notifications,
  adminNotificationAlias,
  ai,
  search,
  uploads,
  reports,
  analytics,
  admin,
];

export function buildApiRouter(): Router {
  const router = Router();
  for (const module of modules) {
    router.use(module.prefix || '/', module.router);
  }
  return router;
}
