/**
 * Local Postgres without Docker, for development on machines where Docker
 * is unavailable. Same user, password and database name as docker-compose.yml,
 * but on port 5433 (override with DEV_DB_PORT) so it does not clash with a
 * natively installed Postgres. Data persists in .pg-dev/.
 *
 *   npm run db:local        (leave running; Ctrl+C to stop)
 *   DATABASE_URL=postgresql://bday:bday_dev_password@localhost:5433/bday?schema=public
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.pg-dev');
const PORT = Number(process.env.DEV_DB_PORT ?? 5433);
const firstRun = !existsSync(path.join(DATA_DIR, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'bday',
  password: 'bday_dev_password',
  port: PORT,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (firstRun) await pg.initialise();
await pg.start();
if (firstRun) await pg.createDatabase('bday');

console.log(`Postgres ready on localhost:${PORT} (database "bday"). Ctrl+C to stop.`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
