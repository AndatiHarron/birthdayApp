import type { DigitalGiftType, WishlistItemPriority } from '@bday/shared';
import type { IconName } from '../components/Icon';

/**
 * Icons for shared catalogue data. The API and admin keep their emoji fields
 * (notifications, seed data); the app shows these line icons instead.
 */

const INTERESTS: Record<string, IconName> = {
  technology: 'laptop',
  fashion: 'shirt',
  beauty: 'sparkles',
  fitness: 'fitness',
  gaming: 'gaming',
  books: 'book',
  music: 'headphones',
  travel: 'plane',
  food: 'food',
  sports: 'sports',
  home: 'sofa',
  photography: 'camera',
  cars: 'car',
  art: 'palette',
  movies: 'movies',
  outdoors: 'tent',
  pets: 'pets',
  gardening: 'garden',
  crafts: 'crafts',
  wellness: 'wellness',
  coffee: 'coffee',
  football: 'sports',
  skincare: 'skincare',
  stationery: 'pen',
};

const CATEGORIES: Record<string, IconName> = {
  electronics: 'plug',
  phones: 'smartphone',
  computers: 'laptop',
  watches: 'watch',
  fashion: 'shirt',
  shoes: 'shoes',
  beauty: 'sparkles',
  flowers: 'flower',
  cakes: 'cake',
  chocolates: 'sweets',
  books: 'book',
  toys: 'toy',
  home: 'sofa',
  personalized: 'edit',
  experiences: 'ticket',
  gaming: 'gaming',
  fitness: 'fitness',
  vouchers: 'ticket',
};

const SHELVES: Record<string, IconName> = {
  popular: 'star',
  for_her: 'user',
  for_him: 'user',
  family: 'users',
  friends: 'users',
  colleagues: 'briefcase',
  under_1000: 'coins',
  under_5000: 'coins',
  premium: 'gem',
  personalized: 'edit',
};

export const DIGITAL_GIFT_ICONS: Record<DigitalGiftType, IconName> = {
  CARD: 'mail',
  FLOWERS: 'flower',
  CAKE: 'cake',
  ANIMATION: 'sparkles',
  VOUCHER: 'ticket',
  AIRTIME: 'signal',
  DATA_BUNDLE: 'wifi',
  EGIFT_CARD: 'card',
  WALLET_CREDIT: 'wallet',
};

export const PRIORITY_ICONS: Record<WishlistItemPriority, IconName> = {
  MUST_HAVE: 'heart',
  HIGH: 'star',
  NICE_TO_HAVE: 'smile',
};

export const interestIcon = (slug: string): IconName | undefined => INTERESTS[slug];
export const categoryIcon = (slug: string): IconName | undefined => CATEGORIES[slug];
export const shelfIcon = (key: string): IconName | undefined => SHELVES[key];
