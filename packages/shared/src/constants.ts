import { CardTemplateStyle, DigitalGiftType, WishlistItemPriority } from './enums';

/** Interests offered during onboarding (spec §4 screen 3); feed the AI matcher. */
export const INTEREST_CATALOG = [
  { slug: 'technology', label: 'Technology', emoji: '💻' },
  { slug: 'fashion', label: 'Fashion', emoji: '👗' },
  { slug: 'beauty', label: 'Beauty', emoji: '💄' },
  { slug: 'fitness', label: 'Fitness', emoji: '🏋️' },
  { slug: 'gaming', label: 'Gaming', emoji: '🎮' },
  { slug: 'books', label: 'Books', emoji: '📚' },
  { slug: 'music', label: 'Music', emoji: '🎧' },
  { slug: 'travel', label: 'Travel', emoji: '✈️' },
  { slug: 'food', label: 'Food', emoji: '🍽️' },
  { slug: 'sports', label: 'Sports', emoji: '⚽' },
  { slug: 'home', label: 'Home', emoji: '🏠' },
  { slug: 'photography', label: 'Photography', emoji: '📷' },
  { slug: 'cars', label: 'Cars', emoji: '🚗' },
  { slug: 'art', label: 'Art', emoji: '🎨' },
  { slug: 'movies', label: 'Movies & TV', emoji: '🎬' },
  { slug: 'outdoors', label: 'Outdoors', emoji: '🏕️' },
  { slug: 'pets', label: 'Pets', emoji: '🐾' },
  { slug: 'gardening', label: 'Gardening', emoji: '🌱' },
  { slug: 'crafts', label: 'Crafts & DIY', emoji: '🧵' },
  { slug: 'wellness', label: 'Wellness', emoji: '🧘' },
  { slug: 'coffee', label: 'Coffee & Tea', emoji: '☕' },
  { slug: 'football', label: 'Football', emoji: '🥅' },
  { slug: 'skincare', label: 'Skincare', emoji: '🧴' },
  { slug: 'stationery', label: 'Stationery', emoji: '✒️' },
] as const;

export type InterestSlug = (typeof INTEREST_CATALOG)[number]['slug'];

/** Default reminder ladder (spec §21). Users may override per person. */
export const DEFAULT_REMINDER_OFFSETS_DAYS = [30, 14, 7, 3, 1, 0] as const;

/** Offsets a user is allowed to configure. */
export const ALLOWED_REMINDER_OFFSETS_DAYS = [60, 30, 21, 14, 7, 5, 3, 2, 1, 0] as const;

export const SUPPORTED_CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS', 'NGN', 'ZAR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = 'KES';

/**
 * Smallest unit multiplier per currency. All monetary values are stored and
 * transported as integer minor units to avoid floating point drift.
 */
export const CURRENCY_MINOR_UNITS: Record<SupportedCurrency, number> = {
  KES: 100,
  USD: 100,
  EUR: 100,
  GBP: 100,
  UGX: 1,
  TZS: 1,
  NGN: 100,
  ZAR: 100,
};

export const CURRENCY_SYMBOLS: Record<SupportedCurrency, string> = {
  KES: 'KES',
  USD: '$',
  EUR: '€',
  GBP: '£',
  UGX: 'USh',
  TZS: 'TSh',
  NGN: '₦',
  ZAR: 'R',
};

export const PRIORITY_META: Record<
  WishlistItemPriority,
  { label: string; emoji: string; weight: number }
> = {
  MUST_HAVE: { label: 'Must have', emoji: '❤️', weight: 3 },
  HIGH: { label: 'High', emoji: '⭐', weight: 2 },
  NICE_TO_HAVE: { label: 'Nice to have', emoji: '🙂', weight: 1 },
};

/** Gift catalogue taxonomy (spec §17). Seeded into `gift_categories`. */
export const GIFT_CATEGORY_SEED = [
  { slug: 'electronics', label: 'Electronics', emoji: '🔌' },
  { slug: 'phones', label: 'Phones', emoji: '📱' },
  { slug: 'computers', label: 'Computers', emoji: '💻' },
  { slug: 'watches', label: 'Watches', emoji: '⌚' },
  { slug: 'fashion', label: 'Fashion', emoji: '👕' },
  { slug: 'shoes', label: 'Shoes', emoji: '👟' },
  { slug: 'beauty', label: 'Beauty', emoji: '💅' },
  { slug: 'flowers', label: 'Flowers', emoji: '💐' },
  { slug: 'cakes', label: 'Cakes', emoji: '🎂' },
  { slug: 'chocolates', label: 'Chocolates', emoji: '🍫' },
  { slug: 'books', label: 'Books', emoji: '📖' },
  { slug: 'toys', label: 'Toys', emoji: '🧸' },
  { slug: 'home', label: 'Home', emoji: '🛋️' },
  { slug: 'personalized', label: 'Personalized gifts', emoji: '✨' },
  { slug: 'experiences', label: 'Experiences', emoji: '🎟️' },
  { slug: 'gaming', label: 'Gaming', emoji: '🎮' },
  { slug: 'fitness', label: 'Fitness', emoji: '🏋️' },
  { slug: 'vouchers', label: 'Gift vouchers', emoji: '🎫' },
] as const;

