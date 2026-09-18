import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  LIMITS,
  aiSuggestionPayloadSchema,
  formatMoney,
  isSupportedCurrency,
  toMinor,
  type GiftIdeaDto,
  type GiftMatchInput,
  type GiftRefinement,
  type GiftSuggestionDto,
  type GiftSuggestionInput,
  type GiftSuggestionResponse,
  type ProductDto,
  type SupportedCurrency,
} from '@bday/shared';
import type { Prisma } from '@prisma/client';
import * as z4 from 'zod/v4';
import { env } from '../config/env';
import { toCivilDateString, zonedNow } from '../lib/dates';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { toProductDto } from './catalog.service';
import { giftsGivenTo } from './memory.service';
import { getPublicProfile } from './user.service';
import { getUserWishlist } from './wishlist.service';

/**
 * AI gift assistant and gift matching (spec §19, §20, §47).
 *
 * Two layers:
 *
 *   * `matchGifts` is deterministic — interests, wishlist and budget scored
 *     against real catalogue stock. It needs no model and powers the home feed.
 *   * `suggestGifts` asks Claude for ideas from a brief assembled on the server,
 *     then grounds each idea in real products and wishes where it can.
 *
 * Everything about the recipient that reaches the model has already passed the
 * same privacy filters as the app: the assistant never learns something the
 * person asking could not have seen themselves.
 */

/** Interest → catalogue category slugs and search tags. */
const INTEREST_SIGNALS: Record<string, { categories: string[]; tags: string[] }> = {
  technology: { categories: ['electronics', 'computers', 'phones'], tags: ['tech', 'gadget', 'smart'] },
  fashion: { categories: ['fashion', 'shoes', 'watches'], tags: ['style', 'fashion'] },
  beauty: { categories: ['beauty'], tags: ['beauty', 'makeup'] },
  skincare: { categories: ['beauty'], tags: ['skincare', 'spa'] },
  fitness: { categories: ['fitness'], tags: ['fitness', 'gym', 'workout'] },
  gaming: { categories: ['gaming', 'electronics'], tags: ['gaming', 'console', 'playstation', 'xbox'] },
  books: { categories: ['books'], tags: ['book', 'reading', 'novel'] },
  music: { categories: ['electronics'], tags: ['music', 'headphones', 'speaker', 'vinyl'] },
  travel: { categories: ['experiences'], tags: ['travel', 'luggage', 'trip'] },
  food: { categories: ['cakes', 'chocolates', 'experiences'], tags: ['food', 'dinner', 'gourmet'] },
  coffee: { categories: ['home'], tags: ['coffee', 'tea', 'mug'] },
  sports: { categories: ['fitness'], tags: ['sports', 'jersey', 'ball'] },
  football: { categories: ['fitness'], tags: ['football', 'jersey', 'soccer'] },
  home: { categories: ['home'], tags: ['home', 'decor', 'kitchen'] },
  gardening: { categories: ['home'], tags: ['garden', 'plant'] },
  photography: { categories: ['electronics'], tags: ['camera', 'photo', 'photography', 'printer'] },
  cars: { categories: ['experiences'], tags: ['car', 'auto', 'driving'] },
  art: { categories: ['personalized'], tags: ['art', 'painting', 'craft'] },
  crafts: { categories: ['personalized'], tags: ['craft', 'diy'] },
  movies: { categories: ['experiences'], tags: ['movie', 'cinema', 'streaming'] },
  outdoors: { categories: ['experiences', 'fitness'], tags: ['outdoor', 'camping', 'hiking'] },
  pets: { categories: ['home'], tags: ['pet', 'dog', 'cat'] },
  wellness: { categories: ['beauty', 'experiences'], tags: ['wellness', 'spa', 'yoga'] },
  stationery: { categories: ['books', 'personalized'], tags: ['stationery', 'journal', 'notebook', 'pen'] },
};

const PRODUCT_INCLUDE = {
  vendor: { select: { id: true, name: true, logoUrl: true, rating: true } },
  categories: { include: { category: { select: { id: true, slug: true, label: true } } } },
} satisfies Prisma.ProductInclude;

