import { formatMoney, isSupportedCurrency, PRIORITY_META, rsvpSchema } from '@bday/shared';
import express, { type Request, type Response } from 'express';
import { env } from '../config/env';
import { asyncHandler } from '../lib/async';
import { AppError, isAppError } from '../lib/errors';
import { optionalAuth } from '../middleware/auth';
import { previewInvite } from '../services/birthday.service';
import { getEventByInviteToken, rsvpByInviteToken } from '../services/event.service';
import { getPublicPage, type PublicPage } from '../services/publicPage.service';
import { getWishlistBySlug } from '../services/wishlist.service';

/**
 * Server-rendered public pages for links shared outside the app (spec §12,
 * §30): a shared wishlist, a guest RSVP page, an invite landing page, and the
 * privacy policy and terms (spec §39).
 *
 * Every interpolated value goes through `escape`. Reservation state is never
 * rendered here — these pages are exactly what the wishlist owner would see if
 * they opened their own link.
 */

export const publicRouter = express.Router();

const escape = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function page(res: Response, title: string, body: string, status = 200): void {
  res
    .status(status)
    .setHeader('content-type', 'text/html; charset=utf-8')
    .setHeader('content-security-policy', "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
    .setHeader('referrer-policy', 'no-referrer')
    .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><meta property="og:title" content="${escape(title)}">
<style>
:root{--brand:#7c3aed;--pink:#ec4899;--text:#1c1830;--muted:#6b6680;--border:#ece8f5;--bg:#faf8ff}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
.hero{background:linear-gradient(135deg,var(--brand),var(--pink));color:#fff;padding:32px 16px}
.wrap{max-width:680px;margin:0 auto;padding:0 16px}.hero .wrap{padding:0}
h1{margin:0 0 6px;font-size:28px}p{margin:6px 0}
.card{background:#fff;border:1px solid var(--border);border-radius:16px;padding:16px;margin:12px 0;display:flex;gap:14px}
.card img{width:84px;height:84px;object-fit:cover;border-radius:12px;background:#f3f0fa;flex-shrink:0}
.muted{color:var(--muted)}.price{color:var(--brand);font-weight:700}
.btn{display:inline-block;background:#fff;color:var(--brand);padding:12px 20px;border-radius:999px;font-weight:700;text-decoration:none;border:0;font-size:16px;cursor:pointer}
.btn.primary{background:var(--brand);color:#fff}
label{display:block;padding:10px;border:1px solid var(--border);border-radius:12px;margin:8px 0;background:#fff}
main{padding:16px 0 48px}
</style></head><body>${body}</body></html>`);
}

function failure(res: Response, error: unknown): void {
  const message = isAppError(error) ? error.message : 'Something went wrong.';
  const status = isAppError(error) ? error.status : 500;
  page(res, 'Birthday', `<div class="hero"><div class="wrap"><h1>🎈 Oops</h1><p>${escape(message)}</p></div></div>`, status);
}

const appLink = (path: string) => `${env.APP_DEEP_LINK_SCHEME}://${path}`;


/* ------------------------- link-in-bio page (/@name) ------------------------ */

/**
 * The page people put in an Instagram or TikTok bio. It is the app's shop
 * window, so it is styled properly and carries link-preview tags — and it
 * shows strictly less than the app: no contacts, no birth year, no reservation
 * details, and no address even when gifting is open to everyone.
 */
function renderPublicPage(res: Response, data: PublicPage): void {
  const money = (minor: number | null, currency: string): string =>
    minor != null && isSupportedCurrency(currency) ? formatMoney(minor, currency) : '';
  const initials = data.displayName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const countdown = data.countdown
    ? data.countdown.isToday
      ? 'Birthday is today'
      : `Birthday in ${data.countdown.daysUntil} ${data.countdown.daysUntil === 1 ? 'day' : 'days'}`
    : null;

  const items = (data.wishlist?.items ?? [])
    .map((item) => {
      const price = money(item.priceMinor, item.currency);
      const details = [item.size ? `Size ${item.size}` : '', item.color ?? ''].filter(Boolean).join(' · ');
      return `<li class="item${item.claimed ? ' claimed' : ''}">
${item.imageUrl ? `<img src="${escape(item.imageUrl)}" alt="" loading="lazy">` : '<div class="ph"></div>'}
<div class="item-body"><strong>${escape(item.name)}</strong>
${details ? `<p class="muted">${escape(details)}</p>` : ''}
${item.notes ? `<p class="muted">${escape(item.notes)}</p>` : ''}
<div class="item-foot">${price ? `<span class="price">${escape(price)}</span>` : '<span></span>'}
${item.claimed ? '<span class="tag">Claimed</span>' : data.giftingOpen ? `<a class="btn small" href="${escape(appLink(`wishlist-share/${data.wishlist!.shareSlug}`))}">Gift this</a>` : ''}</div>
</div></li>`;
    })
    .join('');

  const title = `${data.displayName} (@${data.username})`;
  const description = data.countdown
    ? `${countdown}. ${data.giftingOpen ? 'Pick something from the wishlist.' : 'See the wishlist.'}`
    : `${data.displayName}'s birthday wishlist.`;
  const openInApp = appLink(`person/${data.username}`);

  res
    .setHeader('content-type', 'text/html; charset=utf-8')
    .setHeader('content-security-policy', "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
    .setHeader('referrer-policy', 'no-referrer')
    .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<meta property="og:type" content="profile"><meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(`${env.WEB_BASE_URL}/@${data.username}`)}">
${data.avatarUrl ? `<meta property="og:image" content="${escape(data.avatarUrl)}">` : ''}
<meta name="twitter:card" content="${data.avatarUrl ? 'summary_large_image' : 'summary'}">
<style>
:root{--ink:#101828;--muted:#5b6475;--faint:#98a2b3;--brand:#4f46e5;--accent:#ea580c;--border:#e3e6eb;--bg:#f6f7f9;--surface:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5}
.hero{background:linear-gradient(135deg,#111827,#312e81 55%,#4338ca);color:#fff;padding:48px 16px 72px;text-align:center}
.avatar{width:104px;height:104px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,.65);background:#312e81;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:700}
h1{margin:0;font-size:26px;letter-spacing:-.3px}
.handle{opacity:.82;margin:2px 0 0}
.bio{margin:12px auto 0;max-width:460px;opacity:.94}
.pill{display:inline-block;margin-top:16px;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.16);font-weight:600;font-size:14px}
.pill.today{background:var(--accent)}
.wrap{max-width:620px;margin:-44px auto 0;padding:0 16px 56px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:20px;box-shadow:0 8px 28px rgba(16,24,40,.07)}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 12px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.item{display:flex;gap:14px;border:1px solid var(--border);border-radius:14px;padding:12px;align-items:stretch}
.item.claimed{opacity:.55}
.item img,.item .ph{width:76px;height:76px;border-radius:10px;object-fit:cover;background:#f0f2f5;flex:0 0 auto}
.item-body{display:flex;flex-direction:column;justify-content:space-between;flex:1;min-width:0}
.item-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
.muted{color:var(--muted);margin:2px 0;font-size:14px}
.price{font-weight:700;color:var(--brand)}
.tag{font-size:12px;font-weight:700;color:var(--muted);background:#f0f2f5;padding:5px 10px;border-radius:999px}
.btn{display:inline-block;background:var(--brand);color:#fff;padding:13px 22px;border-radius:999px;font-weight:600;text-decoration:none;text-align:center}
.btn.small{padding:8px 14px;font-size:14px}
.btn.ghost{background:#fff;color:var(--brand);border:1px solid var(--border)}
.actions{display:grid;gap:10px;margin-top:16px}
footer{text-align:center;color:var(--faint);font-size:13px;padding:0 16px 40px}
footer a{color:var(--brand);text-decoration:none;font-weight:600}
</style></head>
<body>
<div class="hero">
${data.avatarUrl ? `<img class="avatar" src="${escape(data.avatarUrl)}" alt="">` : `<div class="avatar">${escape(initials)}</div>`}
<h1>${escape(data.displayName)}</h1>
<p class="handle">@${escape(data.username)}${data.city ? ` · ${escape(data.city)}` : ''}</p>
${data.bio ? `<p class="bio">${escape(data.bio)}</p>` : ''}
${countdown ? `<p><span class="pill${data.countdown!.isToday ? ' today' : ''}">${escape(countdown)}</span></p>` : ''}
</div>
<main class="wrap"><div class="card">
${
  data.wishlist && items
    ? `<h2>${escape(data.wishlist.title)}</h2><ul>${items}</ul>`
    : '<h2>Wishlist</h2><p class="muted">Nothing on the list yet — check back soon.</p>'
}
<div class="actions">
<a class="btn" href="${escape(openInApp)}">${data.giftingOpen ? 'Gift something' : 'Open in the app'}</a>
${data.acceptsWishes ? `<a class="btn ghost" href="${escape(appLink(`wish/send?username=${data.username}`))}">Send a birthday wish</a>` : ''}
</div>
</div></main>
<footer><p>Claim a gift or send a wish in the app.<br><a href="${escape(env.WEB_BASE_URL)}">Make your own birthday page</a></p></footer>
</body></html>`);
}

publicRouter.get(
  '/@:username',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      renderPublicPage(res, await getPublicPage(String(req.params.username)));
    } catch (error) {
      failure(res, error);
    }
  }),
);

publicRouter.get(
  '/wishlist/:slug',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const wishlist = await getWishlistBySlug(req.auth?.userId ?? null, String(req.params.slug));
      const items = wishlist.items
        .map((item) => {
          const priority = PRIORITY_META[item.priority];
          const price = item.priceMinor != null && isSupportedCurrency(item.currency) ? formatMoney(item.priceMinor, item.currency) : '';
          return `<div class="card">${item.imageUrl ? `<img src="${escape(item.imageUrl)}" alt="">` : '<img alt="">'}<div>
<strong>${escape(item.name)}</strong><p class="muted">${escape(priority.emoji)} ${escape(priority.label)}${item.size ? ` · Size ${escape(item.size)}` : ''}${item.color ? ` · ${escape(item.color)}` : ''}</p>
${price ? `<p class="price">${escape(price)}</p>` : ''}${item.notes ? `<p class="muted">${escape(item.notes)}</p>` : ''}</div></div>`;
        })
        .join('');
      page(
        res,
        `${wishlist.owner.displayName}'s birthday wishlist`,
        `<div class="hero"><div class="wrap"><h1>🎁 ${escape(wishlist.owner.displayName)}’s ${escape(wishlist.title)}</h1>
${wishlist.description ? `<p>${escape(wishlist.description)}</p>` : ''}<p>Open the app to reserve a gift — they won’t see who’s getting what.</p>
<p><a class="btn" href="${escape(appLink(`wishlist-share/${wishlist.shareSlug}`))}">Open in the app</a></p></div></div>
<main class="wrap">${items || '<p class="muted">Nothing on the list yet.</p>'}</main>`,
      );
    } catch (error) {
      failure(res, error);
    }
  }),
);

publicRouter.get(
  '/rsvp/:token',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { event, guest } = await getEventByInviteToken(String(req.params.token));
      const when = new Date(event.startsAt).toLocaleString('en-KE', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Nairobi' });
      const option = (value: string, label: string) =>
        `<label><input type="radio" name="status" value="${value}" ${guest.rsvp === value ? 'checked' : ''} required> ${label}</label>`;
      page(
        res,
        `You're invited: ${event.name}`,
        `<div class="hero"><div class="wrap"><h1>🎉 ${escape(event.name)}</h1><p>Hi ${escape(guest.name)}, ${escape(event.host?.displayName ?? 'your host')} invited you.</p>
<p>🗓️ ${escape(when)}</p>${event.venueName || event.venueAddress ? `<p>📍 ${escape([event.venueName, event.venueAddress].filter(Boolean).join(', '))}</p>` : ''}</div></div>
<main class="wrap">${event.description ? `<p>${escape(event.description)}</p>` : ''}
<form method="post"><h2>Will you come?</h2>${option('GOING', '✅ Going')}${option('MAYBE', '🤔 Maybe')}${option('DECLINED', '😢 Can’t attend')}
${event.allowPlusOnes ? '<label>Plus-ones <input type="number" name="plusOnes" min="0" max="10" value="' + escape(guest.plusOnes) + '"></label>' : ''}
<p><button class="btn primary" type="submit">Send RSVP</button></p>
${guest.respondedAt ? `<p class="muted">You replied: ${escape(guest.rsvp.toLowerCase())}</p>` : ''}</form></main>`,
      );
    } catch (error) {
      failure(res, error);
    }
  }),
);

publicRouter.post(
  '/rsvp/:token',
  express.urlencoded({ extended: false, limit: '8kb' }),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const parsed = rsvpSchema.safeParse({
        status: req.body?.status,
        plusOnes: req.body?.plusOnes ? Number(req.body.plusOnes) : 0,
      });
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', { message: 'Choose going, maybe or can’t attend.' });
      await rsvpByInviteToken(String(req.params.token), parsed.data);
      res.redirect(303, `/rsvp/${encodeURIComponent(String(req.params.token))}`);
    } catch (error) {
      failure(res, error);
    }
  }),
);

publicRouter.get(
  '/invite/:code',
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const invite = await previewInvite(String(req.params.code));
      page(
        res,
        `${invite.inviter.displayName} invited you`,
        `<div class="hero"><div class="wrap"><h1>🎂 ${escape(invite.inviter.displayName)} wants to celebrate your birthday</h1>
${invite.valid ? `<p>Join to share birthdays, wishlists and surprises.</p><p><a class="btn" href="${escape(appLink(`invite/${invite.code}`))}">Open in the app</a></p><p>Invite code: <strong>${escape(invite.code)}</strong></p>` : `<p>This invite ${invite.expired ? 'has expired' : 'was already used'}.</p>`}
</div></div>`,
      );
    } catch (error) {
      failure(res, error);
    }
  }),
);

const LEGAL_UPDATED = '15 September 2026';

publicRouter.get('/privacy', (_req, res) =>
  page(
    res,
    'Privacy policy',
    `<div class="hero"><div class="wrap"><h1>Privacy policy</h1><p>Last updated ${LEGAL_UPDATED}</p></div></div><main class="wrap">
<h2>What we collect</h2><p>Your account details (name, email or phone), your birthday, interests, wishlists, the birthdays you add, messages you send, and orders and payments you make. Contacts are only uploaded when you choose which ones to import.</p>
<h2>How it is used</h2><p>To remind you and your friends of birthdays, show wishlists to the people you allow, suggest gifts, process orders and payments, and keep the service secure. Gift suggestions may be generated by an AI model using only information you are allowed to see.</p>
<h2>Who can see what</h2><p>You control who sees your profile, birthday, age, wishlist and gift history. Reservations and group-gift contributions for your birthday are hidden from you until they are revealed.</p>
<h2>Payments</h2><p>Card details are handled by our payment providers and never stored by us. We keep payment records as required by law.</p>
<h2>Your rights</h2><p>You can download your data and delete your account at any time from Settings → Account & data. You can block and report other users.</p>
<h2>Analytics</h2><p>We record anonymous product events (for example “wishlist item added”) without message contents, names or contact details.</p>
<h2>Contact</h2><p>Questions: ${escape(env.EMAIL_FROM)}</p></main>`,
  ),
);

publicRouter.get('/terms', (_req, res) =>
  page(
    res,
    'Terms of service',
    `<div class="hero"><div class="wrap"><h1>Terms of service</h1><p>Last updated ${LEGAL_UPDATED}</p></div></div><main class="wrap">
<h2>Your account</h2><p>You must provide accurate information and keep your credentials secure. You are responsible for activity on your account.</p>
<h2>Respectful use</h2><p>No harassment, impersonation, spam or fraud. We may suspend accounts that break these rules.</p>
<h2>Marketplace</h2><p>Products are sold by independent approved vendors, who are responsible for fulfilment. We handle payment and help resolve disputes, including refunds where appropriate.</p>
<h2>Group gifts</h2><p>Contributions are collected for the stated gift. Organisers are responsible for using funds as described. Contact support for refunds if a group gift is cancelled.</p>
<h2>Digital gifts and wallet</h2><p>Wallet credit and vouchers have no cash value except where required by law, and cannot be transferred outside the app.</p>
<h2>Changes</h2><p>We may update these terms and will notify you of material changes.</p></main>`,
  ),
);
