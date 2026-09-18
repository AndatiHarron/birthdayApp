import {
  allowedDeliveryTransitions,
  applyCommission,
  canTransitionDelivery,
  formatMoney,
  fundingPercent,
  splitEvenly,
  sumMoney,
  toMinor,
} from '@bday/shared';

describe('money', () => {
  it('formats whole KES amounts without decimals', () => {
    expect(formatMoney(850_000, 'KES')).toBe('KES 8,500');
    expect(formatMoney(850_050, 'KES')).toBe('KES 8,500.50');
  });

  it('converts major to minor units per currency', () => {
    expect(toMinor(8500.5, 'KES')).toBe(850_050);
    expect(toMinor(5000, 'UGX')).toBe(5000);
  });

  it('tracks group gift progress exactly (spec §15 example)', () => {
    const contributions = [5_000_000, 2_500_000, 4_000_000, 5_000_000].map((amountMinor) => ({ amountMinor, currency: 'KES' as const }));
    const raised = sumMoney(contributions, 'KES');
    expect(raised.amountMinor).toBe(16_500_000);
    expect(fundingPercent(raised, { amountMinor: 25_000_000, currency: 'KES' })).toBe(66);
  });

  it('refuses to add mixed currencies', () => {
    expect(() => sumMoney([{ amountMinor: 1, currency: 'KES' }, { amountMinor: 1, currency: 'USD' }])).toThrow();
  });

  it('splits without losing a cent', () => {
    const shares = splitEvenly({ amountMinor: 1000, currency: 'KES' }, 3);
    expect(shares.map((share) => share.amountMinor)).toEqual([334, 333, 333]);
    expect(shares.reduce((sum, share) => sum + share.amountMinor, 0)).toBe(1000);
  });

  it('applies vendor commission in basis points', () => {
    const { platform, vendor } = applyCommission({ amountMinor: 1_000_000, currency: 'KES' }, 1000);
    expect(platform.amountMinor).toBe(100_000);
    expect(vendor.amountMinor).toBe(900_000);
  });
});

describe('delivery state machine (spec §58 rule 6)', () => {
  it('follows the pipeline one step at a time', () => {
    expect(canTransitionDelivery('PENDING', 'PROCESSING')).toBe(true);
    expect(canTransitionDelivery('PROCESSING', 'DISPATCHED')).toBe(true);
    expect(canTransitionDelivery('DISPATCHED', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(canTransitionDelivery('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
  });

  it('does not allow skipping stages or moving backwards', () => {
    expect(canTransitionDelivery('PENDING', 'DELIVERED')).toBe(false);
    expect(canTransitionDelivery('DISPATCHED', 'PROCESSING')).toBe(false);
  });

  it('treats delivered, returned and cancelled as terminal', () => {
    expect(allowedDeliveryTransitions('DELIVERED')).toEqual([]);
    expect(allowedDeliveryTransitions('CANCELLED')).toEqual([]);
    expect(allowedDeliveryTransitions('RETURNED')).toEqual([]);
  });

  it('only allows cancellation before dispatch, and retry after a failed attempt', () => {
    expect(canTransitionDelivery('PROCESSING', 'CANCELLED')).toBe(true);
    expect(canTransitionDelivery('OUT_FOR_DELIVERY', 'CANCELLED')).toBe(false);
    expect(canTransitionDelivery('FAILED', 'OUT_FOR_DELIVERY')).toBe(true);
  });
});
