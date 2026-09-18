# Testing

## Automated tests

```bash
npm test                      # API unit and integration tests
npm run typecheck             # shared, API, admin
cd apps/mobile && npx tsc --noEmit
```

The integration tests run against a real Postgres. Unless `TEST_DATABASE_URL` is set, they start a throwaway embedded Postgres, apply the real migrations and delete it afterwards, so no setup is needed. Set `SKIP_DB_TESTS=1` to run only the unit tests.

| Suite | Covers |
|---|---|
| `integration/auth` | Register, login, OTP, refresh-token rotation and replay rejection |
| `integration/birthdays` | Upcoming and calendar, linked entries on friend connect, reminders sent exactly once, per-person reminder overrides, home feed |
| `integration/reservation` | Reserve, block duplicates, hide the reserver from the birthday person, cancel |
| `integration/group-gift` | Contributions settled only by the provider, progress, hidden contributors, signed sandbox webhook |
| `integration/orders` | Order → payment → delivery timeline, admin-only routes |
| `integration/public-pages` | Public wishlist and RSVP pages escape content and leak no reservation data |
| `unit/*` | Birthday maths, money and delivery rules, privacy and secrecy mappers, M-Pesa callback wiring |

## Manual test script

Run through this after starting everything as in the [README](../README.md#quick-start). You need **two accounts** to test anything social, so use the phone for one user and Expo web (press `w` in the Expo terminal) or a second device for the other.

In development:

- **OTP codes** are shown in the API response and printed in the API terminal (`[sms] would send` / email log lines). No real SMS or email is sent.
- **Payments run in sandbox mode.** They start as *pending* and settle within about a second. To test a **failed** payment, use an amount whose cents end in `13` (for example KES 1,000.13).

### 1. Onboarding and profile
- [ ] Sign up with email → enter the code → set your birthday → pick interests → the permissions screen lets you skip every permission.
- [ ] Profile shows the birthday countdown. Hiding your birth year in **Settings → Privacy** removes your age from other people's view of you.

### 2. Friends and birthdays
- [ ] User A searches User B by username → sends a request → B accepts.
- [ ] A's **Home** and **Birthdays** show B with a countdown. Check the month, list and upcoming views and the Family/Friends/Work/Favorites filters.
- [ ] Add a birthday manually for someone not on the app. Try **Import contacts**.
- [ ] **Invite**: generate a link or QR code. Opening it on another account connects the birthday.

### 3. Wishlist and reservations (the critical flow)
- [ ] B adds a wishlist item manually, then another by **pasting a product URL**. The details fill in and stay editable.
- [ ] B shares the wishlist. The public link opens in a browser.
- [ ] A opens B's wishlist → **I'll get this**. The item shows as reserved to A.
- [ ] A second friend (C) sees *"A is getting this"* (or *"Someone is already getting this"* if A reserved anonymously), and the item updates live without a refresh. C cannot reserve it.
- [ ] **B still sees the item as available,** with no hint of who reserved it or that anyone did.

### 4. Group gift and surprise
- [ ] A starts a **surprise** for B, invites C and sets a budget. B is not selectable as a member.
- [ ] A creates a group gift with a goal. A and C contribute (sandbox payment). The progress bar updates live on both devices.
- [ ] B receives **no** notification about any of this.
- [ ] A marks the gift purchased and reveals it → B now sees the gift and its contributors, except anonymous ones.

### 5. Wishes, cards and digital gifts
- [ ] A sends B a text wish, a photo wish, a voice wish and a card from a template.
- [ ] A sends B a digital gift (flowers, cake or a voucher) → B gets *"You received a gift from …"* and can open it.
- [ ] B sends a thank-you (text, voice or photo) → A is notified.

### 6. Marketplace, orders and delivery
1. A goes to **Profile → Sell on the marketplace** and applies as a vendor.
2. In the **admin dashboard**: Vendors → approve A.
3. A adds a product. Admin: Products → approve it.
4. C finds the product under **Gifts** → buys it for B → delivers to B, scheduled for a date with a time window → pays in sandbox.
5. A (the vendor) updates delivery status step by step. C sees the order timeline update.
6. Try a coupon: admin creates `BIRTHDAY10` under Promotions → C applies it at checkout.

### 7. Events, chat, AI
- [ ] Create a birthday event → invite guests → RSVP Going, Maybe and Can't attend → the organiser sees the counts. **Add to calendar** works.
- [ ] Chat in a surprise group with text, image, voice note and a poll.
- [ ] **Gift finder:** needs `ANTHROPIC_API_KEY`. Without it the assistant reports AI unavailable, but gift matching (interests, wishlist and budget) still works.

### 8. Birthday day
- [ ] Set a test account's birthday to today → open the app → the celebration screen with confetti shows the wish and gift counts.

### 9. Admin dashboard
- [ ] Dashboard stats, users (search, suspend), orders (status, refund), payments (reconciliation), reports, broadcast notification, audit log.

### 10. Privacy and account
- [ ] Block a user → they can no longer find or message you.
- [ ] **Export data** downloads your data. **Delete account** works and signs you out.

## Known gaps

These are not built yet, so skip them when testing:

- Google and Apple sign-in buttons in the mobile app. The server side is ready.
- GIF and video wishes, video thank-yous, and stickers or music in the card editor.
- Push notifications on real devices. They need an EAS project ID and, on Android, a development build: Expo Go has not supported remote push on Android since SDK 53. In-app notifications (the bell) work everywhere. See [NOTIFICATIONS.md](NOTIFICATIONS.md).
