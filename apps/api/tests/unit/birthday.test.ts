import {
  celebrationDayInYear,
  computeAge,
  formatCountdown,
  getBirthdayCountdown,
  isValidBirthday,
  parseBirthdayInput,
} from '@bday/shared';

/** Local wall-clock date, matching how the helpers read `now`. */
const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour);

describe('birthday maths', () => {
  it('counts down to a birthday later this year', () => {
    const countdown = getBirthdayCountdown({ month: 9, day: 20 }, at(2026, 9, 15));
    expect(countdown.daysUntil).toBe(5);
    expect(countdown.nextDate).toBe('2026-09-20');
    expect(countdown.isToday).toBe(false);
  });

  it('rolls over to next year once the birthday has passed', () => {
    const countdown = getBirthdayCountdown({ month: 1, day: 3, year: 1998 }, at(2026, 9, 15));
    expect(countdown.nextDate).toBe('2027-01-03');
    expect(countdown.turningAge).toBe(29);
    expect(countdown.currentAge).toBe(28);
  });

  it('reports today as zero days with the TODAY label', () => {
    const countdown = getBirthdayCountdown({ month: 9, day: 15 }, at(2026, 9, 15, 7));
    expect(countdown.isToday).toBe(true);
    expect(countdown.daysUntil).toBe(0);
    expect(formatCountdown(countdown)).toBe('🎉 TODAY!');
  });

  it('crosses the year boundary without an off-by-one', () => {
    expect(getBirthdayCountdown({ month: 1, day: 1 }, at(2026, 12, 31)).daysUntil).toBe(1);
  });

  it('celebrates 29 February on 28 February in common years', () => {
    expect(celebrationDayInYear({ month: 2, day: 29 }, 2027)).toEqual({ month: 2, day: 28 });
    expect(celebrationDayInYear({ month: 2, day: 29 }, 2028)).toEqual({ month: 2, day: 29 });
    expect(getBirthdayCountdown({ month: 2, day: 29 }, at(2027, 2, 27)).daysUntil).toBe(1);
  });

  it('validates real calendar dates only', () => {
    expect(isValidBirthday({ month: 2, day: 29 })).toBe(true);
    expect(isValidBirthday({ month: 2, day: 29, year: 2001 })).toBe(false);
    expect(isValidBirthday({ month: 4, day: 31 })).toBe(false);
    expect(isValidBirthday({ month: 13, day: 1 })).toBe(false);
    expect(isValidBirthday({ month: 1, day: 1, year: new Date().getFullYear() + 1 })).toBe(false);
  });

  it('computes age only when the birth year is known', () => {
    expect(computeAge({ month: 9, day: 16, year: 2000 }, at(2026, 9, 15))).toBe(25);
    expect(computeAge({ month: 9, day: 15, year: 2000 }, at(2026, 9, 15))).toBe(26);
    expect(computeAge({ month: 9, day: 15 }, at(2026, 9, 15))).toBeNull();
  });

  it('formats countdowns in friendly buckets', () => {
    expect(formatCountdown({ daysUntil: 1, hoursUntil: 3 })).toBe('Tomorrow!');
    expect(formatCountdown({ daysUntil: 5, hoursUntil: 3 })).toBe('5 days to go');
    expect(formatCountdown({ daysUntil: 14, hoursUntil: 0 })).toBe('2 weeks to go');
    expect(formatCountdown({ daysUntil: 90, hoursUntil: 0 })).toBe('3 months to go');
  });

  it('parses ISO date input', () => {
    expect(parseBirthdayInput('1995-03-14')).toEqual({ year: 1995, month: 3, day: 14 });
    expect(parseBirthdayInput('1995-02-30')).toBeNull();
    expect(parseBirthdayInput('not a date')).toBeNull();
  });
});
