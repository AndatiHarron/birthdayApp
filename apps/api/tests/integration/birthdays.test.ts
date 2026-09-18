import { prisma } from '../../src/lib/prisma';
import { runBirthdayReminders } from '../../src/services/reminder.service';
import { api, authHeader, describeDb, makeFriends, registerUser } from '../setup/helpers';

describeDb('birthdays, reminders and home (spec §6–8, §21, §65)', () => {
  it('adds a birthday, lists it as upcoming and shows it on the calendar', async () => {
    const user = await registerUser();
    const soon = new Date(Date.now() + 5 * 86_400_000);
    const month = soon.getMonth() + 1;
    const day = soon.getDate();

    await api()
      .post('/api/v1/birthdays')
      .set(authHeader(user))
      .send({ name: 'Brian Otieno', birthday: { month, day }, relationship: 'FRIEND', interests: ['gaming'] })
      .expect(201);

    const upcoming = await api().get('/api/v1/birthdays/upcoming?withinDays=30').set(authHeader(user)).expect(200);
    const brian = (upcoming.body.data.upcoming as Array<{ name: string; countdown: { daysUntil: number } }>).find((entry) => entry.name === 'Brian Otieno');
    expect(brian).toBeDefined();
    expect(brian!.countdown.daysUntil).toBeGreaterThanOrEqual(4);
    expect(brian!.countdown.daysUntil).toBeLessThanOrEqual(6);

    const calendar = await api().get(`/api/v1/birthdays/calendar?year=${soon.getFullYear()}&month=${month}`).set(authHeader(user)).expect(200);
    const dayEntry = (calendar.body.data.days as Array<{ day: number; birthdays: unknown[] }>).find((entry) => entry.day === day);
    expect(dayEntry?.birthdays.length).toBeGreaterThan(0);
  });

  it('creates a linked calendar entry when friends connect', async () => {
    const [a, b] = await Promise.all([registerUser({ displayName: 'Alice' }), registerUser({ displayName: 'Bob' })]);
    await makeFriends(a, b);
    const all = await api().get('/api/v1/birthdays').set(authHeader(a)).expect(200);
    expect((all.body.data as Array<{ linkedUser: { id: string } | null }>).some((entry) => entry.linkedUser?.id === b.id)).toBe(true);
  });

  it('sends each reminder exactly once, even when the worker runs twice', async () => {
    const user = await registerUser();
    const target = new Date(Date.now() + 7 * 86_400_000);
    await api()
      .post('/api/v1/birthdays')
      .set(authHeader(user))
      .send({ name: 'Reminder Target', birthday: { month: target.getUTCMonth() + 1, day: target.getUTCDate() } })
      .expect(201);
    // Make sure the user's local clock is past their digest hour whatever the time.
    await prisma.notificationPreference.update({ where: { userId: user.id }, data: { digestHour: 0, timezone: 'UTC' } });

    await runBirthdayReminders();
    await runBirthdayReminders();

    const reminders = await prisma.notification.findMany({ where: { userId: user.id, type: 'BIRTHDAY_REMINDER', title: { contains: 'Reminder' } } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.title).toContain('in 7 days');
  });

  it('respects a per-person reminder override', async () => {
    const user = await registerUser();
    const target = new Date(Date.now() + 7 * 86_400_000);
    await api()
      .post('/api/v1/birthdays')
      .set(authHeader(user))
      .send({ name: 'Only Two Weeks', birthday: { month: target.getUTCMonth() + 1, day: target.getUTCDate() }, reminderOffsetsDays: [14] })
      .expect(201);
    await prisma.notificationPreference.update({ where: { userId: user.id }, data: { digestHour: 0, timezone: 'UTC' } });

    await runBirthdayReminders();
    const reminders = await prisma.notification.count({ where: { userId: user.id, title: { contains: 'Only' } } });
    expect(reminders).toBe(0);
  });

  it('builds the home feed in one request', async () => {
    const user = await registerUser({ displayName: 'Andati Home' });
    const response = await api().get('/api/v1/home').set(authHeader(user)).expect(200);
    expect(response.body.data.greeting).toMatch(/Andati 👋$/);
    expect(Array.isArray(response.body.data.upcomingBirthdays)).toBe(true);
    expect(Array.isArray(response.body.data.giftIdeas)).toBe(true);
  });

  it('serves a generated OpenAPI document', async () => {
    const response = await api().get('/openapi.json').expect(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.paths['/api/v1/gifts/{id}/reserve']).toBeDefined();
  });
});
