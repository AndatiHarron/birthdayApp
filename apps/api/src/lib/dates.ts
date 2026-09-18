/**
 * Time-zone-aware civil date helpers.
 *
 * Reminders and "birthday morning" pushes have to fire at 8am *where the user
 * is*, and a birthday has to be "today" according to their calendar rather than
 * the server's. Everything here therefore converts between an instant and a
 * civil date in a named IANA zone, using Intl rather than a date library.
 */

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Safe fallback so a corrupt profile value cannot crash the reminder worker. */
export function safeTimeZone(timeZone: string | null | undefined, fallback = 'Africa/Nairobi'): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : fallback;
}

/** The wall-clock date and hour in `timeZone` at instant `at`. */
export function zonedNow(
  timeZone: string,
  at: Date = new Date(),
): CivilDate & { hour: number; minute: number } {
  const parts = partsFormatter(safeTimeZone(timeZone)).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

export function toCivilDateString(date: CivilDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(
    date.day,
  ).padStart(2, '0')}`;
}

export function parseCivilDateString(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Whole days from `from` to `to`, both read as civil dates. */
export function civilDaysBetween(from: CivilDate, to: CivilDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000);
}

export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * The UTC instant corresponding to `hour:00` local time on `date` in `timeZone`.
 *
 * Derived by probing the offset rather than assuming one, so it stays correct
 * across DST boundaries in zones that observe them.
 */
export function zonedTimeToUtc(date: CivilDate, hour: number, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, 0, 0);
  const probe = zonedNow(zone, new Date(guess));
  const probeUtc = Date.UTC(probe.year, probe.month - 1, probe.day, probe.hour, probe.minute);
  const offset = probeUtc - guess;
  return new Date(guess - offset);
}

/** Start and end instants of a civil day in a given zone. */
export function dayBoundsUtc(date: CivilDate, timeZone: string): { start: Date; end: Date } {
  const start = zonedTimeToUtc(date, 0, timeZone);
  const end = zonedTimeToUtc(addCivilDays(date, 1), 0, timeZone);
  return { start, end };
}

export function startOfUtcDay(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 86_400_000);
}

export function addSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}

/**
 * Is `hour` inside a quiet-hours window? Windows may wrap midnight
 * (e.g. 22 → 7), which a naive `start <= h < end` gets wrong.
 */
export function isWithinQuietHours(
  hour: number,
  start: number | null | undefined,
  end: number | null | undefined,
): boolean {
  if (start == null || end == null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
