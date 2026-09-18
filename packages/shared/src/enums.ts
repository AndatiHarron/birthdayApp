/**
 * Domain enums.
 *
 * These are the single source of truth for enumerated values across the API,
 * the mobile app and the admin dashboard. Every value here has a matching
 * member in the Prisma schema (`apps/api/prisma/schema.prisma`) — if you add a
 * value here, add it there too and generate a migration.
 */

export const UserRole = {
  USER: 'USER',
  VENDOR: 'VENDOR',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const AuthProvider = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  GOOGLE: 'GOOGLE',
  APPLE: 'APPLE',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const OtpPurpose = {
  PHONE_VERIFICATION: 'PHONE_VERIFICATION',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  LOGIN: 'LOGIN',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

/** Who may see a given piece of profile data. */
export const Visibility = {
  PUBLIC: 'PUBLIC',
  FRIENDS: 'FRIENDS',
  PRIVATE: 'PRIVATE',
} as const;
export type Visibility = (typeof Visibility)[keyof typeof Visibility];

export const RelationshipType = {
  FAMILY: 'FAMILY',
  CLOSE_FRIEND: 'CLOSE_FRIEND',
  FRIEND: 'FRIEND',
  COLLEAGUE: 'COLLEAGUE',
  PARTNER: 'PARTNER',
  OTHER: 'OTHER',
} as const;
export type RelationshipType = (typeof RelationshipType)[keyof typeof RelationshipType];

export const FriendshipStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
} as const;
export type FriendshipStatus = (typeof FriendshipStatus)[keyof typeof FriendshipStatus];

/**
 * How a tracked birthday came to exist. MANUAL entries are people who are not
 * (yet) users of the platform; LINKED entries mirror a real user's own birthday.
 */
export const BirthdaySource = {
  MANUAL: 'MANUAL',
  CONTACT_IMPORT: 'CONTACT_IMPORT',
  LINKED_USER: 'LINKED_USER',
} as const;
export type BirthdaySource = (typeof BirthdaySource)[keyof typeof BirthdaySource];

export const WishlistItemPriority = {
  MUST_HAVE: 'MUST_HAVE',
  HIGH: 'HIGH',
  NICE_TO_HAVE: 'NICE_TO_HAVE',
} as const;
export type WishlistItemPriority = (typeof WishlistItemPriority)[keyof typeof WishlistItemPriority];

/** Lifecycle of a single wishlist item, from the gifter's point of view. */
export const WishlistItemStatus = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  PURCHASED: 'PURCHASED',
  DELIVERED: 'DELIVERED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type WishlistItemStatus = (typeof WishlistItemStatus)[keyof typeof WishlistItemStatus];

export const ReservationStatus = {
  RESERVED: 'RESERVED',
  PURCHASED: 'PURCHASED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export const GroupGiftStatus = {
  OPEN: 'OPEN',
  FUNDED: 'FUNDED',
  PURCHASED: 'PURCHASED',
  DELIVERED: 'DELIVERED',
  REVEALED: 'REVEALED',
  CANCELLED: 'CANCELLED',
} as const;
export type GroupGiftStatus = (typeof GroupGiftStatus)[keyof typeof GroupGiftStatus];

export const PaymentStatus = {
  PENDING: 'PENDING',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentProvider = {
  MPESA: 'MPESA',
  CARD: 'CARD',
  STRIPE: 'STRIPE',
  PAYPAL: 'PAYPAL',
  WALLET: 'WALLET',
  MANUAL: 'MANUAL',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

export const PaymentPurpose = {
  GIFT_ORDER: 'GIFT_ORDER',
  GROUP_CONTRIBUTION: 'GROUP_CONTRIBUTION',
  DIGITAL_GIFT: 'DIGITAL_GIFT',
  WALLET_TOPUP: 'WALLET_TOPUP',
  PREMIUM_SUBSCRIPTION: 'PREMIUM_SUBSCRIPTION',
} as const;
export type PaymentPurpose = (typeof PaymentPurpose)[keyof typeof PaymentPurpose];

export const OrderStatus = {
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAID: 'PAID',
  PROCESSING: 'PROCESSING',
  FULFILLED: 'FULFILLED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Spec §58 rule 6 — delivery must move through these states in order. */
export const DeliveryStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  DISPATCHED: 'DISPATCHED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const DeliveryTarget = {
  RECIPIENT: 'RECIPIENT',
  SENDER: 'SENDER',
} as const;
export type DeliveryTarget = (typeof DeliveryTarget)[keyof typeof DeliveryTarget];

export const DigitalGiftType = {
  CARD: 'CARD',
  FLOWERS: 'FLOWERS',
  CAKE: 'CAKE',
  VOUCHER: 'VOUCHER',
  AIRTIME: 'AIRTIME',
  DATA_BUNDLE: 'DATA_BUNDLE',
  EGIFT_CARD: 'EGIFT_CARD',
  ANIMATION: 'ANIMATION',
  WALLET_CREDIT: 'WALLET_CREDIT',
} as const;
export type DigitalGiftType = (typeof DigitalGiftType)[keyof typeof DigitalGiftType];

export const BirthdayMessageKind = {
  TEXT: 'TEXT',
  GIF: 'GIF',
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  VOICE: 'VOICE',
  CARD: 'CARD',
} as const;
export type BirthdayMessageKind = (typeof BirthdayMessageKind)[keyof typeof BirthdayMessageKind];

export const CardTemplateStyle = {
  ROMANTIC: 'ROMANTIC',
  FUNNY: 'FUNNY',
  FRIENDSHIP: 'FRIENDSHIP',
  FAMILY: 'FAMILY',
  PROFESSIONAL: 'PROFESSIONAL',
  SIMPLE: 'SIMPLE',
  ELEGANT: 'ELEGANT',
} as const;
export type CardTemplateStyle = (typeof CardTemplateStyle)[keyof typeof CardTemplateStyle];

export const ConversationType = {
  DIRECT: 'DIRECT',
  SURPRISE_GROUP: 'SURPRISE_GROUP',
  EVENT: 'EVENT',
} as const;
export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType];

export const MessageKind = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  VOICE: 'VOICE',
  SYSTEM: 'SYSTEM',
  POLL: 'POLL',
} as const;
export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

export const RsvpStatus = {
  PENDING: 'PENDING',
  GOING: 'GOING',
  MAYBE: 'MAYBE',
  DECLINED: 'DECLINED',
} as const;
export type RsvpStatus = (typeof RsvpStatus)[keyof typeof RsvpStatus];

export const NotificationType = {
  BIRTHDAY_REMINDER: 'BIRTHDAY_REMINDER',
  BIRTHDAY_TODAY: 'BIRTHDAY_TODAY',
  WISHLIST_UPDATED: 'WISHLIST_UPDATED',
  GIFT_RESERVED: 'GIFT_RESERVED',
  GIFT_RESERVATION_CANCELLED: 'GIFT_RESERVATION_CANCELLED',
  GROUP_GIFT_INVITE: 'GROUP_GIFT_INVITE',
  GROUP_GIFT_CONTRIBUTION: 'GROUP_GIFT_CONTRIBUTION',
  GROUP_GIFT_FUNDED: 'GROUP_GIFT_FUNDED',
  GIFT_RECEIVED: 'GIFT_RECEIVED',
  THANK_YOU_RECEIVED: 'THANK_YOU_RECEIVED',
  BIRTHDAY_WISH_RECEIVED: 'BIRTHDAY_WISH_RECEIVED',
  FRIEND_REQUEST: 'FRIEND_REQUEST',
  FRIEND_REQUEST_ACCEPTED: 'FRIEND_REQUEST_ACCEPTED',
  DELIVERY_UPDATE: 'DELIVERY_UPDATE',
  ORDER_UPDATE: 'ORDER_UPDATE',
  PAYMENT_UPDATE: 'PAYMENT_UPDATE',
  EVENT_INVITE: 'EVENT_INVITE',
  EVENT_RSVP: 'EVENT_RSVP',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationChannel = {
  PUSH: 'PUSH',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  IN_APP: 'IN_APP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const VendorStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  SUSPENDED: 'SUSPENDED',
  REJECTED: 'REJECTED',
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];

export const ProductStatus = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  ACTIVE: 'ACTIVE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  REJECTED: 'REJECTED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export const WalletTransactionType = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;
export type WalletTransactionType = (typeof WalletTransactionType)[keyof typeof WalletTransactionType];

export const WalletTransactionReason = {
  TOPUP: 'TOPUP',
  GIFT_RECEIVED: 'GIFT_RECEIVED',
  GIFT_SENT: 'GIFT_SENT',
  CONTRIBUTION: 'CONTRIBUTION',
  REFUND: 'REFUND',
  VOUCHER_REDEMPTION: 'VOUCHER_REDEMPTION',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type WalletTransactionReason =
  (typeof WalletTransactionReason)[keyof typeof WalletTransactionReason];

export const ReportReason = {
  SPAM: 'SPAM',
  HARASSMENT: 'HARASSMENT',
  IMPERSONATION: 'IMPERSONATION',
  INAPPROPRIATE_CONTENT: 'INAPPROPRIATE_CONTENT',
  FRAUD: 'FRAUD',
  OTHER: 'OTHER',
} as const;
export type ReportReason = (typeof ReportReason)[keyof typeof ReportReason];

export const ReportStatus = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const PromotionType = {
  PERCENTAGE_DISCOUNT: 'PERCENTAGE_DISCOUNT',
  FIXED_DISCOUNT: 'FIXED_DISCOUNT',
  FREE_DELIVERY: 'FREE_DELIVERY',
  BUNDLE: 'BUNDLE',
} as const;
export type PromotionType = (typeof PromotionType)[keyof typeof PromotionType];
