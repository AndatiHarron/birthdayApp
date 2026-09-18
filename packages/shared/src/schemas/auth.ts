import { z } from 'zod';
import { OtpPurpose } from '../enums';
import {
  birthdayInputSchema,
  displayNameSchema,
  emailSchema,
  idSchema,
  otpCodeSchema,
  passwordSchema,
  phoneSchema,
  timezoneSchema,
  usernameSchema,
} from './common';

export const deviceInfoSchema = z
  .object({
    deviceId: z.string().trim().min(4).max(128).optional(),
    platform: z.enum(['ios', 'android', 'web']).optional(),
    model: z.string().trim().max(64).optional(),
    osVersion: z.string().trim().max(32).optional(),
    appVersion: z.string().trim().max(32).optional(),
    pushToken: z.string().trim().max(256).optional(),
  })
  .optional();
export type DeviceInfoInput = z.infer<typeof deviceInfoSchema>;

/**
 * Registration accepts email or phone (at least one) — the OTP flow verifies
 * whichever was supplied. A password is optional for phone-first signups.
 */
export const registerSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema.optional(),
    displayName: displayNameSchema,
    username: usernameSchema.optional(),
    birthday: birthdayInputSchema.optional(),
    timezone: timezoneSchema.optional(),
    inviteCode: z.string().trim().max(32).optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You need to accept the terms to continue' }),
    }),
    device: deviceInfoSchema,
  })
  .refine((value) => value.email != null || value.phone != null, {
    message: 'Enter an email address or a phone number',
    path: ['email'],
  })
  .refine((value) => value.phone != null || value.password != null, {
    message: 'Choose a password',
    path: ['password'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    username: usernameSchema.optional(),
    password: z.string().min(1, 'Enter your password'),
    device: deviceInfoSchema,
  })
  .refine((value) => value.email != null || value.phone != null || value.username != null, {
    message: 'Enter your email, phone number or username',
    path: ['email'],
  });
export type LoginInput = z.infer<typeof loginSchema>;

export const requestOtpSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    purpose: z.nativeEnum(OtpPurpose),
  })
  .refine((value) => value.email != null || value.phone != null, {
    message: 'Enter an email address or a phone number',
    path: ['phone'],
  });
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  challengeId: idSchema,
  code: otpCodeSchema,
  device: deviceInfoSchema,
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const oauthSchema = z.object({
  provider: z.enum(['GOOGLE', 'APPLE']),
  /** Google: ID token. Apple: identity token from ASAuthorization. */
  idToken: z.string().min(16, 'Missing provider token').max(8192),
  /** Apple only supplies the name on first authorisation. */
  displayName: displayNameSchema.optional(),
  nonce: z.string().trim().max(128).optional(),
  device: deviceInfoSchema,
});
export type OauthInput = z.infer<typeof oauthSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(16).max(2048),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(16).max(2048).optional(),
  /** Sign out of every device rather than just this one. */
  allDevices: z.boolean().default(false),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

export const forgotPasswordSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .refine((value) => value.email != null || value.phone != null, {
    message: 'Enter an email address or a phone number',
    path: ['email'],
  });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  challengeId: idSchema,
  code: otpCodeSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').optional(),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const checkAvailabilitySchema = z
  .object({
    username: usernameSchema.optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .refine(
    (value) => value.username != null || value.email != null || value.phone != null,
    'Provide a username, email or phone number to check',
  );
export type CheckAvailabilityInput = z.infer<typeof checkAvailabilitySchema>;
