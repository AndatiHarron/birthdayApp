import { cheerSchema, globalTodayQuerySchema, updateGlobalSettingsSchema } from '@bday/shared';
import { idParams } from '../http/params';
import { createModule } from '../http/route';
import { cheerLimiter } from '../middleware/rateLimit';
import * as globalService from '../services/global.service';

/** Global birthdays: celebrate anyone in the world whose birthday is today. */
export const globalBirthdays = createModule('/global', 'Global birthdays');

globalBirthdays.get(
  '/me',
  { summary: 'My global-birthdays settings, eligibility and how celebrated I have been', auth: 'user' },
  async ({ userId }) => globalService.getGlobalStatus(userId),
);

globalBirthdays.put(
  '/me',
  { summary: 'Opt in or out, and set what strangers see (adults only)', auth: 'user', body: updateGlobalSettingsSchema },
  async ({ userId, body }) => globalService.updateGlobalSettings(userId, body),
);

globalBirthdays.get(
  '/today',
  { summary: 'Everyone opted in whose birthday is today where they live, least celebrated first', auth: 'user', query: globalTodayQuerySchema },
  async ({ userId, query }) => globalService.listCelebratingToday(userId, query),
);

globalBirthdays.get(
  '/twins',
  { summary: 'People who share your birthday, anywhere in the world', auth: 'user' },
  async ({ userId }) => globalService.listBirthdayTwins(userId),
);

globalBirthdays.post(
  '/:id/cheer',
  {
    summary: 'Cheer someone on their birthday (once per person per year)',
    auth: 'user',
    params: idParams,
    body: cheerSchema,
    middleware: [cheerLimiter],
  },
  async ({ userId, params, body }) => globalService.cheer(userId, params.id, body),
);
