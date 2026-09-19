/**
 * Canonical machine-readable error codes (spec §51).
 *
 * Every API failure carries one of these in `code`, so clients can branch on
 * behaviour instead of parsing prose. The `message` field is safe to show to a
 * user; it never contains internal details.
 */
export const ErrorCode = {
  // generic
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',

  // auth
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_MAX_ATTEMPTS: 'OTP_MAX_ATTEMPTS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_NOT_VERIFIED: 'ACCOUNT_NOT_VERIFIED',
  OAUTH_TOKEN_INVALID: 'OAUTH_TOKEN_INVALID',
  PASSWORD_NOT_SET: 'PASSWORD_NOT_SET',

  // social
  FRIEND_REQUEST_EXISTS: 'FRIEND_REQUEST_EXISTS',
  ALREADY_FRIENDS: 'ALREADY_FRIENDS',
  CANNOT_FRIEND_SELF: 'CANNOT_FRIEND_SELF',
  NOT_FRIENDS: 'NOT_FRIENDS',
  USER_BLOCKED: 'USER_BLOCKED',
  BLOCKED_BY_USER: 'BLOCKED_BY_USER',

  // wishlist / gifting
  WISHLIST_PRIVATE: 'WISHLIST_PRIVATE',
  WISHLIST_ITEM_NOT_FOUND: 'WISHLIST_ITEM_NOT_FOUND',
  GIFT_ALREADY_RESERVED: 'GIFT_ALREADY_RESERVED',
  GIFT_NOT_RESERVED: 'GIFT_NOT_RESERVED',
  NOT_RESERVATION_OWNER: 'NOT_RESERVATION_OWNER',
  CANNOT_RESERVE_OWN_ITEM: 'CANNOT_RESERVE_OWN_ITEM',
  OWNER_CANNOT_VIEW_RESERVATIONS: 'OWNER_CANNOT_VIEW_RESERVATIONS',
  ITEM_QUANTITY_EXHAUSTED: 'ITEM_QUANTITY_EXHAUSTED',
  URL_UNFURL_FAILED: 'URL_UNFURL_FAILED',

  // group gifting
  GROUP_GIFT_CLOSED: 'GROUP_GIFT_CLOSED',
  GROUP_GIFT_TARGET_EXCEEDED: 'GROUP_GIFT_TARGET_EXCEEDED',
  NOT_GROUP_MEMBER: 'NOT_GROUP_MEMBER',
  BIRTHDAY_PERSON_EXCLUDED: 'BIRTHDAY_PERSON_EXCLUDED',
  CONTRIBUTION_TOO_SMALL: 'CONTRIBUTION_TOO_SMALL',

  // payments
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_NOT_CONFIRMED: 'PAYMENT_NOT_CONFIRMED',
  PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE',
  PAYMENT_ALREADY_SETTLED: 'PAYMENT_ALREADY_SETTLED',
  INSUFFICIENT_WALLET_BALANCE: 'INSUFFICIENT_WALLET_BALANCE',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',

  // global birthdays
  RECIPIENT_NOT_ACCEPTING: 'RECIPIENT_NOT_ACCEPTING',
  PHYSICAL_GIFT_REQUIRES_CONNECTION: 'PHYSICAL_GIFT_REQUIRES_CONNECTION',
  GLOBAL_CELEBRATION_NOT_ELIGIBLE: 'GLOBAL_CELEBRATION_NOT_ELIGIBLE',
  STRANGER_LIMIT_REACHED: 'STRANGER_LIMIT_REACHED',
  NOT_BIRTHDAY_TODAY: 'NOT_BIRTHDAY_TODAY',

  // catalogue / orders
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  VENDOR_NOT_APPROVED: 'VENDOR_NOT_APPROVED',
  ORDER_NOT_CANCELLABLE: 'ORDER_NOT_CANCELLABLE',
  INVALID_DELIVERY_TRANSITION: 'INVALID_DELIVERY_TRANSITION',
  COUPON_INVALID: 'COUPON_INVALID',
  COUPON_EXPIRED: 'COUPON_EXPIRED',
  COUPON_USAGE_EXCEEDED: 'COUPON_USAGE_EXCEEDED',

  // events
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  NOT_EVENT_HOST: 'NOT_EVENT_HOST',
  NOT_INVITED: 'NOT_INVITED',

  // ai
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',

  // storage
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Default user-facing copy per code. Services may override per situation. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Some of the information you entered is not valid.',
  NOT_FOUND: 'We could not find what you were looking for.',
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  CONFLICT: 'That action conflicts with the current state.',
  PAYLOAD_TOO_LARGE: 'That file or request is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'That file type is not supported.',

  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have permission to do that.',
  INVALID_CREDENTIALS: 'Those sign-in details are incorrect.',
  EMAIL_ALREADY_REGISTERED: 'An account with that email already exists.',
  PHONE_ALREADY_REGISTERED: 'An account with that phone number already exists.',
  USERNAME_TAKEN: 'That username is already taken.',
  OTP_INVALID: 'That verification code is incorrect.',
  OTP_EXPIRED: 'That verification code has expired. Request a new one.',
  OTP_MAX_ATTEMPTS: 'Too many incorrect codes. Please request a new one.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  TOKEN_INVALID: 'Your session is no longer valid. Please sign in again.',
  TOKEN_REVOKED: 'Your session was signed out. Please sign in again.',
  ACCOUNT_SUSPENDED: 'This account has been suspended.',
  ACCOUNT_NOT_VERIFIED: 'Please verify your account to continue.',
  OAUTH_TOKEN_INVALID: 'We could not verify that sign-in. Please try again.',
  PASSWORD_NOT_SET: 'This account signs in with a social provider.',

  FRIEND_REQUEST_EXISTS: 'A friend request is already pending.',
  ALREADY_FRIENDS: 'You are already connected.',
  CANNOT_FRIEND_SELF: 'You cannot add yourself.',
  NOT_FRIENDS: 'You need to be friends to do that.',
  USER_BLOCKED: 'You have blocked this person.',
  BLOCKED_BY_USER: 'This action is not available.',

  WISHLIST_PRIVATE: 'This wishlist is private.',
  WISHLIST_ITEM_NOT_FOUND: 'That wishlist item no longer exists.',
  GIFT_ALREADY_RESERVED: 'Someone is already getting this gift.',
  GIFT_NOT_RESERVED: 'This gift has not been reserved.',
  NOT_RESERVATION_OWNER: 'Only the person who reserved this gift can change it.',
  CANNOT_RESERVE_OWN_ITEM: 'You cannot reserve a gift on your own wishlist.',
  OWNER_CANNOT_VIEW_RESERVATIONS: 'Surprise! You cannot peek at your own gifts.',
  ITEM_QUANTITY_EXHAUSTED: 'All of these have been claimed already.',
  URL_UNFURL_FAILED: 'We could not read that product link. Please add the details manually.',

  GROUP_GIFT_CLOSED: 'This group gift is no longer accepting contributions.',
  GROUP_GIFT_TARGET_EXCEEDED: 'That would take the group gift past its goal.',
  NOT_GROUP_MEMBER: 'You are not part of this group.',
  BIRTHDAY_PERSON_EXCLUDED: 'The birthday person cannot be part of their own surprise.',
  CONTRIBUTION_TOO_SMALL: 'That contribution is below the minimum amount.',

  PAYMENT_FAILED: 'The payment could not be completed.',
  PAYMENT_NOT_CONFIRMED: 'We are still waiting for the payment to be confirmed.',
  PAYMENT_PROVIDER_UNAVAILABLE: 'That payment method is unavailable right now.',
  PAYMENT_ALREADY_SETTLED: 'This payment has already been settled.',
  INSUFFICIENT_WALLET_BALANCE: 'Your wallet balance is too low.',
  CURRENCY_MISMATCH: 'The currencies do not match.',
  WEBHOOK_SIGNATURE_INVALID: 'The request signature could not be verified.',
  DUPLICATE_REQUEST: 'This request has already been processed.',

  RECIPIENT_NOT_ACCEPTING: 'They only receive wishes and gifts from people they know.',
  PHYSICAL_GIFT_REQUIRES_CONNECTION:
    'Physical gifts are only for people you are connected with. Send a digital gift instead, or connect first.',
  GLOBAL_CELEBRATION_NOT_ELIGIBLE: 'Global birthdays are for verified adults (18+) with a full date of birth.',
  STRANGER_LIMIT_REACHED: 'You have celebrated so many people today! Come back tomorrow to spread more joy.',
  NOT_BIRTHDAY_TODAY: 'It is not their birthday today.',

  PRODUCT_UNAVAILABLE: 'This gift is currently unavailable.',
  VENDOR_NOT_APPROVED: 'This vendor is not approved to sell yet.',
  ORDER_NOT_CANCELLABLE: 'This order can no longer be cancelled.',
  INVALID_DELIVERY_TRANSITION: 'That delivery status change is not allowed.',
  COUPON_INVALID: 'That promo code is not valid.',
  COUPON_EXPIRED: 'That promo code has expired.',
  COUPON_USAGE_EXCEEDED: 'That promo code has been fully used.',

  EVENT_NOT_FOUND: 'That event no longer exists.',
  NOT_EVENT_HOST: 'Only the event host can do that.',
  NOT_INVITED: 'You have not been invited to this event.',

  AI_UNAVAILABLE: 'The gift assistant is unavailable right now.',
  AI_QUOTA_EXCEEDED: 'You have used all your gift suggestions for now.',

  UPLOAD_FAILED: 'That upload did not go through. Please try again.',
  FILE_TYPE_NOT_ALLOWED: 'That file type is not allowed.',
};

