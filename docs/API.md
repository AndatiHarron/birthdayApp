# API

- **Interactive reference:** `http://localhost:4000/docs` (Swagger UI) while the API runs
- **Spec files:** [`openapi.yaml`](openapi.yaml) and [`openapi.json`](openapi.json), plus `GET /openapi.json` on a running server. Regenerate with `npm run openapi -w @bday/api` after changing routes.

The spec is built from the same route definitions and Zod schemas that validate requests ([`apps/api/src/http/route.ts`](../apps/api/src/http/route.ts)), so it can't fall out of sync with the code.

## Basics

| | |
|---|---|
| Base path | `/api/v1` |
| Format | JSON (`Content-Type: application/json`); uploads use `multipart/form-data` |
| Auth | `Authorization: Bearer <accessToken>` |
| Health | `GET /health` (process up) · `GET /ready` (database and, if configured, Redis reachable; 503 otherwise) |

### Response envelope

Success:

```json
{ "success": true, "data": { }, "meta": { "nextCursor": "…" } }
```

Failure. The HTTP status matches the error, and `code` is stable, so clients can branch on it:

```json
{
  "success": false,
  "message": "Unable to reserve this gift.",
  "code": "GIFT_ALREADY_RESERVED",
  "errors": { "body.priceMinor": ["Must be positive"] },
  "requestId": "2c268020-…"
}
```

`errors` appears only on `VALIDATION_ERROR` (422). The full list of codes and their friendly messages is in [`packages/shared/src/errors.ts`](../packages/shared/src/errors.ts). Include `requestId` when reporting a problem; it matches the server log line.

### Money

Amounts are **integers in minor units** plus an ISO currency: `"priceMinor": 850000, "currency": "KES"` means KES 8,500.00. There are no floats anywhere.

### Pagination

List endpoints that can grow use cursors: `?limit=20&cursor=<nextCursor>`, returning `{ items, nextCursor, total? }`. A `nextCursor` of `null` means the last page.

### Idempotency

`POST /orders` and payment creation take an `idempotencyKey`. Retrying with the same key returns the original result instead of creating a duplicate order.

## Auth flow

1. `POST /auth/register` → `{ kind: "SESSION", session: { user, tokens }, verification: { challengeId, … } }`
2. `POST /auth/verify-otp` with `{ challengeId, code }` verifies the email or phone
3. `POST /auth/login` with email, phone or username plus password
4. `POST /auth/oauth` with `{ provider: "GOOGLE" | "APPLE", idToken }`. The server verifies the token against `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS`
5. `POST /auth/refresh` with `{ refreshToken }` rotates the refresh token. **Reusing an old one revokes the session**
6. `POST /auth/logout`

Access tokens expire after 15 minutes by default, and clients refresh them automatically.

## Route groups

| Prefix | Purpose |
|---|---|
| `/auth` | Register, login, OTP, OAuth, refresh, password reset |
| `/users` | Me, onboarding, privacy, notification preferences, push tokens, export, delete, search, block |
| `/home` | Home feed in one request |
| `/birthdays` | Upcoming, calendar, tracked birthdays, contact import |
| `/friends`, `/friend-groups`, `/invites` | Connections, custom groups, invite links and QR codes |
| `/wishlists`, `/wishlist/items` | Wishlists, items, product-URL unfurl, share links |
| `/gifts` | Reserve (`POST /gifts/:itemId/reserve`), my reservations, gifts received |
| `/gifts/group` | Group gifts: create, invite, contribute, reveal |
| `/surprises` | Secret planning groups (never include the birthday person) |
| `/digital-gifts`, `/wallet` | Digital gifts, wallet balance and ledger |
| `/birthday-messages`, `/cards`, `/thank-yous` | Wishes, card templates, thank-yous |
| `/memories`, `/gift-history` | Birthday memories and gift history |
| `/products`, `/categories`, `/shelves`, `/vendors`, `/promotions`, `/coupons/validate` | Marketplace catalogue |
| `/vendor` | Vendor self-service: apply, products, orders, delivery updates |
| `/orders`, `/addresses`, `/payments` | Checkout, delivery addresses, payments |
| `/events`, `/rsvp` | Events, guests, RSVP, `.ics` calendar file |
| `/conversations`, `/polls`, `/messages` | Chat |
| `/notifications` | In-app notifications |
| `/ai` | Gift suggestions (LLM) and gift matching (rules-based) |
| `/search` | Global search |
| `/global` | Global birthdays: `GET/PUT /me` (opt in; adults only), `GET /today` (celebrating now, least celebrated first), `GET /twins`, `POST /:userId/cheer` |
| `/uploads/:kind` | File uploads. `wish` accepts photos, GIFs and video (64MB) for the wish wall |
| `/reports`, `/analytics/events` | User reports, product analytics |
| `/admin/*` | Admin only (`ADMIN` or `SUPER_ADMIN`) |

## Public pages (HTML, no `/api/v1` prefix)

Rendered by the API for sharing, with no login needed:

| Path | Page |
|---|---|
| `/@username` | Link-in-bio page: profile, birthday countdown and wishlist, with link-preview tags. Only when the owner published it. **Never shows reservation data, contacts, birth year or address** |
| `/wishlist/:slug` | Shared wishlist. **Never shows reservation data** |
| `/rsvp/:token` | Guest RSVP without an account |
| `/invite/:code` | Invitation landing page |
| `/privacy`, `/terms` | Legal pages |

## Realtime (Socket.IO)

Connect to path `/realtime` with the access token:

```ts
import { io } from 'socket.io-client';
const socket = io(API_URL, { path: '/realtime', auth: { token: accessToken } });
socket.emit('subscribe', { room: 'wishlist', id: wishlistId }, (ack) => { /* { ok, room } */ });
```

Each user automatically joins their own room. Joining a wishlist, group gift, conversation, order or event room is **authorised on the server with the same rules as the REST API**, so a birthday person can't subscribe to their own surprise.

Events: `wishlist.item.added` · `wishlist.item.updated` · `wishlist.item.removed` · `reservation.changed` · `notification.created` · `chat.message.created` · `chat.typing` · `order.updated` · `delivery.updated` · `payment.updated` · `event.rsvp.updated`

Without `REDIS_URL`, events reach only clients connected to the same API instance.

## Webhooks

`POST /api/v1/webhooks/payments/:provider`, where `:provider` is `mpesa`, `stripe` or `sandbox`. The request body is kept raw for signature checks, and replays are ignored by event ID. See [PAYMENTS.md](PAYMENTS.md).
