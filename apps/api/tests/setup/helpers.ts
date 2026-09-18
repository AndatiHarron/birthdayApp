import type { AuthSession } from '@bday/shared';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

/**
 * Integration helpers. Everything goes through the real HTTP stack — routing,
 * auth, validation, services and Postgres — rather than calling services
 * directly, so the tests exercise what a client actually hits.
 */

export const dbReady = process.env.DB_TESTS_READY === '1';
export const describeDb = dbReady ? describe : describe.skip;

export const app = createApp();
export const api = () => request(app);

let counter = 0;
function unique(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 6)}`;
}

export interface TestUser {
  id: string;
  token: string;
  username: string;
  email: string;
  session: AuthSession;
}

export async function registerUser(options: { displayName?: string; birthday?: { month: number; day: number; year?: number } } = {}): Promise<TestUser> {
  const tag = unique();
  const email = `user_${tag}@example.test`;
  const response = await api()
    .post('/api/v1/auth/register')
    .send({
      email,
      password: 'Sup3rSecret!',
      displayName: options.displayName ?? `Tester ${tag}`,
      username: `u${tag}`.slice(0, 24).toLowerCase(),
      acceptedTerms: true,
    });
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const result = response.body.data as { kind: 'SESSION'; session: AuthSession };
  const session = result.session;

  const onboarding = await api()
    .post('/api/v1/users/me/onboarding')
    .set('authorization', `Bearer ${session.tokens.accessToken}`)
    .send({ birthday: options.birthday ?? { month: 3, day: 14, year: 1995 }, interests: ['technology', 'music'], showBirthYear: true });
  if (onboarding.status !== 200) {
    throw new Error(`onboarding failed: ${onboarding.status} ${JSON.stringify(onboarding.body)}`);
  }

  // Email verification is covered in the auth suite; other suites start active.
  await prisma.user.update({ where: { id: session.user.id }, data: { status: 'ACTIVE', emailVerified: true } });

  return { id: session.user.id, token: session.tokens.accessToken, username: session.user.username, email, session };
}

export async function makeFriends(a: TestUser, b: TestUser): Promise<void> {
  const request = await api().post('/api/v1/friends/request').set(authHeader(a)).send({ userId: b.id }).expect(201);
  await api().post('/api/v1/friends/accept').set(authHeader(b)).send({ requestId: request.body.data.id }).expect(200);
}

export function authHeader(user: TestUser): Record<string, string> {
  return { authorization: `Bearer ${user.token}` };
}

export function idempotencyKey(): string {
  return `idem_${unique()}`;
}