/** HTTP status to use for each code when it is thrown without an explicit one. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,

  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_CREDENTIALS: 401,
  EMAIL_ALREADY_REGISTERED: 409,
  PHONE_ALREADY_REGISTERED: 409,
  USERNAME_TAKEN: 409,
  OTP_INVALID: 400,
  OTP_EXPIRED: 410,
  OTP_MAX_ATTEMPTS: 429,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  TOKEN_REVOKED: 401,
  ACCOUNT_SUSPENDED: 403,
  ACCOUNT_NOT_VERIFIED: 403,
  OAUTH_TOKEN_INVALID: 401,
  PASSWORD_NOT_SET: 400,

  FRIEND_REQUEST_EXISTS: 409,
  ALREADY_FRIENDS: 409,
  CANNOT_FRIEND_SELF: 400,
  NOT_FRIENDS: 403,
  USER_BLOCKED: 403,
  BLOCKED_BY_USER: 404,

  WISHLIST_PRIVATE: 403,
  WISHLIST_ITEM_NOT_FOUND: 404,
  GIFT_ALREADY_RESERVED: 409,
  GIFT_NOT_RESERVED: 409,
  NOT_RESERVATION_OWNER: 403,
  CANNOT_RESERVE_OWN_ITEM: 400,
  OWNER_CANNOT_VIEW_RESERVATIONS: 403,
  ITEM_QUANTITY_EXHAUSTED: 409,
  URL_UNFURL_FAILED: 422,

  GROUP_GIFT_CLOSED: 409,
  GROUP_GIFT_TARGET_EXCEEDED: 409,
  NOT_GROUP_MEMBER: 403,
  BIRTHDAY_PERSON_EXCLUDED: 403,
  CONTRIBUTION_TOO_SMALL: 400,

  PAYMENT_FAILED: 402,
  PAYMENT_NOT_CONFIRMED: 409,
  PAYMENT_PROVIDER_UNAVAILABLE: 503,
  PAYMENT_ALREADY_SETTLED: 409,
  INSUFFICIENT_WALLET_BALANCE: 402,
  CURRENCY_MISMATCH: 400,
  WEBHOOK_SIGNATURE_INVALID: 401,
  DUPLICATE_REQUEST: 409,

  RECIPIENT_NOT_ACCEPTING: 403,
  PHYSICAL_GIFT_REQUIRES_CONNECTION: 403,
  GLOBAL_CELEBRATION_NOT_ELIGIBLE: 403,
  STRANGER_LIMIT_REACHED: 429,
  NOT_BIRTHDAY_TODAY: 409,

  PRODUCT_UNAVAILABLE: 409,
  VENDOR_NOT_APPROVED: 403,
  ORDER_NOT_CANCELLABLE: 409,
  INVALID_DELIVERY_TRANSITION: 409,
  COUPON_INVALID: 400,
  COUPON_EXPIRED: 410,
  COUPON_USAGE_EXCEEDED: 409,

  EVENT_NOT_FOUND: 404,
  NOT_EVENT_HOST: 403,
  NOT_INVITED: 403,

  AI_UNAVAILABLE: 503,
  AI_QUOTA_EXCEEDED: 429,

  UPLOAD_FAILED: 500,
  FILE_TYPE_NOT_ALLOWED: 415,
};