/* --------------------------------- quota --------------------------------- */

async function consumeQuota(userId: string, isPremium: boolean): Promise<number> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { timezone: true } });
  const day = toCivilDateString(zonedNow(profile?.timezone ?? 'Africa/Nairobi'));
  const cap = isPremium ? LIMITS.aiSuggestionsPerDay.premium : LIMITS.aiSuggestionsPerDay.free;

  // Increment-then-check inside one statement's worth of work: the upsert is
  // atomic, so two concurrent requests cannot both squeeze under the cap.
  const usage = await prisma.aiUsageDaily.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (usage.count > cap) {
    await prisma.aiUsageDaily.update({ where: { userId_day: { userId, day } }, data: { count: { decrement: 1 } } });
    throw new AppError('AI_QUOTA_EXCEEDED', {
      message: isPremium
        ? 'You have used all your gift suggestions for today.'
        : 'You have used today’s free gift suggestions. Premium members get many more.',
    });
  }
  return cap - usage.count;
}

async function refundQuota(userId: string): Promise<void> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { timezone: true } });
  const day = toCivilDateString(zonedNow(profile?.timezone ?? 'Africa/Nairobi'));
  await prisma.aiUsageDaily
    .update({ where: { userId_day: { userId, day } }, data: { count: { decrement: 1 } } })
    .catch(() => undefined);
}

/* ------------------------------ brief building ------------------------------ */

interface RecipientBrief {
  recipientUserId: string | null;
  trackedBirthdayId: string | null;
  name: string | null;
  age: number | null;
  relationship: string | null;
  interests: string[];
  giftPreferences: Record<string, unknown> | null;
  wishlist: Array<{ id: string; name: string; priceMinor: number | null; currency: string; priority: string; available: boolean }>;
  previousGifts: string[];
  city: string | null;
}

async function buildRecipientBrief(userId: string, input: { recipientUserId?: string; trackedBirthdayId?: string; relationship?: string }): Promise<RecipientBrief> {
  const brief: RecipientBrief = {
    recipientUserId: null,
    trackedBirthdayId: null,
    name: null,
    age: null,
    relationship: input.relationship ?? null,
    interests: [],
    giftPreferences: null,
    wishlist: [],
    previousGifts: [],
    city: null,
  };

  let linkedUserId = input.recipientUserId ?? null;

  if (input.trackedBirthdayId) {
    const tracked = await prisma.trackedBirthday.findFirst({
      where: { id: input.trackedBirthdayId, ownerId: userId, deletedAt: null },
      include: { interests: { include: { interest: { select: { slug: true } } } } },
    });
    if (!tracked) throw new AppError('NOT_FOUND', { message: 'That birthday is not on your calendar.' });
    brief.trackedBirthdayId = tracked.id;
    brief.name = tracked.name;
    brief.relationship ??= tracked.relationship;
    brief.interests = tracked.interests.map((link) => link.interest.slug);
    if (tracked.birthYear) brief.age = new Date().getFullYear() - tracked.birthYear;
    linkedUserId ??= tracked.linkedUserId;
  }

  if (linkedUserId) {
    const profile = await getPublicProfile(userId, { userId: linkedUserId });
    brief.recipientUserId = profile.id;
    brief.name ??= profile.displayName;
    brief.age = profile.age ?? brief.age;
    brief.interests = Array.from(new Set([...brief.interests, ...profile.interests.map((interest) => interest.slug)]));
    if (profile.giftPreferences) brief.giftPreferences = { ...profile.giftPreferences };

    if (profile.wishlistAccess === 'VISIBLE') {
      try {
        const wishlist = await getUserWishlist(userId, linkedUserId);
        brief.wishlist = wishlist.items.slice(0, 30).map((item) => ({
          id: item.id,
          name: item.name,
          priceMinor: item.priceMinor,
          currency: item.currency,
          priority: item.priority,
          available: item.status === 'AVAILABLE',
        }));
      } catch {
        // Wishlist hidden or missing — the brief simply goes without it.
      }
    }

    const given = await giftsGivenTo(userId, linkedUserId, 10);
    brief.previousGifts = given.map((gift) => gift.title);
  }

  return brief;
}

