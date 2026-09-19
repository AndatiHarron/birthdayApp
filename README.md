# Birthday Gifting App

> Never forget a birthday. Never guess the perfect gift. Make every birthday memorable.

A birthday calendar, social network, wishlist, gift marketplace, AI gift assistant, digital cards and group gifting platform in one app.

| Part | Path | Stack |
|---|---|---|
| API | [`apps/api`](apps/api) | Node 20+, Express, Prisma, PostgreSQL, Socket.IO, node-cron |
| Mobile app | [`apps/mobile`](apps/mobile) | Expo SDK 57, React Native, Expo Router, TanStack Query |
| Admin dashboard | [`apps/admin`](apps/admin) | Vite, React, React Router, Recharts |
| Shared package | [`packages/shared`](packages/shared) | Zod schemas, enums, error codes, money/birthday/delivery helpers |

The mobile app is not an npm workspace (Expo needs its own `node_modules`), so it has its own `package-lock.json`.

## Quick start

**Needs:** Node 20 or newer and npm. Docker is optional.

```bash
# 1. Install and build the shared package
npm run setup
cd apps/mobile && npm install && cd ../..

# 2. Create env files (then edit apps/api/.env; see docs/ENVIRONMENT.md)
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/mobile/.env.example apps/mobile/.env
```

In `apps/api/.env`, replace both `JWT_*_SECRET` values with fresh random strings:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

To get an admin login, also set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (at least 12 characters).

### 3. Start a database: pick one

**With Docker:**

```bash
docker compose up -d          # Postgres :5432, Redis :6379, MinIO :9000/:9001
```

**Without Docker** (Windows without WSL, or Docker unavailable):

```bash
npm run db:local              # embedded Postgres on :5433, keep this terminal open
```

Then in `apps/api/.env`, set the port in `DATABASE_URL` to `5433` and comment out `REDIS_URL`. Redis is optional on a single machine. Port 5433 is used so it never clashes with a Postgres you already have installed on 5432.

### 4. Migrate, seed, run

```bash
npm run db:deploy             # apply migrations
npm run db:seed               # interests, gift categories, card templates, admin user

npm run dev:api               # http://localhost:4000       API docs: /docs
npm run dev:admin             # http://localhost:5174       admin dashboard
npm run dev:mobile            # Expo; open in Expo Go or a simulator
```

**On a physical phone:** set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your computer's LAN IP (for example `http://192.168.1.20:4000`), not `localhost`. The phone and the computer must be on the same network. The Android emulator uses `http://10.0.2.2:4000`.

## Scripts (repo root)

| Script | What it does |
|---|---|
| `npm run setup` | Install workspace deps, build `@bday/shared`, generate the Prisma client |
| `npm run dev:api` / `dev:admin` / `dev:mobile` | Dev servers |
| `npm run db:local` | Embedded Postgres on :5433 (no Docker) |
| `npm run db:migrate` | Create a new migration from `schema.prisma` changes (dev only) |
| `npm run db:deploy` | Apply pending migrations (dev, CI, production) |
| `npm run db:seed` | Idempotent reference data and optional super admin |
| `npm run db:reset` | Drop, re-migrate and re-seed (**destroys data**) |
| `npm run db:studio` | Prisma Studio, a browser UI for the database |
| `npm test` | API unit and integration tests. Needs no database: one starts automatically |
| `npm run typecheck` | Typecheck shared, API and admin |
| `npm run build` | Production build of shared, API and admin |
| `npm run openapi -w @bday/api` | Regenerate `docs/openapi.json` and `docs/openapi.yaml` |

## Documentation

| Doc | Contents |
|---|---|
| [docs/TESTING.md](docs/TESTING.md) | Automated tests and a step-by-step manual test script |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable for the API, admin and mobile app |
| [docs/API.md](docs/API.md) | Conventions, auth, errors, pagination, realtime events, webhooks |
| [docs/PAYMENTS.md](docs/PAYMENTS.md) | Payment architecture, sandbox mode, M-Pesa and Stripe setup |
| [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) | Push, SMS, email and birthday reminders |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment of the API, worker, admin and mobile builds |
| [docs/openapi.yaml](docs/openapi.yaml) | Full machine-readable API reference (also live at `/docs` and `/openapi.json`) |

## Core business rules

These are enforced on the server and covered by tests:

1. **No duplicate gifts.** Once an item is reserved, a second reservation fails with `GIFT_ALREADY_RESERVED`.
2. **The birthday person never sees secret reservations**, contributors or surprise planning until the gift is revealed.
3. **The wishlist owner controls visibility** (public, friends or private).
4. **Every group-gift contribution has a payment record.**
5. **Payment success comes only from the provider,** through a server-side verify or a signed webhook. A client's "paid" is never trusted.
6. **Delivery status is tracked** as Pending → Processing → Dispatched → Out for delivery → Delivered.
7. **Notifications respect user settings.**
8. **Global birthdays are opt-in and adults only.** Strangers can cheer, wish and send digital gifts (money included, capped per gift and per day) to people who opted in. **Physical gifts (orders, wishlist reservations, group gifts) are only between connected people.**
