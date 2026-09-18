import {
  CURRENCY_MINOR_UNITS,
  CURRENCY_SYMBOLS,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../constants';

/**
 * Money is always an integer count of minor units plus a currency code. Never
 * a float: KES 250,000 group-gift progress must add up exactly, and 0.1 + 0.2
 * does not.
 */
export interface Money {
  amountMinor: number;
  currency: SupportedCurrency;
}

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function money(amountMinor: number, currency: SupportedCurrency = DEFAULT_CURRENCY): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(`amountMinor must be an integer, received ${amountMinor}`);
  }
  return { amountMinor, currency };
}

/** Convert a human-entered major amount (e.g. 8500.50) to minor units. */
export function toMinor(amountMajor: number, currency: SupportedCurrency = DEFAULT_CURRENCY): number {
  const factor = CURRENCY_MINOR_UNITS[currency];
  return Math.round(amountMajor * factor);
}

export function toMajor(amountMinor: number, currency: SupportedCurrency = DEFAULT_CURRENCY): number {
  const factor = CURRENCY_MINOR_UNITS[currency];
  return amountMinor / factor;
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function sumMoney(values: Money[], currency: SupportedCurrency = DEFAULT_CURRENCY): Money {
  if (values.length === 0) return { amountMinor: 0, currency };
  const target = values[0]!.currency;
  let total = 0;
  for (const value of values) {
    if (value.currency !== target) {
      throw new Error(`Cannot sum mixed currencies: ${target} and ${value.currency}`);
    }
    total += value.amountMinor;
  }
  return { amountMinor: total, currency: target };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

/**
 * Format for display. Currencies with no minor unit in practice (UGX, TZS) and
 * whole amounts render without decimals; KES 8,500 rather than KES 8,500.00.
 */
export function formatMoney(
  input: Money | number,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
  opts: { withSymbol?: boolean; locale?: string } = {},
): string {
  const value: Money = typeof input === 'number' ? { amountMinor: input, currency } : input;
  const factor = CURRENCY_MINOR_UNITS[value.currency];
  const major = value.amountMinor / factor;
  const hasFraction = factor > 1 && value.amountMinor % factor !== 0;
  const formatted = new Intl.NumberFormat(opts.locale ?? 'en-KE', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(major);
  if (opts.withSymbol === false) return formatted;
  return `${CURRENCY_SYMBOLS[value.currency]} ${formatted}`;
}

/** Percentage of `target` funded by `raised`, clamped to 0-100. */
export function fundingPercent(raised: Money, target: Money): number {
  assertSameCurrency(raised, target);
  if (target.amountMinor <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((raised.amountMinor / target.amountMinor) * 100)));
}

/**
 * Split a total across `n` shares without losing or inventing minor units.
 * The remainder is distributed one unit at a time to the earliest shares.
 */
export function splitEvenly(total: Money, shares: number): Money[] {
  if (!Number.isInteger(shares) || shares <= 0) {
    throw new RangeError('shares must be a positive integer');
  }
  const base = Math.floor(total.amountMinor / shares);
  let remainder = total.amountMinor - base * shares;
  return Array.from({ length: shares }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { amountMinor: base + extra, currency: total.currency };
  });
}

/** Vendor commission split for marketplace orders (spec §54). */
export function applyCommission(
  gross: Money,
  commissionBps: number,
): { platform: Money; vendor: Money } {
  if (commissionBps < 0 || commissionBps > 10_000) {
    throw new RangeError('commissionBps must be between 0 and 10000');
  }
  const platformMinor = Math.round((gross.amountMinor * commissionBps) / 10_000);
  return {
    platform: { amountMinor: platformMinor, currency: gross.currency },
    vendor: { amountMinor: gross.amountMinor - platformMinor, currency: gross.currency },
  };
}
