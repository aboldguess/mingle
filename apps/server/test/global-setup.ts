import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

export default async function setup() {
  const url = process.env.DATABASE_URL!;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await client.end();
  await runMigrations(url);
}
