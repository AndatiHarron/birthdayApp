import { prisma } from '../../src/lib/prisma';
import { api, authHeader, describeDb, registerUser } from '../setup/helpers';

describeDb('auth', () => {
  it('registers with email and returns a session plus a verification challenge', async () => {
    const tag = Date.now().toString(36);
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ email: `new_${tag}@example.test`, password: 'Sup3rSecret!', displayName: 'New Person', acceptedTerms: true })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.kind).toBe('SESSION');
    expect(response.body.data.session.tokens.accessToken).toEqual(expect.any(String));
    expect(response.body.data.session.onboardingRequired).toBe(true);
    // Passwords never leave the server in any form.
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|Sup3rSecret/);
  });

  it('rejects weak passwords with field errors in the standard envelope', async () => {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ email: `weak_${Date.now()}@example.test`, password: 'short', displayName: 'Weak', acceptedTerms: true })
      .expect(422);
    expect(response.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(Object.keys(response.body.errors)).toContain('body.password');
  });

  it('refuses a duplicate email', async () => {
    const user = await registerUser();
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ email: user.email, password: 'Sup3rSecret!', displayName: 'Dup', acceptedTerms: true })
      .expect(409);
    expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('logs in with the right password and not the wrong one', async () => {
    const user = await registerUser();
    await api().post('/api/v1/auth/login').send({ email: user.email, password: 'Sup3rSecret!' }).expect(200);
    const wrong = await api().post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong-pass1' }).expect(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('requires a token for protected routes', async () => {
    const response = await api().get('/api/v1/users/me').expect(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('verifies a phone OTP and signs in (phone-first signup)', async () => {
    const phone = `+2547${String(Date.now()).slice(-8)}`;
    const registered = await api()
      .post('/api/v1/auth/register')
      .send({ phone, displayName: 'Phone Person', acceptedTerms: true })
      .expect(201);
    expect(registered.body.data.kind).toBe('OTP_REQUIRED');
    const challengeId = registered.body.data.challenge.challengeId as string;

    const stored = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    expect(stored.codeHash).not.toMatch(/^\d{6}$/);

    const wrong = await api().post('/api/v1/auth/verify-otp').send({ challengeId, code: '000000' });
    expect([400, 429]).toContain(wrong.status);

    const code = (registered.body.data.challenge as { debugCode?: string }).debugCode;
    expect(code).toMatch(/^\d{6}$/);
    const verified = await api().post('/api/v1/auth/verify-otp').send({ challengeId, code }).expect(200);
    expect(verified.body.data.user.phoneVerified).toBe(true);
  });

  it('rotates refresh tokens and rejects a replayed one', async () => {
    const user = await registerUser();
    const first = await api().post('/api/v1/auth/refresh').send({ refreshToken: user.session.tokens.refreshToken }).expect(200);
    expect(first.body.data.tokens.refreshToken).not.toBe(user.session.tokens.refreshToken);

    const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: user.session.tokens.refreshToken });
    expect(replay.status).toBe(401);
  });

  it('cuts off a suspended account immediately', async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    const response = await api().get('/api/v1/users/me').set(authHeader(user)).expect(403);
    expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
  });
});
