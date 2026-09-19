import type { ErrorCode } from './errors';
import type {
  BirthdayMessageKind,
  CardTemplateStyle,
  ConversationType,
  DeliveryStatus,
  DeliveryTarget,
  DigitalGiftType,
  FriendshipStatus,
  GroupGiftStatus,
  MessageKind,
  NotificationType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ProductStatus,
  RelationshipType,
  ReservationStatus,
  RsvpStatus,
  UserRole,
  UserStatus,
  Visibility,
  WishlistItemPriority,
  WishlistItemStatus,
} from './enums';

/* ------------------------------------------------------------------ *
 * Envelope (spec §51). Every response — success or failure — uses it.
 * ------------------------------------------------------------------ */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta & Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  message: string;
  code: ErrorCode;
  /** Field-level problems, keyed by dot-path, present on VALIDATION_ERROR. */
  errors?: Record<string, string[]>;
  /** Correlation id for support/debugging. */
  requestId?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PaginationMeta {
  /** Opaque cursor to pass as `?cursor=` for the next page; null when done. */
  nextCursor?: string | null;
  total?: number;
  limit?: number;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export function isApiFailure<T>(response: ApiResponse<T>): response is ApiFailure {
  return response.success === false;
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthSession {
  user: CurrentUser;
  tokens: AuthTokens;
  /** True on the first sign-in, so the client can route into onboarding. */
  onboardingRequired: boolean;
}

export interface OtpChallenge {
  challengeId: string;
  /** Masked destination, e.g. "+2547••••123" — never the full value. */
  destination: string;
  expiresAt: string;
  /** Seconds the client must wait before offering "resend". */
  resendAfterSeconds: number;
}

/* ------------------------------------------------------------------ *
 * Users & profiles
 * ------------------------------------------------------------------ */

export interface CurrentUser {
  id: string;
  email: string | null;
  phone: string | null;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  isPremium: boolean;
  onboardingCompletedAt: string | null;
  birthday: BirthdayInfo | null;
  privacy: PrivacySettings;
  notificationPreferences: NotificationPreferences;
  createdAt: string;
}

export interface BirthdayInfo {
  month: number;
  day: number;
  /** Null when hidden by privacy settings or never provided. */
  year: number | null;
  /** Formatted "March 14" — respects year visibility. */
  label: string;
  countdown: CountdownInfo;
}

export interface CountdownInfo {
  daysUntil: number;
  hoursUntil: number;
  nextDate: string;
  isToday: boolean;
  label: string;
  turningAge: number | null;
}

export interface PrivacySettings {
  profileVisibility: Visibility;
  birthdayVisibility: Visibility;
  wishlistVisibility: Visibility;
  giftHistoryVisibility: Visibility;
  showAge: boolean;
  showBirthYear: boolean;
  discoverableByPhone: boolean;
  discoverableByEmail: boolean;
  discoverableByUsername: boolean;
  /** Listed in global birthdays and reachable by strangers (digital only). */
  celebrateGlobally: boolean;
}

export interface NotificationPreferences {
  /** Days before a birthday to notify; see DEFAULT_REMINDER_OFFSETS_DAYS. */
  reminderOffsetsDays: number[];
  channels: {
    push: boolean;
    email: boolean;
    sms: boolean;
  };
  /** Per-type mute switches, keyed by NotificationType. */
  mutedTypes: NotificationType[];
  /** Local hour (0-23) at which daily digests and birthday-morning pings fire. */
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  /** Null when the viewer is not allowed to see it. */
  birthday: BirthdayInfo | null;
  age: number | null;
  interests: InterestDto[];
  /** Relationship of the viewer to this profile. */
  friendship: FriendshipSummary | null;
  wishlistAccess: 'VISIBLE' | 'HIDDEN' | 'NONE';
  giftPreferences: GiftPreferences | null;
  isSelf: boolean;
}

export interface GiftPreferences {
  sizes: Record<string, string>;
  favoriteColors: string[];
  favoriteBrands: string[];
  dislikes: string[];
  allergies: string[];
  notes: string | null;
}

export interface InterestDto {
  slug: string;
  label: string;
  emoji: string | null;
}

/* ------------------------------------------------------------------ *
 * Friends & birthdays
 * ------------------------------------------------------------------ */

export interface FriendshipSummary {
  id: string;
  status: FriendshipStatus;
  /** True when the current user sent the pending request. */
  outgoing: boolean;
  relationship: RelationshipType | null;
  groupIds: string[];
  isFavorite: boolean;
  since: string | null;
}

export interface FriendDto {
  friendshipId: string;
  user: PublicProfile;
  relationship: RelationshipType | null;
  isFavorite: boolean;
  groups: FriendGroupDto[];
}

export interface FriendGroupDto {
  id: string;
  name: string;
  color: string | null;
  memberCount: number;
  isSystem: boolean;
}

export interface FriendRequestDto {
  id: string;
  user: PublicProfile;
  direction: 'INCOMING' | 'OUTGOING';
  message: string | null;
  createdAt: string;
}

/**
 * A birthday on the current user's calendar. It may be backed by a real user
 * (`linkedUser`) or be a manual contact entry.
 */
export interface TrackedBirthdayDto {
  id: string;
  name: string;
  avatarUrl: string | null;
  birthday: { month: number; day: number; year: number | null; label: string };
  countdown: CountdownInfo;
  relationship: RelationshipType | null;
  isFavorite: boolean;
  notes: string | null;
  phone: string | null;
  email: string | null;
  interests: InterestDto[];
  linkedUser: { id: string; username: string } | null;
  hasWishlist: boolean;
  wishlistItemCount: number;
  newWishlistItemCount: number;
  reminderOffsetsDays: number[] | null;
  groups: FriendGroupDto[];
}

export interface UpcomingBirthdaysResponse {
  today: TrackedBirthdayDto[];
  upcoming: TrackedBirthdayDto[];
  /** The current user's own birthday, for the "your birthday" card. */
  mine: CountdownInfo | null;
}

export interface CalendarMonthResponse {
  year: number;
  month: number;
  days: Array<{
    day: number;
    birthdays: TrackedBirthdayDto[];
    events: EventSummaryDto[];
  }>;
}

export interface ContactImportCandidate {
  externalId: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthday: { month: number; day: number; year: number | null } | null;
  /** Set when this contact matches an existing platform user. */
  matchedUser: { id: string; username: string; displayName: string; avatarUrl: string | null } | null;
  alreadyTracked: boolean;
}

export interface InviteDto {
  code: string;
  url: string;
  qrDataUrl: string;
  expiresAt: string | null;
  acceptedAt: string | null;
}

/* ------------------------------------------------------------------ *
 * Wishlists
 * ------------------------------------------------------------------ */

export interface WishlistDto {
  id: string;
  ownerId: string;
  owner: { id: string; username: string; displayName: string; avatarUrl: string | null };
  title: string;
  description: string | null;
  visibility: Visibility;
  isDefault: boolean;
  shareSlug: string;
  shareUrl: string;
  itemCount: number;
  /** Only present for the owner. */
  viewCount?: number;
  items: WishlistItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface WishlistItemDto {
  id: string;
  wishlistId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string;
  productUrl: string | null;
  merchant: string | null;
  category: string | null;
  priority: WishlistItemPriority;
  size: string | null;
  color: string | null;
  quantity: number;
  notes: string | null;
  preferredVendorId: string | null;
  /** Set when the wish is a marketplace product that can be bought in-app. */
  productId: string | null;
  status: WishlistItemStatus;
  /**
   * Reservation state as the *viewer* is allowed to see it.
   *
   * The owner always receives `null` here — spec §58 rule 2. Other viewers see
   * whether it is taken, and who took it only if that was not anonymous.
   */
  reservation: ItemReservationView | null;
  /** Set when a group gift is running for this item. */
  groupGift: GroupGiftSummary | null;
  position: number;
  createdAt: string;
}

export interface ItemReservationView {
  status: ReservationStatus;
  /** True when the current user is the one who reserved it. */
  isMine: boolean;
  reservedByMe: boolean;
  /** Null when the reserver chose to stay anonymous or is another user. */
  reservedBy: { id: string; displayName: string; avatarUrl: string | null } | null;
  quantityReserved: number;
  reservedAt: string;
  note: string | null;
}

export interface UnfurledProduct {
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string | null;
  merchant: string | null;
  productUrl: string;
}

/* ------------------------------------------------------------------ *
 * Group gifting & surprises
 * ------------------------------------------------------------------ */

export interface GroupGiftSummary {
  id: string;
  title: string;
  status: GroupGiftStatus;
  targetMinor: number;
  raisedMinor: number;
  currency: string;
  percentFunded: number;
  contributorCount: number;
  /** True when the viewer has already contributed. */
  hasContributed: boolean;
  deadline: string | null;
}

export interface GroupGiftDto extends GroupGiftSummary {
  description: string | null;
  imageUrl: string | null;
  organizer: { id: string; displayName: string; avatarUrl: string | null };
  beneficiary: { id: string | null; name: string; avatarUrl: string | null };
  wishlistItemId: string | null;
  productId: string | null;
  /** Hidden from the beneficiary until the gift is revealed. */
  contributions: ContributionDto[];
  conversationId: string | null;
  minContributionMinor: number;
  isOrganizer: boolean;
  createdAt: string;
}

export interface ContributionDto {
  id: string;
  amountMinor: number;
  currency: string;
  isAnonymous: boolean;
  /** Null when anonymous and the viewer is not the organizer. */
  contributor: { id: string; displayName: string; avatarUrl: string | null } | null;
  message: string | null;
  status: PaymentStatus;
  createdAt: string;
}

export interface SurpriseDto {
  id: string;
  title: string;
  beneficiary: { id: string | null; name: string; avatarUrl: string | null };
  organizerId: string;
  memberCount: number;
  budgetMinor: number | null;
  currency: string;
  conversationId: string;
  groupGiftId: string | null;
  revealedAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Wishes, cards, memories, thank-yous
 * ------------------------------------------------------------------ */

export interface BirthdayMessageDto {
  id: string;
  kind: BirthdayMessageKind;
  body: string | null;
  mediaUrl: string | null;
  card: BirthdayCardDto | null;
  sender: { id: string; displayName: string; avatarUrl: string | null } | null;
  recipientId: string;
  /** The birthday year this wish belongs to, e.g. 2026. */
  celebrationYear: number;
  /** Wishes scheduled ahead of time stay hidden until this moment. */
  deliverAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  /** From someone the recipient is not connected with (global birthdays). */
  fromStranger: boolean;
  createdAt: string;
}

export interface BirthdayCardDto {
  id: string;
  templateId: string | null;
  style: CardTemplateStyle;
  backgroundUrl: string | null;
  backgroundColor: string | null;
  headline: string | null;
  body: string | null;
  fontFamily: string | null;
  stickers: Array<{ id: string; url: string; x: number; y: number; scale: number; rotation: number }>;
  photos: Array<{ url: string; x: number; y: number; scale: number; rotation: number }>;
  musicUrl: string | null;
  animation: string | null;
}

export interface CardTemplateDto {
  id: string;
  name: string;
  style: CardTemplateStyle;
  previewUrl: string;
  backgroundUrl: string | null;
  backgroundColor: string | null;
  defaultHeadline: string | null;
  defaultBody: string | null;
  isPremium: boolean;
}

export interface ThankYouDto {
  id: string;
  giftReference: { type: 'RESERVATION' | 'DIGITAL_GIFT' | 'ORDER' | 'GROUP_GIFT'; id: string };
  kind: BirthdayMessageKind;
  body: string | null;
  mediaUrl: string | null;
  sender: { id: string; displayName: string; avatarUrl: string | null };
  recipientId: string;
  createdAt: string;
}

export interface MemoryDto {
  id: string;
  userId: string;
  celebrationYear: number;
  title: string | null;
  note: string | null;
  media: Array<{ id: string; url: string; kind: 'IMAGE' | 'VIDEO'; caption: string | null }>;
  giftCount: number;
  wishCount: number;
  createdAt: string;
}

export interface GiftHistoryEntryDto {
  id: string;
  direction: 'RECEIVED' | 'SENT';
  title: string;
  imageUrl: string | null;
  counterparty: { id: string | null; displayName: string; avatarUrl: string | null } | null;
  occasion: string;
  celebrationYear: number | null;
  priceMinor: number | null;
  currency: string | null;
  /** Whether the price is visible to the viewer. */
  priceHidden: boolean;
  message: string | null;
  thankedAt: string | null;
  source: 'RESERVATION' | 'DIGITAL_GIFT' | 'ORDER' | 'GROUP_GIFT' | 'MANUAL';
  occurredAt: string;
}

/* ------------------------------------------------------------------ *
 * Digital gifts
 * ------------------------------------------------------------------ */

export interface DigitalGiftDto {
  id: string;
  type: DigitalGiftType;
  title: string;
  message: string | null;
  animation: string | null;
  card: BirthdayCardDto | null;
  valueMinor: number | null;
  currency: string | null;
  sender: { id: string; displayName: string; avatarUrl: string | null } | null;
  recipientId: string;
  isAnonymous: boolean;
  deliverAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  redemptionCode: string | null;
  paymentStatus: PaymentStatus | null;
  /** From someone the recipient is not connected with (global birthdays). */
  fromStranger: boolean;
  createdAt: string;
}

export interface DigitalGiftCatalogItem {
  type: DigitalGiftType;
  label: string;
  emoji: string;
  previewUrl: string | null;
  requiresValue: boolean;
  /** Platform fee for sending, if any. */
  feeMinor: number;
  suggestedValuesMinor: number[];
  isPremium: boolean;
}

/* ------------------------------------------------------------------ *
 * Marketplace, orders, delivery
 * ------------------------------------------------------------------ */

export interface ProductDto {
  id: string;
  vendorId: string;
  vendor: { id: string; name: string; logoUrl: string | null; rating: number | null };
  name: string;
  slug: string;
  description: string;
  images: string[];
  priceMinor: number;
  compareAtPriceMinor: number | null;
  currency: string;
  status: ProductStatus;
  categoryIds: string[];
  categories: Array<{ id: string; slug: string; label: string }>;
  tags: string[];
  stock: number | null;
  rating: number | null;
  reviewCount: number;
  deliveryEstimate: string | null;
  deliveryFeeMinor: number | null;
  isPersonalizable: boolean;
  location: { city: string | null; area: string | null; latitude: number | null; longitude: number | null } | null;
  createdAt: string;
}

export interface ProductReviewDto {
  id: string;
  productId: string;
  rating: number;
  title: string | null;
  body: string | null;
  author: { id: string; displayName: string; avatarUrl: string | null } | null;
  createdAt: string;
}

export interface VendorDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  status: string;
  rating: number | null;
  productCount: number;
  city: string | null;
  area: string | null;
  commissionBps: number;
}

export interface OrderDto {
  id: string;
  reference: string;
  buyerId: string;
  status: OrderStatus;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  currency: string;
  items: OrderItemDto[];
  payment: PaymentDto | null;
  delivery: DeliveryDto | null;
  recipient: {
    userId: string | null;
    name: string;
    phone: string | null;
  } | null;
  giftMessage: string | null;
  isAnonymous: boolean;
  scheduledFor: string | null;
  couponCode: string | null;
  createdAt: string;
}

export interface OrderItemDto {
  id: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  unitPriceMinor: number;
  quantity: number;
  totalMinor: number;
  vendorId: string;
  personalization: string | null;
  wishlistItemId: string | null;
}

export interface DeliveryDto {
  id: string;
  status: DeliveryStatus;
  target: DeliveryTarget;
  recipientName: string;
  recipientPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  area: string | null;
  instructions: string | null;
  latitude: number | null;
  longitude: number | null;
  scheduledDate: string | null;
  scheduledWindow: string | null;
  trackingCode: string | null;
  courier: string | null;
  timeline: Array<{ status: DeliveryStatus; note: string | null; at: string }>;
  deliveredAt: string | null;
}

export interface DeliveryAddressDto {
  id: string;
  label: string;
  recipientName: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  area: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  instructions: string | null;
  isDefault: boolean;
}

/* ------------------------------------------------------------------ *
 * Payments & wallet
 * ------------------------------------------------------------------ */

export interface PaymentDto {
  id: string;
  reference: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  purpose: string;
  /** Provider-specific next step, e.g. an M-Pesa STK prompt or a card redirect. */
  action: PaymentAction | null;
  failureReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

export type PaymentAction =
  | { type: 'NONE' }
  | { type: 'AWAIT_STK_PUSH'; message: string; pollAfterSeconds: number }
  | { type: 'REDIRECT'; url: string }
  | { type: 'CLIENT_SECRET'; clientSecret: string; publishableKey: string };

export interface WalletDto {
  id: string;
  balanceMinor: number;
  currency: string;
  transactions: WalletTransactionDto[];
}

export interface WalletTransactionDto {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  reason: string;
  amountMinor: number;
  balanceAfterMinor: number;
  currency: string;
  description: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export interface EventSummaryDto {
  id: string;
  name: string;
  startsAt: string;
  coverImageUrl: string | null;
  venueName: string | null;
  hostId: string;
  myRsvp: RsvpStatus | null;
  guestCount: number;
}

export interface EventDto extends EventSummaryDto {
  description: string | null;
  endsAt: string | null;
  venueAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  host: { id: string; displayName: string; avatarUrl: string | null };
  wishlistId: string | null;
  conversationId: string | null;
  guests: EventGuestDto[];
  counts: { invited: number; going: number; maybe: number; declined: number; pending: number };
  isHost: boolean;
}

export interface EventGuestDto {
  id: string;
  user: { id: string; displayName: string; avatarUrl: string | null } | null;
  name: string;
  rsvp: RsvpStatus;
  plusOnes: number;
  respondedAt: string | null;
}

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

export interface ConversationDto {
  id: string;
  type: ConversationType;
  title: string | null;
  imageUrl: string | null;
  memberCount: number;
  members: Array<{ id: string; displayName: string; avatarUrl: string | null; isAdmin: boolean }>;
  lastMessage: ChatMessageDto | null;
  unreadCount: number;
  /** Set for SURPRISE_GROUP conversations. */
  surpriseId: string | null;
  eventId: string | null;
  groupGiftId: string | null;
  createdAt: string;
}

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  kind: MessageKind;
  body: string | null;
  mediaUrl: string | null;
  durationSeconds: number | null;
  sender: { id: string; displayName: string; avatarUrl: string | null } | null;
  poll: PollDto | null;
  createdAt: string;
  editedAt: string | null;
}

export interface PollDto {
  id: string;
  question: string;
  allowsMultiple: boolean;
  closesAt: string | null;
  options: Array<{ id: string; label: string; voteCount: number; votedByMe: boolean }>;
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  imageUrl: string | null;
  /** Deep link target, e.g. "bday://birthday/123". */
  deepLink: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Home dashboard (spec §45)
 * ------------------------------------------------------------------ */

export interface HomeFeedResponse {
  greeting: string;
  user: { id: string; displayName: string; avatarUrl: string | null };
  /** Non-null on the user's own birthday — triggers the celebration screen. */
  myBirthdayToday: {
    wishCount: number;
    giftCount: number;
    hasSurprise: boolean;
  } | null;
  upcomingBirthdays: TrackedBirthdayDto[];
  giftIdeas: GiftIdeaDto[];
  friendHighlights: Array<{
    user: PublicProfile;
    reason: 'NEW_WISHLIST_ITEMS' | 'BIRTHDAY_SOON' | 'RECENTLY_JOINED';
    detail: string;
  }>;
  activity: ActivityItemDto[];
  /** The "magical" prompt from spec §65, when there is a good one to show. */
  spotlight: SpotlightDto | null;
}

export interface SpotlightDto {
  birthdayId: string;
  personName: string;
  personAvatarUrl: string | null;
  daysUntil: number;
  newWishlistItemCount: number;
  topWish: { id: string; name: string; priceMinor: number | null; currency: string } | null;
  potentialContributors: number;
  canCreateSurprise: boolean;
  lines: string[];
}

export interface GiftIdeaDto {
  /** Either a marketplace product or an AI-suggested idea without a product. */
  productId: string | null;
  name: string;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string;
  reason: string;
  forUser: { id: string; displayName: string } | null;
  source: 'WISHLIST' | 'MARKETPLACE' | 'AI';
}

export interface ActivityItemDto {
  id: string;
  type:
    | 'FRIEND_JOINED'
    | 'WISHLIST_ITEM_ADDED'
    | 'GIFT_SENT'
    | 'GIFT_RECEIVED'
    | 'BIRTHDAY_CELEBRATED'
    | 'THANK_YOU';
  actor: { id: string; displayName: string; avatarUrl: string | null } | null;
  text: string;
  imageUrl: string | null;
  deepLink: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * AI gift assistant (spec §19, §47)
 * ------------------------------------------------------------------ */

export interface GiftSuggestionRequest {
  recipientUserId?: string;
  trackedBirthdayId?: string;
  /** Free-text brief, e.g. "my brother, 28, gaming and football". */
  prompt?: string;
  budgetMinMinor?: number;
  budgetMaxMinor?: number;
  currency?: string;
  relationship?: RelationshipType;
  occasion?: string;
  interests?: string[];
  /** Refinement applied to a previous result set. */
  refinement?: GiftRefinement;
  conversationId?: string;
}

export type GiftRefinement =
  | 'CHEAPER'
  | 'PREMIUM'
  | 'ROMANTIC'
  | 'FUNNY'
  | 'UNEXPECTED'
  | 'MORE_LIKE_THIS'
  | 'SURPRISE_ME';

export interface GiftSuggestionDto {
  rank: number;
  name: string;
  description: string;
  estimatedPriceMinor: number | null;
  currency: string;
  reason: string;
  categorySlug: string | null;
  searchQuery: string;
  /** Populated when the suggestion matched real catalogue stock. */
  product: ProductDto | null;
  /** Populated when it matched something already on their wishlist. */
  wishlistItemId: string | null;
}

export interface GiftSuggestionResponse {
  conversationId: string;
  intro: string;
  suggestions: GiftSuggestionDto[];
  followUps: GiftRefinement[];
  /** Remaining suggestions in the user's daily quota. */
  quotaRemaining: number;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export interface GlobalSearchResponse {
  people: PublicProfile[];
  products: ProductDto[];
  wishlists: Array<{ id: string; title: string; owner: string; shareSlug: string }>;
  events: EventSummaryDto[];
  vendors: VendorDto[];
}

/* ------------------------------------------------------------------ *
 * Admin (spec §40)
 * ------------------------------------------------------------------ */

export interface AdminDashboardStats {
  totalUsers: number;
  activeUsers30d: number;
  newUsers7d: number;
  birthdaysToday: number;
  birthdaysNext7Days: number;
  giftsSent: number;
  digitalGiftsSent: number;
  reservations: number;
  orders: { total: number; awaitingPayment: number; processing: number };
  revenueMinor: number;
  currency: string;
  vendors: { total: number; pending: number; approved: number };
  failedPayments7d: number;
  pendingDeliveries: number;
  openReports: number;
  series: Array<{ date: string; users: number; orders: number; revenueMinor: number }>;
}

export interface AdminUserRow {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  isPremium: boolean;
  friendCount: number;
  orderCount: number;
  lastActiveAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Realtime (spec §43)
 * ------------------------------------------------------------------ */

export const RealtimeEvent = {
  NOTIFICATION_CREATED: 'notification.created',
  WISHLIST_ITEM_ADDED: 'wishlist.item.added',
  WISHLIST_ITEM_UPDATED: 'wishlist.item.updated',
  WISHLIST_ITEM_REMOVED: 'wishlist.item.removed',
  RESERVATION_CHANGED: 'reservation.changed',
  GROUP_GIFT_UPDATED: 'groupGift.updated',
  CONTRIBUTION_ADDED: 'groupGift.contribution.added',
  CHAT_MESSAGE_CREATED: 'chat.message.created',
  CHAT_TYPING: 'chat.typing',
  ORDER_UPDATED: 'order.updated',
  DELIVERY_UPDATED: 'delivery.updated',
  EVENT_RSVP_UPDATED: 'event.rsvp.updated',
  PAYMENT_UPDATED: 'payment.updated',
} as const;
export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

export interface RealtimeEnvelope<T = unknown> {
  event: RealtimeEvent;
  /** Room the event was broadcast to, e.g. `user:123` or `groupGift:456`. */
  room: string;
  payload: T;
  at: string;
}

/* ------------------------------ global birthdays ------------------------------ */

/** Someone celebrating today, as a stranger sees them. Never includes birth year or contact details. */
export interface GlobalCelebrantDto {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string;
  /** Only when they allow their age to be shown. */
  turningAge: number | null;
  note: string | null;
  /** They told us they have rarely or never celebrated their birthday. */
  firstCelebration: boolean;
  cheerCount: number;
  wishCount: number;
  cheeredByMe: boolean;
  /** True when their birthday is today in their own time zone. */
  isToday: boolean;
}

export type GlobalIneligibleReason = 'NO_BIRTH_YEAR' | 'UNDER_AGE' | 'NOT_VERIFIED' | null;

export interface GlobalStatusDto {
  celebrateGlobally: boolean;
  celebrationNote: string | null;
  firstCelebration: boolean;
  /** Whether this user may opt in and celebrate strangers. */
  eligible: boolean;
  ineligibleReason: GlobalIneligibleReason;
  isMyBirthdayToday: boolean;
  /** This celebration year: people who cheered or wished me without knowing me. */
  cheersReceived: number;
  strangerWishesReceived: number;
  strangerGiftsReceived: number;
  /** People I have cheered, wished or gifted in the last 24 hours. */
  peopleCelebratedToday: number;
}

export interface GlobalTodayDto {
  /** Everyone opted in whose birthday is today where they live. */
  totalCelebrating: number;
  countries: number;
  /** Least-celebrated first, so nobody is overlooked. */
  items: GlobalCelebrantDto[];
}

export interface BirthdayTwinsDto {
  month: number | null;
  day: number | null;
  total: number;
  items: GlobalCelebrantDto[];
}

export interface CheerResultDto {
  cheerCount: number;
  cheeredByMe: true;
}
