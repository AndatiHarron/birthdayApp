import { formatMoney, isSupportedCurrency } from '@bday/shared';

export function money(amountMinor: number | null | undefined, currency = 'KES'): string {
  if (amountMinor == null) return '—';
  return isSupportedCurrency(currency) ? formatMoney(amountMinor, currency) : `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function date(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium' }).format(new Date(value));
}

export function number(value: number | null | undefined): string {
  return value == null ? '—' : new Intl.NumberFormat('en-KE').format(value);
}

export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase());
}

const TONES: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'brand'> = {
  ACTIVE: 'ok',
  APPROVED: 'ok',
  SUCCESSFUL: 'ok',
  PAID: 'ok',
  FULFILLED: 'ok',
  DELIVERED: 'ok',
  RESOLVED: 'ok',
  REFUNDED: 'info',
  PROCESSING: 'info',
  DISPATCHED: 'info',
  OUT_FOR_DELIVERY: 'info',
  UNDER_REVIEW: 'info',
  PENDING: 'warn',
  PENDING_REVIEW: 'warn',
  PENDING_VERIFICATION: 'warn',
  AWAITING_PAYMENT: 'warn',
  OPEN: 'warn',
  DRAFT: 'warn',
  SUSPENDED: 'bad',
  REJECTED: 'bad',
  FAILED: 'bad',
  CANCELLED: 'bad',
  DEACTIVATED: 'bad',
  OUT_OF_STOCK: 'bad',
  ADMIN: 'brand',
  SUPER_ADMIN: 'brand',
  VENDOR: 'info',
};

export function tone(status: string | null | undefined): string {
  return status ? TONES[status] ?? '' : '';
}