/* ------------------------------- the model ------------------------------- */

/**
 * The shape Claude is constrained to. Kept free of length constraints so the
 * JSON schema stays within what structured outputs accept; the stricter
 * shared schema is applied afterwards.
 */
const ModelSuggestionSchema = z4.object({
  intro: z4.string(),
  suggestions: z4.array(
    z4.object({
      name: z4.string(),
      description: z4.string(),
      estimatedPriceMajor: z4.number().nullable(),
      reason: z4.string(),
      categorySlug: z4.string().nullable(),
      searchQuery: z4.string(),
    }),
  ),
});

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError('AI_UNAVAILABLE', { message: 'The gift assistant has not been configured yet.' });
  }
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  return client;
}

const SYSTEM_PROMPT = `You are the gift assistant inside a birthday app used mainly in Kenya and East Africa.
You help people choose thoughtful birthday gifts for someone specific.

How to work:
- Ground every idea in the brief: the person's interests, their wishlist, gift preferences, relationship, age if known, and budget.
- Wishlist items marked available are the strongest signal. When one fits the budget, suggest it first and say it is on their wishlist.
- Never repeat a gift listed under previous gifts, and avoid the person's stated dislikes and allergies.
- Respect the budget. Estimated prices are in the requested currency's major units (e.g. 8500 for KES 8,500) and should be realistic for buying locally.
- Prefer things that can be bought or delivered in the person's city. Experiences and personalised gifts are welcome.
- Be warm and specific in reasons (one or two sentences). No generic filler.
- categorySlug must be one of: electronics, phones, computers, watches, fashion, shoes, beauty, flowers, cakes, chocolates, books, toys, home, personalized, experiences, gaming, fitness, vouchers — or null.
- searchQuery is 2-5 plain words a shop search would match, e.g. "portable photo printer".
- The intro is one short friendly sentence.`;

const REFINEMENT_INSTRUCTIONS: Record<GiftRefinement, string> = {
  CHEAPER: 'Give cheaper options than last time, clearly below the previous price range.',
  PREMIUM: 'Give premium, higher-end options at the top of (or slightly above) the budget.',
  ROMANTIC: 'Make the ideas romantic and intimate.',
  FUNNY: 'Make the ideas funny and playful while still being genuinely useful or delightful.',
  UNEXPECTED: 'Suggest unexpected, creative ideas they are unlikely to have thought of.',
  MORE_LIKE_THIS: 'Give more ideas in the same spirit as the previous suggestions, without repeating any.',
  SURPRISE_ME: 'Pick a bold, surprising direction that still fits who they are.',
};

function describeBudget(input: GiftSuggestionInput, currency: SupportedCurrency): string {
  const { budgetMinMinor: min, budgetMaxMinor: max } = input;
  if (min != null && max != null) return `${formatMoney(min, currency)} to ${formatMoney(max, currency)}`;
  if (max != null) return `up to ${formatMoney(max, currency)}`;
  if (min != null) return `from ${formatMoney(min, currency)}`;
  return 'not specified';
}

