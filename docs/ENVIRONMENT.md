# Environment variables

Each app reads its own `.env` file. Copy the matching `.env.example` to start. `.env` files are git-ignored: never commit real values.

The API validates its whole configuration at startup ([`apps/api/src/config/env.ts`](../apps/api/src/config/env.ts)) and **refuses to boot** if anything required is missing or malformed. In production it also refuses `PAYMENTS_SANDBOX=true`, `OTP_DEBUG_ECHO=true`, and identical access and refresh secrets.

## API: `apps/api/.env`

**Req** means required. Everything else has a default or turns the feature off safely.

### Core
| Variable | Req | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | | `development` | `development`, `test` or `production` |
| `PORT` | | `4000` | |
| `HOST` | | `0.0.0.0` | |
| `LOG_LEVEL` | | `info` | `fatal` … `trace`, or `silent` |
| `API_BASE_URL` | | `http://localhost:4000` | Public URL of the API. Used in payment callback URLs, so it **must be public HTTPS in production** |
| `WEB_BASE_URL` | | `http://localhost:4000` | Origin for share links (wishlists, invites, RSVPs). The API serves those pages itself |
| `APP_DEEP_LINK_SCHEME` | | `bday` | Must match `scheme` in `apps/mobile/app.json` |

### Data
| Variable | Req | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | | PostgreSQL connection string. Docker: `...@localhost:5432/bday`. `npm run db:local`: `...@localhost:5433/bday` |
| `REDIS_URL` | | *unset* | Optional on one instance. **Required when running more than one API instance**, because it shares rate limits and websocket rooms |

### Auth
| Variable | Req | Default | Notes |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | ✅ | | 32 or more random characters |
| `JWT_REFRESH_SECRET` | ✅ | | 32 or more random characters, **different** from the access secret |
| `JWT_ACCESS_TTL_SECONDS` | | `900` | Access token lifetime (15 minutes) |
| `JWT_REFRESH_TTL_DAYS` | | `60` | Refresh tokens rotate on every use, and a replayed one is rejected |
| `JWT_ISSUER` | | `bday-api` | |
| `BCRYPT_ROUNDS` | | `12` | 10–15 |
| `OTP_TTL_SECONDS` | | `600` | |
| `OTP_RESEND_COOLDOWN_SECONDS` | | `60` | |
| `OTP_DEBUG_ECHO` | | `false` | `true` returns OTP codes in API responses. **Development only**; refused in production |
| `GOOGLE_CLIENT_IDS` | | | Comma-separated Google OAuth client IDs (web, iOS, Android) accepted for Google sign-in |
| `APPLE_CLIENT_IDS` | | | Bundle ID and/or Services ID accepted for Apple sign-in |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

### Security
| Variable | Default | Notes |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:19006` | Comma-separated browser origins. Add your admin and Expo web origins. Native apps send no Origin and are always allowed |
| `TRUST_PROXY` | `false` | Set `true` behind a load balancer or reverse proxy so rate limits see the real client IP |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Global limiter. Auth, OTP, payment, AI, upload, search and webhook routes have stricter built-in limits |
| `RATE_LIMIT_MAX` | `120` | Requests per window per client |

### Storage (profile photos, wishlist images, cards, media)
| Variable | Default | Notes |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` writes to disk and serves files at `/uploads`. `s3` uses any S3-compatible store (AWS S3, Cloudflare R2, MinIO…) |
| `STORAGE_LOCAL_DIR` | `./storage` | Local driver only. Not suitable for multiple instances |
| `STORAGE_PUBLIC_BASE_URL` | | CDN or public bucket URL files are served from |
| `S3_BUCKET` | | Required when `STORAGE_DRIVER=s3` |
| `S3_REGION` | | e.g. `us-east-1`, or `auto` for R2 |
| `S3_ENDPOINT` | | Only for non-AWS stores. MinIO from docker-compose: `http://localhost:9000` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | | |
| `S3_FORCE_PATH_STYLE` | `false` | `true` for MinIO |

Uploads are checked by their actual file bytes, not the declared content type.

### AI gift assistant
| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Without it the chat assistant returns `AI_UNAVAILABLE`. Gift matching (`/ai/gift-matches`) still works because it doesn't call a model |
| `ANTHROPIC_MODEL` | `claude-opus-5` | |
| `AI_MAX_OUTPUT_TOKENS` | `16000` | 1024–16000 |

