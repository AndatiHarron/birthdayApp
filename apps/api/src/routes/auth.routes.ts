import {
  acceptInviteSchema,
  changePasswordSchema,
  checkAvailabilitySchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  oauthSchema,
  refreshSchema,
  registerSchema,
  requestOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  type AuthSession,
} from '@bday/shared';
import { createModule } from '../http/route';
import { sessionContext } from '../http/params';
import { authLimiter, otpLimiter } from '../middleware/rateLimit';
import * as authService from '../services/auth.service';
import { rotateSession, revokeSession } from '../services/session.service';
import { getCurrentUser } from '../services/user.service';

const auth = createModule('/auth', 'Auth');

auth.post(
  '/register',
  {
    summary: 'Register with email+password or phone',
    description: 'Email signups get a session immediately plus a verification code. Phone-first signups return an OTP challenge; the account is created on verification.',
    auth: 'public',
    body: registerSchema,
    status: 201,
    middleware: [authLimiter],
  },
  async ({ req, body }) => authService.register(body, sessionContext(req, body.device)),
);

auth.post(
  '/login',
  { summary: 'Sign in with a password', auth: 'public', body: loginSchema, middleware: [authLimiter] },
  async ({ req, body }) => authService.login(body, sessionContext(req, body.device)),
);

auth.post(
  '/request-otp',
  { summary: 'Send a one-time code by SMS or email', auth: 'public', body: requestOtpSchema, middleware: [otpLimiter] },
  async ({ req, body }) => authService.requestOtp(body, sessionContext(req)),
);

auth.post(
  '/verify-otp',
  { summary: 'Verify a one-time code and sign in', auth: 'public', body: verifyOtpSchema, middleware: [authLimiter] },
  async ({ req, body }) => authService.verifyOtpAndSignIn(body, sessionContext(req, body.device)),
);

auth.post(
  '/oauth',
  { summary: 'Sign in with Google or Apple', auth: 'public', body: oauthSchema, middleware: [authLimiter] },
  async ({ req, body }) => authService.oauthSignIn(body, sessionContext(req, body.device)),
);

auth.post(
  '/refresh',
  { summary: 'Rotate a refresh token for a new session', auth: 'public', body: refreshSchema, middleware: [authLimiter] },
  async ({ req, body }): Promise<AuthSession> => {
    const { tokens, userId } = await rotateSession(body.refreshToken, sessionContext(req));
    const user = await getCurrentUser(userId);
    return { user, tokens, onboardingRequired: user.onboardingCompletedAt == null };
  },
);

auth.post(
  '/logout',
  { summary: 'Sign out of this device or every device', auth: 'optional', body: logoutSchema, status: 204 },
  async ({ body, auth: context }) => {
    if (body.allDevices && context) {
      await authService.logoutEverywhere(context.userId);
    } else if (body.refreshToken) {
      await revokeSession(body.refreshToken);
    }
  },
);

auth.post(
  '/forgot-password',
  { summary: 'Send a password reset code', auth: 'public', body: forgotPasswordSchema, middleware: [otpLimiter] },
  async ({ req, body }) => authService.forgotPassword(body, sessionContext(req)),
);

auth.post(
  '/reset-password',
  { summary: 'Reset a password with a code', auth: 'public', body: resetPasswordSchema, status: 204, middleware: [authLimiter] },
  async ({ body }) => authService.resetPassword(body),
);

auth.post(
  '/change-password',
  { summary: 'Change or set the password', auth: 'user', body: changePasswordSchema, status: 204, middleware: [authLimiter] },
  async ({ userId, body }) => authService.changePassword(userId, body),
);

auth.get(
  '/availability',
  { summary: 'Check whether a username, email or phone is free', auth: 'public', query: checkAvailabilitySchema, middleware: [authLimiter] },
  async ({ query }) => authService.checkAvailability(query),
);

auth.post(
  '/invites/redeem',
  { summary: 'Accept an invitation, linking the inviter’s calendar entry', auth: 'user', body: acceptInviteSchema, status: 204 },
  async ({ userId, body }) => authService.redeemInvite(body.code, userId),
);

export default auth;