/** Curated shelves on the gift discovery screen (spec §46). */
export const GIFT_SHELVES = [
  { key: 'popular', label: 'Popular', emoji: '🎁' },
  { key: 'for_her', label: 'For Her', emoji: '❤️' },
  { key: 'for_him', label: 'For Him', emoji: '💙' },
  { key: 'family', label: 'Family', emoji: '👨‍👩‍👧' },
  { key: 'friends', label: 'Friends', emoji: '👫' },
  { key: 'colleagues', label: 'Colleagues', emoji: '💼' },
  { key: 'under_1000', label: 'Under 1,000', emoji: '💰' },
  { key: 'under_5000', label: 'Under 5,000', emoji: '💰' },
  { key: 'premium', label: 'Premium', emoji: '💎' },
  { key: 'personalized', label: 'Personalized', emoji: '✨' },
] as const;
export type GiftShelfKey = (typeof GIFT_SHELVES)[number]['key'];

export const CARD_TEMPLATE_META: Record<CardTemplateStyle, { label: string; description: string }> = {
  ROMANTIC: { label: 'Romantic', description: 'Soft, warm and heartfelt.' },
  FUNNY: { label: 'Funny', description: 'Make them laugh out loud.' },
  FRIENDSHIP: { label: 'Friendship', description: 'For the ones who always show up.' },
  FAMILY: { label: 'Family', description: 'Warm and familiar.' },
  PROFESSIONAL: { label: 'Professional', description: 'Polished and appropriate for work.' },
  SIMPLE: { label: 'Simple', description: 'Clean and understated.' },
  ELEGANT: { label: 'Elegant', description: 'Premium and refined.' },
};

export const DIGITAL_GIFT_META: Record<
  DigitalGiftType,
  { label: string; emoji: string; requiresValue: boolean }
> = {
  CARD: { label: 'Birthday card', emoji: '💌', requiresValue: false },
  FLOWERS: { label: 'Digital flowers', emoji: '💐', requiresValue: false },
  CAKE: { label: 'Digital cake', emoji: '🎂', requiresValue: false },
  ANIMATION: { label: 'Celebration animation', emoji: '🎉', requiresValue: false },
  VOUCHER: { label: 'Gift voucher', emoji: '🎫', requiresValue: true },
  AIRTIME: { label: 'Airtime', emoji: '📶', requiresValue: true },
  DATA_BUNDLE: { label: 'Data bundle', emoji: '🌐', requiresValue: true },
  EGIFT_CARD: { label: 'E-gift card', emoji: '🎟️', requiresValue: true },
  WALLET_CREDIT: { label: 'Wallet credit', emoji: '👛', requiresValue: true },
};

export const LIMITS = {
  /** Free tier caps; premium members get the higher value (spec §54). */
  wishlistsPerUser: { free: 3, premium: 25 },
  wishlistItemsPerList: { free: 100, premium: 500 },
  groupGiftMembers: { free: 10, premium: 50 },
  aiSuggestionsPerDay: { free: 10, premium: 200 },
  /** Uploads */
  maxImageBytes: 8 * 1024 * 1024,
  maxVideoBytes: 64 * 1024 * 1024,
  maxAudioBytes: 16 * 1024 * 1024,
  /** Pagination */
  defaultPageSize: 20,
  maxPageSize: 100,
  /** Money */
  minContributionMinor: 5000, // e.g. KES 50.00
  /** Text */
  maxBioLength: 280,
  maxMessageLength: 2000,
} as const;

/**
 * Global birthdays (celebrating strangers). Strangers may send wishes, cheers
 * and digital gifts — including money — to adults who opted in; never
 * physical gifts. These caps limit spam and fraud; per sender, rolling 24h.
 */
export const GLOBAL_BIRTHDAYS = {
  minAge: 18,
  maxNoteLength: 140,
  strangerWishesPerDay: 30,
  strangerGiftsPerDay: 20,
  cheersPerDay: 300,
  /** Largest single digital gift a stranger can send, in minor units (KES 10,000). */
  maxStrangerGiftMinor: 1_000_000,
  /** Cheer counts that trigger a notification to the birthday person. */
  cheerMilestones: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
} as const;

export const RESERVED_USERNAMES = [
  'admin',
  'administrator',
  'api',
  'app',
  'birthday',
  'support',
  'help',
  'root',
  'system',
  'me',
  'you',
  'settings',
  'login',
  'signup',
  'register',
  'wishlist',
  'gift',
  'gifts',
  'vendor',
  'about',
  'terms',
  'privacy',
  'null',
  'undefined',
] as const;

/** Ordered delivery pipeline; used to validate transitions (spec §58 rule 6). */
export const DELIVERY_FLOW = [
  'PENDING',
  'PROCESSING',
  'DISPATCHED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;
