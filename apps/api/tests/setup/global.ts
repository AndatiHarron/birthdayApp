import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Vitest global setup for integration tests.
 *
 * If TEST_DATABASE_URL is set (CI, or a local Docker Postgres), that database
 * is migrated and used. Otherwise a throwaway embedded Postgres is started in
 * `.pg-test/`, migrated with the real migration files, and removed afterwards —
 * so `npm test` needs nothing installed beyond Node.
 */

const PORT = 54329;
const DATA_DIR = path.resolve(__dirname, '../../.pg-test');

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; createDatabase(name: string): Promise<void> };

let embedded: EmbeddedPostgresInstance | null = null;

function migrate(url: string): void {
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

export async function setup(): Promise<void> {
  if (process.env.SKIP_DB_TESTS === '1') return;

  if (process.env.TEST_DATABASE_URL) {
    migrate(process.env.TEST_DATABASE_URL);
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DB_TESTS_READY = '1';
    return;
  }

  // Imported by name at runtime: the package ships ESM-only type declarations
  // that the project's CommonJS module resolution cannot read.
  const moduleName = 'embedded-postgres';
  const { default: EmbeddedPostgres } = (await import(moduleName)) as unknown as {
    default: new (options: Record<string, unknown>) => EmbeddedPostgresInstance;
  };
  rmSync(DATA_DIR, { recursive: true, force: true });
  embedded = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'bday',
    password: 'bday_test',
    port: PORT,
    persistent: false,
    // Match production: UTF-8 regardless of the host OS locale (Windows
    // defaults to WIN1252, which cannot store emoji).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => undefined,
    onError: () => undefined,
  });
  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase('bday_test');

  const url = `postgresql://bday:bday_test@localhost:${PORT}/bday_test?schema=public`;
  migrate(url);
  process.env.TEST_DATABASE_URL = url;
  process.env.DATABASE_URL = url;
  process.env.DB_TESTS_READY = '1';
}

export async function teardown(): Promise<void> {
  if (embedded) {
    await embedded.stop();
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}
