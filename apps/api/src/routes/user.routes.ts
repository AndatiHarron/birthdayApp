import {
  blockUserSchema,
  completeOnboardingSchema,
  deleteAccountSchema,
  idSchema,
  notificationPreferencesSchema,
  privacySettingsSchema,
  registerPushTokenSchema,
  updateProfileSchema,
  userSearchSchema,
} from '@bday/shared';
import { z } from 'zod';
import { idParams } from '../http/params';
import { createModule } from '../http/route';
import { searchLimiter } from '../middleware/rateLimit';
import { listGiftHistoryFor, listMemories } from '../services/memory.service';
import * as userService from '../services/user.service';
import { getUserWishlist } from '../services/wishlist.service';

const users = createModule('/users', 'Users');

users.get('/me', { summary: 'The signed-in account', auth: 'user' }, async ({ userId }) => userService.getCurrentUser(userId));

users.put(
  '/me',
  { summary: 'Update profile (alias of PATCH)', auth: 'user', body: updateProfileSchema },
  async ({ userId, body }) => userService.updateProfile(userId, body),
);

users.patch(
  '/me',
  { summary: 'Update profile, birthday, interests and gift preferences', auth: 'user', body: updateProfileSchema },
  async ({ userId, body }) => userService.updateProfile(userId, body),
);

users.post(
  '/me/onboarding',
  { summary: 'Finish onboarding (birthday, interests, permissions)', auth: 'user', body: completeOnboardingSchema },
  async ({ userId, body }) => userService.completeOnboarding(userId, body),
);

users.put(
  '/me/privacy',
  { summary: 'Update privacy controls', auth: 'user', body: privacySettingsSchema },
  async ({ userId, body }) => userService.updatePrivacy(userId, body),
);

users.put(
  '/me/notification-preferences',
  { summary: 'Update reminder ladder, channels and muted types', auth: 'user', body: notificationPreferencesSchema },
  async ({ userId, body }) => userService.updateNotificationPreferences(userId, body),
);

users.post(
  '/me/push-tokens',
  { summary: 'Register an Expo push token for this device', auth: 'user', body: registerPushTokenSchema, status: 204 },
  async ({ userId, body }) => userService.registerPushToken(userId, body),
);

users.delete(
  '/me/push-tokens',
  { summary: 'Forget a push token (on sign-out)', auth: 'user', body: z.object({ token: z.string().trim().min(8).max(256) }), status: 204 },
  async ({ userId, body }) => userService.removePushToken(userId, body.token),
);

users.get('/me/export', { summary: 'Download all personal data (JSON)', auth: 'user' }, async ({ userId }) => userService.exportAccountData(userId));

users.post('/me/deactivate', { summary: 'Deactivate the account', auth: 'user', status: 204 }, async ({ userId }) => userService.deactivateAccount(userId));

users.delete(
  '/me',
  { summary: 'Permanently delete the account', auth: 'user', body: deleteAccountSchema, status: 204 },
  async ({ userId, body }) => userService.deleteAccount(userId, body),
);

users.get(
  '/search',
  { summary: 'Find people by name, username, phone or email', auth: 'user', query: userSearchSchema, middleware: [searchLimiter] },
  async ({ userId, query }) => userService.searchUsers(userId, query),
);

users.get('/blocked', { summary: 'People you have blocked', auth: 'user' }, async ({ userId }) => userService.listBlockedUsers(userId));

users.post(
  '/block',
  { summary: 'Block someone', auth: 'user', body: blockUserSchema, status: 204 },
  async ({ userId, body }) => userService.blockUser(userId, body),
);

users.delete(
  '/block/:id',
  { summary: 'Unblock someone', auth: 'user', params: idParams, status: 204 },
  async ({ userId, params }) => userService.unblockUser(userId, params.id),
);

users.get(
  '/by-username/:username',
  { summary: 'Public profile by username', auth: 'optional', params: z.object({ username: z.string().trim().toLowerCase().min(3).max(40) }) },
  async ({ auth, params }) => userService.getPublicProfile(auth?.userId ?? null, { username: params.username }),
);

users.get(
  '/:id',
  { summary: 'Public profile, filtered by privacy', auth: 'optional', params: z.object({ id: idSchema }) },
  async ({ auth, params }) => userService.getPublicProfile(auth?.userId ?? null, { userId: params.id }),
);

users.get(
  '/:id/wishlist',
  { summary: 'Someone’s default wishlist (reservations hidden from the owner)', auth: 'optional', params: idParams },
  async ({ auth, params }) => getUserWishlist(auth?.userId ?? null, params.id),
);

users.get(
  '/:id/memories',
  { summary: 'Birthday history by year', auth: 'user', params: idParams },
  async ({ userId, params }) => listMemories(userId, params.id),
);

users.get(
  '/:id/gift-history',
  { summary: 'Someone’s gift history, if they share it', auth: 'user', params: idParams },
  async ({ userId, params }) => listGiftHistoryFor(userId, params.id),
);

export const interests = createModule('/interests', 'Users');
interests.get('/', { summary: 'Interest catalogue for onboarding', auth: 'public' }, async () => userService.listInterests());

export default users;
