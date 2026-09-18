import { DELIVERY_FLOW } from '../constants';
import type { DeliveryStatus } from '../enums';

/**
 * Delivery state machine (spec §58 rule 6).
 *
 * The happy path is strictly ordered — Pending → Processing → Dispatched →
 * Out for Delivery → Delivered — and may only advance one step at a time, so
 * the recipient's timeline never skips a stage. Exceptions (failed, returned,
 * cancelled) branch off the happy path and are terminal, except that a failed
 * attempt may be retried by going back out for delivery.
 */

const TERMINAL: readonly DeliveryStatus[] = ['DELIVERED', 'RETURNED', 'CANCELLED'];

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return TERMINAL.includes(status);
}

export function allowedDeliveryTransitions(from: DeliveryStatus): DeliveryStatus[] {
  if (isTerminalDeliveryStatus(from)) return [];

  if (from === 'FAILED') return ['OUT_FOR_DELIVERY', 'RETURNED', 'CANCELLED'];

  const index = (DELIVERY_FLOW as readonly string[]).indexOf(from);
  const next = index >= 0 ? (DELIVERY_FLOW[index + 1] as DeliveryStatus | undefined) : undefined;
  const options: DeliveryStatus[] = next ? [next] : [];

  // Nothing has left the shop yet, so it can still be cancelled outright.
  if (from === 'PENDING' || from === 'PROCESSING') options.push('CANCELLED');
  // Once it is on the road it can fail or be returned instead.
  if (from === 'DISPATCHED' || from === 'OUT_FOR_DELIVERY') options.push('FAILED', 'RETURNED');

  return options;
}

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return allowedDeliveryTransitions(from).includes(to);
}

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  DISPATCHED: 'Dispatched',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  FAILED: 'Delivery failed',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled',
};
