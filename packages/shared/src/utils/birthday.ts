/**
 * Birthday maths.
 *
 * Birthdays are stored as a (month, day, optional year) triple rather than a
 * timestamp. A birthday is a calendar anniversary, not an instant: storing it
 * as a `Date` means a user in Nairobi and a user in Los Angeles disagree about
 * which day it is. Everything here therefore works on civil dates.
 */

export interface BirthdayParts {
  month: number; // 1-12
  day: number; // 1-31
  year?: number | null;
}

export interface BirthdayCountdown {
  /** Whole days until the next occurrence; 0 means today. */
  daysUntil: number;
  /** Remaining hours after the whole days are subtracted (for "6d 14h"). */
  hoursUntil: number;
  /** The date the next celebration falls on, as a civil date string. */
  nextDate: string; // YYYY-MM-DD
  isToday: boolean;
  isTomorrow: boolean;
  /** Age they will turn on `nextDate`, when the birth year is known. */
  turningAge: number | null;
  /** Current age, when the birth year is known. */
  currentAge: number | null;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(month: number, year: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

export function isValidBirthday(parts: BirthdayParts): boolean {
  const { month, day, year } = parts;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  // Validate against a leap year so 29 Feb is accepted when no year is given.
  const referenceYear = year ?? 2000;
  if (year != null) {
    if (!Number.isInteger(year) || year < 1900) return false;
    const currentYear = new Date().getUTCFullYear();
    if (year > currentYear) return false;
  }
  return day <= daysInMonth(month, referenceYear);
}

/** Local civil date (not UTC) for the machine reading the clock. */
export function toCivilDate(date: Date): { year: number; month: number; day: number } {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export function formatCivilDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The celebration day in a given year.
 *
 * 29 February birthdays are celebrated on 28 February in common years — a
 * deliberate choice so that these users still get a reminder every year rather
 * than every fourth one.
 */
export function celebrationDayInYear(
  parts: Pick<BirthdayParts, 'month' | 'day'>,
  year: number,
): { month: number; day: number } {
  const maxDay = daysInMonth(parts.month, year);
  return { month: parts.month, day: Math.min(parts.day, maxDay) };
}

/**
 * Days between two civil dates, ignoring time-of-day and DST. Both dates are
 * projected onto UTC midnight first so the difference is always exact.
 */
export function civilDaysBetween(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number },
): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Countdown to the next celebration of `parts`, evaluated against `now`
 * (defaults to the current time). `now` is read as a local wall-clock time.
 */
export function getBirthdayCountdown(parts: BirthdayParts, now: Date = new Date()): BirthdayCountdown {
  const today = toCivilDate(now);

  // Try this year first; if it has already passed, roll to next year.
  let targetYear = today.year;
  let celebration = celebrationDayInYear(parts, targetYear);
  let daysUntil = civilDaysBetween(today, { year: targetYear, ...celebration });

  if (daysUntil < 0) {
    targetYear = today.year + 1;
    celebration = celebrationDayInYear(parts, targetYear);
    daysUntil = civilDaysBetween(today, { year: targetYear, ...celebration });
  }

  // Hours left in the day, so the UI can render "6 Days 14 Hours".
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const hoursUntil = daysUntil === 0 ? 0 : Math.floor((endOfToday.getTime() - now.getTime()) / MS_PER_HOUR);

  const currentAge = parts.year != null ? computeAge(parts, now) : null;
  const turningAge = parts.year != null ? targetYear - parts.year : null;

  return {
    daysUntil,
    hoursUntil,
    nextDate: formatCivilDate(targetYear, celebration.month, celebration.day),
    isToday: daysUntil === 0,
    isTomorrow: daysUntil === 1,
    turningAge,
    currentAge,
  };
}

/** Age in whole years, or null when the birth year is unknown/hidden. */
export function computeAge(parts: BirthdayParts, now: Date = new Date()): number | null {
  if (parts.year == null) return null;
  const today = toCivilDate(now);
  let age = today.year - parts.year;
  const hasHadBirthdayThisYear =
    today.month > parts.month || (today.month === parts.month && today.day >= parts.day);
  if (!hasHadBirthdayThisYear) age -= 1;
  return age < 0 ? null : age;
}

/**
 * Sort key that orders birthdays by how soon they are, wrapping around the end
 * of the year. Stable and cheap enough to use in-memory for a friend list.
 */
export function upcomingSortKey(parts: BirthdayParts, now: Date = new Date()): number {
  return getBirthdayCountdown(parts, now).daysUntil;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function formatBirthday(parts: BirthdayParts, opts: { showYear?: boolean } = {}): string {
  const month = MONTH_NAMES[parts.month - 1] ?? '';
  const base = `${month} ${parts.day}`;
  return opts.showYear && parts.year != null ? `${base}, ${parts.year}` : base;
}

/** "5 days to go" / "Tomorrow!" / "🎉 TODAY!" (spec §48). */
export function formatCountdown(countdown: Pick<BirthdayCountdown, 'daysUntil' | 'hoursUntil'>): string {
  if (countdown.daysUntil === 0) return '🎉 TODAY!';
  if (countdown.daysUntil === 1) return 'Tomorrow!';
  if (countdown.daysUntil < 7) return `${countdown.daysUntil} days to go`;
  if (countdown.daysUntil < 30) {
    const weeks = Math.floor(countdown.daysUntil / 7);
    return weeks === 1 ? '1 week to go' : `${weeks} weeks to go`;
  }
  const months = Math.round(countdown.daysUntil / 30);
  return months <= 1 ? '1 month to go' : `${months} months to go`;
}

/** Long form for a profile header: "6 Days 14 Hours". */
export function formatPreciseCountdown(countdown: BirthdayCountdown): string {
  if (countdown.isToday) return '🎉 TODAY!';
  const parts: string[] = [];
  if (countdown.daysUntil > 0) {
    parts.push(`${countdown.daysUntil} ${countdown.daysUntil === 1 ? 'Day' : 'Days'}`);
  }
  parts.push(`${countdown.hoursUntil} ${countdown.hoursUntil === 1 ? 'Hour' : 'Hours'}`);
  return parts.join(' ');
}

/** Parse an ISO `YYYY-MM-DD` (or full ISO timestamp) into birthday parts. */
export function parseBirthdayInput(value: string): BirthdayParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parts: BirthdayParts = { month, day, year };
  return isValidBirthday(parts) ? parts : null;
}
