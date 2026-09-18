/**
 * Test environment defaults. Loaded before any module imports `config/env`,
 * so the env schema sees a complete configuration.
 *
 * Integration tests need TEST_DATABASE_URL pointing at a disposable Postgres
 * database; `tests/setup/db.ts` migrates it. Unit tests run without one.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/bday_test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-long-enough-000000';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-that-is-long-enough-11111';
process.env.PAYMENTS_SANDBOX = 'true';
process.env.OTP_DEBUG_ECHO = 'true';
process.env.BCRYPT_ROUNDS = '10';
process.env.RUN_WORKERS_IN_PROCESS = 'false';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = './.test-storage';
process.env.LOG_LEVEL = 'silent';
delete process.env.REDIS_URL;
delete process.env.ANTHROPIC_API_KEY;
