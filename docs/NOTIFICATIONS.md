# Notifications

## How delivery works

Every notification is **saved first and delivered second** ([`notification.service.ts`](../apps/api/src/services/notification.service.ts)):

1. A `notifications` row is created, so it always shows in the in-app list (the bell) and reaches connected clients live as `notification.created`.
2. Then a push is sent, unless the user has turned push off, muted that type, or it's within their quiet hours.

Because of this, a muted type or a failed push never loses the notification: the user can still find it in the app.

| Channel | Used for |
|---|---|
| In-app + realtime | Every notification |
| Push (Expo → APNs/FCM) | Every notification, subject to preferences |
| SMS | OTP codes only |
| Email | OTP and verification codes only |

Users have `emailEnabled` and `smsEnabled` settings, but **notifications aren't sent by email or SMS yet**. Only codes use those channels.

## User preferences (spec §21, §58 rule 7)

Stored per user in `notification_preferences`, and editable in the app under **Settings → Notifications**:

- **Reminder schedule:** any of 60, 30, 21, 14, 7, 5, 3, 2, 1 or 0 days before. Default: 30, 14, 7, 3, 1 and birthday morning.
- **Per-person override** on each tracked birthday (for example, only 14 days before Sarah's).
- Push on or off, **muted types**, **quiet hours**, time zone (default `Africa/Nairobi`), and the **digest hour** for "birthday morning" (default 08:00 local).

## Birthday reminders

The `birthday-reminders` job (`REMINDER_CRON`, every 15 minutes) finds users whose local time is past their digest hour, and sends each reminder that falls due today. Each reminder is sent **exactly once**, even with several workers or a restart partway through. This works by claiming a unique `reminder:<birthday>:<year>:<offset>` row before sending. People born on 29 February are celebrated on 28 February in non-leap years.

**Surprise secrecy:** the birthday person is never notified about reservations, contributions or surprise planning for their own birthday.

## Push setup (Expo)

The API sends pushes through Expo's push service, which forwards them to Apple (APNs) and Google (FCM). You manage one set of credentials instead of two.

1. **Create an EAS project** from `apps/mobile`:
   ```bash
   npm install -g eas-cli
   eas login
   eas init            # writes expo.extra.eas.projectId into app.json
   ```
   `app.json` currently has an empty `projectId`, so **push tokens can't be issued until this is done.**
2. **Android:** create a Firebase project, add the Android app (package name from `app.json`), and upload the FCM V1 service-account key: `eas credentials` → Android → Push Notifications.
3. **iOS:** `eas credentials` creates the APNs key for you (needs a paid Apple Developer account).
4. **Build a development build** (`eas build --profile development`). **Expo Go has not supported remote push on Android since SDK 53**, so testing push needs a development build.
5. Optionally set `EXPO_ACCESS_TOKEN` on the API if you turn on "enhanced push security" in your Expo account.

The app registers its push token on sign-in (`POST /users/me/push-tokens`) and removes it on sign-out. Tokens that Expo reports as unregistered are deleted automatically.

## SMS (OTP)

| `SMS_DRIVER` | Setup |
|---|---|
| `console` (default) | Logs `[sms] would send` with the code. Development only |
| `africastalking` | `AT_API_KEY`, `AT_USERNAME`, optional `AT_SENDER_ID`. Best choice for Kenyan traffic |
| `twilio` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |

## Email (OTP and verification)

| `EMAIL_DRIVER` | Setup |
|---|---|
| `console` (default) | Logs the message |
| `resend` | `RESEND_API_KEY`, and `EMAIL_FROM` on a domain verified in Resend |
| `smtp` | **Not implemented.** Fails at send time with an explanatory error |

## Admin broadcasts

Admins can send a system notification to all users or a segment from **Broadcast** in the dashboard. It goes through the same pipeline and respects the same preferences.