### Payments (see [PAYMENTS.md](PAYMENTS.md))
| Variable | Default | Notes |
|---|---|---|
| `PAYMENTS_DEFAULT_CURRENCY` | `KES` | |
| `PAYMENTS_SANDBOX` | `true` | Simulated provider: payments settle on server-side verify. **Must be `false` in production** |
| `MPESA_ENV` | `sandbox` | `sandbox` or `production` (Daraja) |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | | From the Daraja portal |
| `MPESA_SHORTCODE` / `MPESA_PASSKEY` | | Paybill or till and its Lipa na M-Pesa passkey |
| `MPESA_CALLBACK_SECRET` | | Random string. Added to the callback URL because Daraja can't sign callbacks. **Required** for M-Pesa to be enabled |
| `STRIPE_SECRET_KEY` | | Card payments |
| `STRIPE_PUBLISHABLE_KEY` | | Sent to clients to confirm payments |
| `STRIPE_WEBHOOK_SECRET` | | `whsec_…` from your Stripe webhook endpoint |
| `PLATFORM_COMMISSION_BPS` | `1000` | Validated but **not used yet**. Commission is set per vendor in the admin dashboard (see [PAYMENTS.md](PAYMENTS.md#commission)) |

### Notifications (see [NOTIFICATIONS.md](NOTIFICATIONS.md))
| Variable | Default | Notes |
|---|---|---|
| `EXPO_ACCESS_TOKEN` | | Optional. Needed if "enhanced push security" is on in your Expo account |
| `SMS_DRIVER` | `console` | `console` (logs only), `africastalking` or `twilio` |
| `AT_API_KEY` / `AT_USERNAME` / `AT_SENDER_ID` | | Africa's Talking |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | | Twilio |
| `EMAIL_DRIVER` | `console` | `console` or `resend`. (`smtp` is declared but not implemented yet) |
| `EMAIL_FROM` | `Birthday App <hello@localhost>` | Must be a verified sender with your provider |
| `RESEND_API_KEY` | | |
| `SMTP_URL` | | Reserved for the future SMTP driver |

### Background jobs
| Variable | Default | Notes |
|---|---|---|
| `RUN_WORKERS_IN_PROCESS` | `true` | Runs the cron jobs inside the API process. Set `false` on API instances when you run a separate worker (`npm run worker`), or reminders go out twice |
| `REMINDER_CRON` | `*/15 * * * *` | Birthday reminders |
| `SCHEDULED_DELIVERY_CRON` | `*/5 * * * *` | Releases scheduled digital gifts |
| `PAYMENT_RECONCILE_CRON` | `*/10 * * * *` | Asks providers about payments still pending |

### Seed (`npm run db:seed`)
| Variable | Notes |
|---|---|
| `SEED_ADMIN_EMAIL` | If set together with the password, creates or promotes this user to `SUPER_ADMIN` |
| `SEED_ADMIN_PASSWORD` | At least 12 characters |
| `SEED_ADMIN_NAME` | Default `Administrator` |

## Admin dashboard: `apps/admin/.env`

| Variable | Notes |
|---|---|
| `VITE_API_URL` | Leave **empty in development**: Vite proxies `/api` to `127.0.0.1:4000`. In production, set the API's public URL (e.g. `https://api.example.com`) and add the dashboard's origin to the API's `CORS_ORIGINS` |

`VITE_*` values are compiled into the JavaScript bundle and are public. Never put secrets here.

## Mobile app: `apps/mobile/.env`

| Variable | Notes |
|---|---|
| `EXPO_PUBLIC_API_URL` | API base URL. Physical phone: your computer's **LAN IP** (`http://192.168.x.x:4000`). Android emulator: `http://10.0.2.2:4000`. iOS simulator or web: `http://localhost:4000` |
| `EXPO_PUBLIC_WEB_URL` | Origin used when showing share links |

`EXPO_PUBLIC_*` values are compiled into the app and are public. The EAS project ID for push goes in `app.json` → `expo.extra.eas.projectId` (see [NOTIFICATIONS.md](NOTIFICATIONS.md)).
