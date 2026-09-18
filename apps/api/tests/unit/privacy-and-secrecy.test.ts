import type { WishlistItemRow } from '../../src/mappers/wishlist.mapper';
import { toItemReservationView, toWishlistItemDto } from '../../src/mappers/wishlist.mapper';
import { toPublicProfile, type ProfileForViewer } from '../../src/mappers/user.mapper';
import { canSee, isGiftSecretFrom } from '../../src/services/access.service';

const now = new Date('2026-09-15T09:00:00Z');

function reservation(overrides: Partial<{ reserverId: string; isAnonymous: boolean; status: 'RESERVED' | 'PURCHASED' | 'DELIVERED' | 'CANCELLED' }> = {}) {
  const reserverId = overrides.reserverId ?? 'user_reserver_1';
  return {
    id: 'res_1234567890',
    wishlistItemId: 'item_1234567890',
    reserverId,
    quantity: 1,
    status: overrides.status ?? 'RESERVED',
    note: 'Getting the blue one',
    isAnonymous: overrides.isAnonymous ?? false,
    purchasedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    orderId: null,
    createdAt: now,
    updatedAt: now,
    reserver: { id: reserverId, username: 'john', profile: { displayName: 'John', avatarUrl: null } },
  };
}

describe('secret reservations (spec §58 rule 2)', () => {
  it('never shows a reservation to the wishlist owner', () => {
    const view = toItemReservationView([reservation()] as never, { viewerId: 'owner_1', isOwner: true });
    expect(view).toBeNull();
  });

  it('never shows the owner that an item is reserved through its status either', () => {
    const item = {
      id: 'item_1234567890',
      wishlistId: 'wl_1234567890',
      name: 'AirPods',
      description: null,
      imageUrl: null,
      priceMinor: 2_500_000,
      currency: 'KES',
      productUrl: null,
      merchant: null,
      category: null,
      priority: 'MUST_HAVE',
      size: null,
      color: null,
      notes: null,
      quantity: 1,
      reservedQuantity: 1,
      status: 'RESERVED',
      position: 0,
      preferredVendorId: null,
      productId: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      reservations: [reservation()],
      groupGifts: [],
    } as unknown as WishlistItemRow;

    const ownerView = toWishlistItemDto(item, { viewerId: 'owner_1', isOwner: true });
    expect(ownerView.reservation).toBeNull();
    expect(ownerView.status).toBe('AVAILABLE');

    const friendView = toWishlistItemDto(item, { viewerId: 'friend_2', isOwner: false });
    expect(friendView.reservation?.status).toBe('RESERVED');
    expect(friendView.status).toBe('RESERVED');
  });

  it('shows other gifters that it is taken, but not by whom when anonymous', () => {
    const view = toItemReservationView([reservation({ isAnonymous: true })] as never, { viewerId: 'friend_2', isOwner: false });
    expect(view?.status).toBe('RESERVED');
    expect(view?.reservedBy).toBeNull();
    expect(view?.isMine).toBe(false);
  });

  it('tells the reserver it is theirs', () => {
    const view = toItemReservationView([reservation()] as never, { viewerId: 'user_reserver_1', isOwner: false });
    expect(view?.isMine).toBe(true);
  });

  it('flags the beneficiary as the person a gift is secret from', () => {
    expect(isGiftSecretFrom('sarah', 'sarah')).toBe(true);
    expect(isGiftSecretFrom('john', 'sarah')).toBe(false);
    expect(isGiftSecretFrom(null, 'sarah')).toBe(false);
  });
});

describe('visibility', () => {
  const stranger = { viewerId: 'x', isSelf: false, isFriend: false, isBlocked: false };
  const friend = { viewerId: 'x', isSelf: false, isFriend: true, isBlocked: false };
  const blockedFriend = { ...friend, isBlocked: true };

  it('applies public / friends / private', () => {
    expect(canSee('PUBLIC', stranger)).toBe(true);
    expect(canSee('FRIENDS', stranger)).toBe(false);
    expect(canSee('FRIENDS', friend)).toBe(true);
    expect(canSee('PRIVATE', friend)).toBe(false);
  });

  it('lets a block override everything', () => {
    expect(canSee('PUBLIC', blockedFriend)).toBe(false);
  });

  it('hides birth year and age, and does not leak the year through turningAge', () => {
    const user = {
      id: 'sarah_123456',
      username: 'sarah',
      profile: { displayName: 'Sarah', avatarUrl: null, bio: 'Hi', birthMonth: 9, birthDay: 21, birthYear: 1996, giftPreferences: {} },
      privacy: {
        profileVisibility: 'FRIENDS',
        birthdayVisibility: 'FRIENDS',
        wishlistVisibility: 'FRIENDS',
        giftHistoryVisibility: 'PRIVATE',
        showAge: false,
        showBirthYear: false,
        discoverableByPhone: true,
        discoverableByEmail: true,
        discoverableByUsername: true,
      },
      interests: [],
    } as unknown as ProfileForViewer;

    const profile = toPublicProfile(user, friend, {}, now);
    expect(profile.birthday?.day).toBe(21);
    expect(profile.birthday?.year).toBeNull();
    expect(profile.birthday?.countdown.turningAge).toBeNull();
    expect(profile.age).toBeNull();

    const strangerView = toPublicProfile(user, stranger, {}, now);
    expect(strangerView.birthday).toBeNull();
    expect(strangerView.bio).toBeNull();
  });
});