async function callModel(brief: object, history: Anthropic.Beta.BetaMessageParam[], limit: number) {
  const started = Date.now();
  const response = await anthropic().beta.messages.parse({
    model: env.ANTHROPIC_MODEL,
    max_tokens: env.AI_MAX_OUTPUT_TOKENS,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: betaZodOutputFormat(ModelSuggestionSchema) },
    messages: [
      ...history,
      { role: 'user', content: `Suggest exactly ${limit} gifts.\n\nBrief (JSON):\n${JSON.stringify(brief)}` },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new AppError('AI_UNAVAILABLE', { message: 'The gift assistant could not help with that request.' });
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new AppError('AI_UNAVAILABLE', { context: { stopReason: response.stop_reason } });
  }
  return { parsed, response, latencyMs: Date.now() - started };
}

/* ----------------------------- grounding ideas ----------------------------- */

async function findProductForIdea(
  idea: { searchQuery: string; categorySlug: string | null; estimatedPriceMinor: number | null },
  currency: string,
  budgetMaxMinor: number | undefined,
  city: string | null,
): Promise<ProductDto | null> {
  const words = idea.searchQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 5);
  if (words.length === 0) return null;

  const candidates = await prisma.product.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      vendor: { status: 'APPROVED' },
      currency,
      ...(budgetMaxMinor ? { priceMinor: { lte: Math.round(budgetMaxMinor * 1.1) } } : {}),
      OR: [
        ...words.map((word) => ({ name: { contains: word, mode: 'insensitive' as const } })),
        { tags: { hasSome: words } },
      ],
    },
    take: 25,
    include: PRODUCT_INCLUDE,
  });
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((product) => {
      const name = product.name.toLowerCase();
      let score = words.filter((word) => name.includes(word)).length * 3;
      score += words.filter((word) => product.tags.includes(word)).length * 2;
      if (idea.categorySlug && product.categories.some((link) => link.category.slug === idea.categorySlug)) score += 2;
      if (city && product.city && product.city.toLowerCase() === city.toLowerCase()) score += 1;
      if (idea.estimatedPriceMinor) {
        const ratio = product.priceMinor / idea.estimatedPriceMinor;
        if (ratio > 0.6 && ratio < 1.5) score += 1;
      }
      score += (product.rating ?? 0) / 5;
      return { product, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  // At least one name word must match, or the "match" is noise.
  return best && best.score >= 3 ? toProductDto(best.product as never) : null;
}

function matchWishlistItem(name: string, wishlist: RecipientBrief['wishlist']): string | null {
  const needle = name.toLowerCase();
  const hit = wishlist.find((item) => {
    const hay = item.name.toLowerCase();
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
  return hit?.id ?? null;
}

/* ----------------------------- public entry points ----------------------------- */

export async function suggestGifts(
  user: { userId: string; isPremium: boolean },
  input: GiftSuggestionInput,
): Promise<GiftSuggestionResponse> {
  const viewer = await prisma.profile.findUnique({
    where: { userId: user.userId },
    select: { city: true, countryCode: true },
  });

  const recipient = await buildRecipientBrief(user.userId, input);
  const currency: SupportedCurrency =
    input.currency && isSupportedCurrency(input.currency) ? input.currency : (env.PAYMENTS_DEFAULT_CURRENCY as SupportedCurrency);

  let conversation = input.conversationId
    ? await prisma.aiConversation.findFirst({
        where: { id: input.conversationId, userId: user.userId },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
      })
    : null;
  if (input.conversationId && !conversation) throw new AppError('NOT_FOUND');

  const quotaRemaining = await consumeQuota(user.userId, user.isPremium);

  const brief = {
    recipient: {
      name: recipient.name,
      age: input.recipientAge ?? recipient.age,
      relationship: input.relationship ?? recipient.relationship,
      interests: Array.from(new Set([...(input.interests ?? []), ...recipient.interests])),
      giftPreferences: recipient.giftPreferences,
      wishlist: recipient.wishlist.map((item) => ({
        name: item.name,
        price: item.priceMinor != null && isSupportedCurrency(item.currency) ? formatMoney(item.priceMinor, item.currency) : null,
        priority: item.priority,
        available: item.available,
      })),
      previousGifts: recipient.previousGifts,
    },
    request: input.prompt ?? null,
    occasion: input.occasion,
    budget: describeBudget(input, currency),
    currency,
    location: { city: viewer?.city ?? null, country: viewer?.countryCode ?? 'KE' },
    refinement: input.refinement ? REFINEMENT_INSTRUCTIONS[input.refinement] : null,
  };

  const history: Anthropic.Beta.BetaMessageParam[] = (conversation?.messages ?? []).map((message) => ({
    role: message.role === 'USER' ? 'user' : 'assistant',
    content: message.content,
  }));

  let result;
  try {
    result = await callModel(brief, history, input.limit);
  } catch (error) {
    await refundQuota(user.userId);
    if (error instanceof AppError) throw error;
    if (error instanceof Anthropic.RateLimitError) {
      throw new AppError('AI_UNAVAILABLE', { message: 'The gift assistant is busy. Please try again in a moment.', cause: error });
    }
    logger.error({ err: error }, 'gift assistant call failed');
    throw new AppError('AI_UNAVAILABLE', { cause: error });
  }

  // A model response is untrusted input: validate against the strict schema.
  const safe = aiSuggestionPayloadSchema.safeParse({
    intro: result.parsed.intro.slice(0, 400),
    suggestions: result.parsed.suggestions.slice(0, 10).map((s) => ({
      name: s.name.slice(0, 140),
      description: s.description.slice(0, 600),
      estimatedPriceMajor: s.estimatedPriceMajor != null && s.estimatedPriceMajor >= 0 ? s.estimatedPriceMajor : null,
      reason: s.reason.slice(0, 600),
      categorySlug: s.categorySlug?.slice(0, 60) ?? null,
      searchQuery: s.searchQuery.slice(0, 120) || s.name.slice(0, 120),
    })),
  });
  if (!safe.success) {
    await refundQuota(user.userId);
    logger.warn({ issues: safe.error.issues }, 'gift assistant returned an invalid payload');
    throw new AppError('AI_UNAVAILABLE');
  }

  const suggestions: GiftSuggestionDto[] = [];
  for (const [index, idea] of safe.data.suggestions.slice(0, input.limit).entries()) {
    const estimatedPriceMinor = idea.estimatedPriceMajor != null ? toMinor(idea.estimatedPriceMajor, currency) : null;
    const product = await findProductForIdea(
      { searchQuery: idea.searchQuery, categorySlug: idea.categorySlug, estimatedPriceMinor },
      currency,
      input.budgetMaxMinor,
      viewer?.city ?? null,
    ).catch(() => null);
    suggestions.push({
      rank: index + 1,
      name: idea.name,
      description: idea.description,
      estimatedPriceMinor,
      currency,
      reason: idea.reason,
      categorySlug: idea.categorySlug,
      searchQuery: idea.searchQuery,
      product,
      wishlistItemId: matchWishlistItem(idea.name, recipient.wishlist),
    });
  }

  const userTurn = input.refinement ? `Refine: ${input.refinement}` : input.prompt ?? `Gift ideas for ${recipient.name ?? 'them'}`;
  const assistantTurn = JSON.stringify({ intro: safe.data.intro, suggestions: safe.data.suggestions.map((s) => ({ name: s.name, estimatedPriceMajor: s.estimatedPriceMajor })) });

  conversation ??= await prisma.aiConversation.create({
    data: {
      userId: user.userId,
      recipientUserId: recipient.recipientUserId,
      trackedBirthdayId: recipient.trackedBirthdayId,
      context: { currency, budgetMinMinor: input.budgetMinMinor ?? null, budgetMaxMinor: input.budgetMaxMinor ?? null },
    },
    include: { messages: true },
  });

  await prisma.aiMessage.createMany({
    data: [
      { conversationId: conversation.id, role: 'USER', content: `${userTurn}\n\nBrief (JSON):\n${JSON.stringify(brief)}` },
      {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: assistantTurn,
        model: result.response.model,
        tokensIn: result.response.usage.input_tokens,
        tokensOut: result.response.usage.output_tokens,
        latencyMs: result.latencyMs,
      },
    ],
  });

  return {
    conversationId: conversation.id,
    intro: safe.data.intro,
    suggestions,
    followUps: ['CHEAPER', 'PREMIUM', 'UNEXPECTED', 'MORE_LIKE_THIS', 'SURPRISE_ME'],
    quotaRemaining,
  };
}

/**
 * Deterministic matching of recipient + interests + wishlist + budget to real
 * gifts (spec §20). No model call, no quota.
 */
export async function matchGifts(userId: string, input: GiftMatchInput): Promise<GiftIdeaDto[]> {
  const recipient = input.recipientUserId || input.trackedBirthdayId ? await buildRecipientBrief(userId, input) : null;
  const viewer = await prisma.profile.findUnique({ where: { userId }, select: { city: true } });

  const interests = recipient?.interests.length
    ? recipient.interests
    : (await prisma.userInterest.findMany({ where: { userId }, select: { interest: { select: { slug: true } } } })).map(
        (link) => link.interest.slug,
      );
  const currency = input.currency ?? env.PAYMENTS_DEFAULT_CURRENCY;
  const forUser = recipient?.name ? { id: recipient.recipientUserId ?? recipient.trackedBirthdayId ?? '', displayName: recipient.name } : null;

  const ideas: GiftIdeaDto[] = [];

  // 1. Available wishes within budget come first — nothing beats what they asked for.
  for (const item of recipient?.wishlist ?? []) {
    if (!item.available) continue;
    if (input.budgetMaxMinor != null && item.priceMinor != null && item.priceMinor > input.budgetMaxMinor) continue;
    if (input.budgetMinMinor != null && item.priceMinor != null && item.priceMinor < input.budgetMinMinor) continue;
    ideas.push({
      productId: null,
      name: item.name,
      imageUrl: null,
      priceMinor: item.priceMinor,
      currency: item.currency,
      reason: item.priority === 'MUST_HAVE' ? '❤️ Their must-have wish' : '🎁 On their wishlist',
      forUser,
      source: 'WISHLIST',
    });
  }

  // 2. Catalogue products scored against interests.
  const categories = new Set<string>();
  const tags = new Set<string>();
  for (const slug of interests) {
    const signal = INTEREST_SIGNALS[slug];
    signal?.categories.forEach((category) => categories.add(category));
    signal?.tags.forEach((tag) => tags.add(tag));
  }

  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      vendor: { status: 'APPROVED' },
      currency,
      ...(input.budgetMaxMinor != null || input.budgetMinMinor != null
        ? { priceMinor: { ...(input.budgetMinMinor != null ? { gte: input.budgetMinMinor } : {}), ...(input.budgetMaxMinor != null ? { lte: input.budgetMaxMinor } : {}) } }
        : {}),
      ...(categories.size || tags.size
        ? { OR: [{ categories: { some: { category: { slug: { in: [...categories] } } } } }, { tags: { hasSome: [...tags] } }] }
        : {}),
    },
    orderBy: [{ isFeatured: 'desc' }, { purchaseCount: 'desc' }],
    take: 60,
    include: PRODUCT_INCLUDE,
  });

  const previous = new Set((recipient?.previousGifts ?? []).map((title) => title.toLowerCase()));
  const scored = products
    .filter((product) => !previous.has(product.name.toLowerCase()))
    .map((product) => {
      const productCategories = product.categories.map((link) => link.category.slug);
      const matchedInterest = interests.find((slug) => {
        const signal = INTEREST_SIGNALS[slug];
        return signal && (signal.categories.some((c) => productCategories.includes(c)) || signal.tags.some((t) => product.tags.includes(t)));
      });
      let score = matchedInterest ? 5 : 0;
      score += product.tags.filter((tag) => tags.has(tag)).length;
      score += (product.rating ?? 3) / 2;
      score += Math.min(product.purchaseCount, 50) / 25;
      if (product.isFeatured) score += 1;
      if (viewer?.city && product.city?.toLowerCase() === viewer.city.toLowerCase()) score += 1;
      return { product, score, matchedInterest };
    })
    .sort((a, b) => b.score - a.score);

  for (const { product, matchedInterest } of scored) {
    if (ideas.length >= input.limit) break;
    const label = matchedInterest ? interestLabel(matchedInterest) : null;
    ideas.push({
      productId: product.id,
      name: product.name,
      imageUrl: product.images[0] ?? null,
      priceMinor: product.priceMinor,
      currency: product.currency,
      reason: label ? `Great for someone into ${label}` : 'Popular birthday gift',
      forUser,
      source: 'MARKETPLACE',
    });
  }

  return ideas.slice(0, input.limit);
}

function interestLabel(slug: string): string {
  return slug.replace(/-/g, ' ');
}

export function aiStatus() {
  return { available: Boolean(env.ANTHROPIC_API_KEY), model: env.ANTHROPIC_API_KEY ? env.ANTHROPIC_MODEL : null };
}

