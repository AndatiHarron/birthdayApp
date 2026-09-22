# Production deployment

## What runs where

| Component | Runs as | Needs |
|---|---|---|
| **API** | Long-running Node 20+ process (`node dist/server.js`) | PostgreSQL, Redis if more than one instance, object storage, HTTPS |
| **Worker** | Separate Node process (`node dist/workers/index.js`) for cron jobs | Same env and database as the API |
| **Admin dashboard** | Static files (`apps/admin/dist`) on any static host or CDN | `VITE_API_URL` set at build time |
| **Mobile app** | Store builds through EAS | EAS project, store accounts |

Any Node host works: Render, Railway, Fly.io, a DigitalOcean VM, AWS ECS and so on. The steps below don't depend on the host.

## 1. Infrastructure

- **PostgreSQL 14+** (tested on 16), managed if possible, with automated backups turned on.
- **Redis 6+.** Required once you run **more than one API instance**, because it shares rate limits and websocket rooms.
- **S3-compatible bucket** (AWS S3, Cloudflare R2, DigitalOcean Spaces…) with `STORAGE_DRIVER=s3`. Don't use the local disk driver in production: files disappear on redeploy and aren't shared between instances.
- **HTTPS domain** for the API (for example `api.yourdomain.com`). M-Pesa and Stripe callbacks need public HTTPS.

## 2. Production environment

Start from [ENVIRONMENT.md](ENVIRONMENT.md). These must be set as shown, and the API refuses to start otherwise:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...          # use your provider's SSL settings
REDIS_URL=rediss://...
JWT_ACCESS_SECRET=<48 random bytes>
JWT_REFRESH_SECRET=<different 48 random bytes>
PAYMENTS_SANDBOX=false
OTP_DEBUG_ECHO=false
API_BASE_URL=https://api.yourdomain.com
WEB_BASE_URL=https://api.yourdomain.com   # share pages are served by the API
CORS_ORIGINS=https://admin.yourdomain.com
TRUST_PROXY=true                       # behind a load balancer
STORAGE_DRIVER=s3
S3_BUCKET=...
RUN_WORKERS_IN_PROCESS=false           # the separate worker runs the jobs
SMS_DRIVER=africastalking
EMAIL_DRIVER=resend
```

Plus the provider keys you use: M-Pesa, Stripe, Anthropic, Resend, Africa's Talking. Keep secrets in the host's secret manager, never in the repository.

## 3. Build

```bash
npm ci
npm run build          # shared → api (dist/) → admin (dist/)
npx prisma generate --schema apps/api/prisma/schema.prisma
```

The API's `dist/` needs `node_modules` (including the built `@bday/shared` workspace package) and `apps/api/public/` (card template images) next to it at runtime.

## 4. Database migrations

Run this **once per release, before starting the new API version**, as a release or pre-deploy step:

```bash
npm run db:deploy      # prisma migrate deploy: applies pending migrations only
npm run db:seed        # idempotent: reference data and optional SEED_ADMIN_* super admin
```

Never run `db:migrate` (dev only) or `db:reset` (destroys data) against production. To change the schema, run `npm run db:migrate` locally, which creates a new file in `apps/api/prisma/migrations/`, then commit it and let `db:deploy` apply it.

## 5. Start the processes

```bash
# API: scale horizontally (with Redis)
cd apps/api && node dist/server.js

# Worker: run exactly ONE instance
cd apps/api && node dist/workers/index.js
```

- **Health checks:** `GET /health` for liveness and `GET /ready` for readiness (database and Redis; returns 503 if either is down).
- The API shuts down cleanly on `SIGTERM`.
- To run a single job manually (e.g. a backfill): `node dist/workers/index.js --once birthday-reminders`. Jobs: `birthday-reminders`, `scheduled-deliveries`, `payment-reconciliation`, `expire-unpaid-orders`, `daily-cleanup`.
- The load balancer must allow **WebSocket upgrades** on `/realtime`.

## 6. Admin dashboard

```bash
VITE_API_URL=https://api.yourdomain.com npm run build -w @bday/admin
```

Upload `apps/admin/dist/` to a static host (Netlify, Vercel, Cloudflare Pages, S3 plus CloudFront). Set a fallback to `index.html` so client-side routes work, and add the dashboard's origin to the API's `CORS_ORIGINS`.

## 7. Payment and push callbacks

- **M-Pesa:** callbacks go to `https://api.yourdomain.com/api/v1/webhooks/payments/mpesa`, and the API adds the secret token itself. Complete Safaricom's go-live, then set `MPESA_ENV=production`. See [PAYMENTS.md](PAYMENTS.md).
- **Stripe:** register the webhook endpoint `https://api.yourdomain.com/api/v1/webhooks/payments/stripe`.
- **Push:** set up FCM and APNs credentials in EAS. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

## 8. Mobile app (Android and iOS)

`eas.json` is in the repo with three build profiles. What is missing is your own Expo account and project id, which only you can create:

```bash
cd apps/mobile
npx eas-cli login                  # your Expo account (free)
npx eas-cli init                   # writes expo.extra.eas.projectId into app.json — commit that
```

Then point the builds at your API. In [`apps/mobile/eas.json`](../apps/mobile/eas.json) replace the placeholder URLs:

| Profile | `EXPO_PUBLIC_API_URL` should be | Produces |
|---|---|---|
| `development` | your computer's LAN IP, e.g. `http://192.168.1.20:4000` | A dev build: like Expo Go, but with your own native modules |
| `preview` | your deployed API, e.g. `https://api.yourdomain.com` | An installable APK for testers |
| `production` | your deployed API | An `.aab` for Google Play, and a store build for iOS |

### Builds

```bash
npm run build:android              # preview APK — install on any Android phone
npm run build:android:prod         # .aab for Google Play
npm run build:ios                  # needs an Apple Developer account
npm run build:dev                  # dev build, for testing native modules locally
```

Builds run on Expo's servers, so this works from Windows, including for iOS.

**What each platform costs and allows:**

- **Android:** free to build and install. `npm run build:android` gives you a link to an APK anyone can install directly. Google Play needs a one-off $25 account.
- **iOS:** installing on a real iPhone needs the **Apple Developer Program ($99/year)** — that is Apple's rule, not Expo's. Without it, iPhone testing means Expo Go on the same Wi-Fi as your computer.

### Over-the-air updates

After a build is installed, JavaScript-only changes ship without a new build or store review:

```bash
npm run update                     # publishes to the preview branch
```

Native changes — a new Expo SDK, a new native module, changed permissions — still need a rebuild.

### Before the first store upload

The identifiers are `app.birthday.gifting` (iOS bundle id and Android package) and the deep-link scheme is `bday`. **Change them to your own domain before the first upload**, because they cannot be changed afterwards.

## 9. Before going live

- [ ] `PAYMENTS_SANDBOX=false` and `OTP_DEBUG_ECHO=false`; the API enforces both
- [ ] A real M-Pesa or Stripe payment and refund tested end to end
- [ ] Database backups on, and a test restore done
- [ ] Exactly one worker running, with `RUN_WORKERS_IN_PROCESS=false` on API instances
- [ ] Redis configured if there's more than one API instance
- [ ] S3 storage configured and an image upload tested
- [ ] Privacy policy and terms (`/privacy`, `/terms`) reviewed for your company and jurisdiction (Kenya Data Protection Act 2019)
- [ ] Log aggregation and error alerts set up (the API logs structured JSON to stdout)
- [ ] App identifiers, app name and icons finalised
