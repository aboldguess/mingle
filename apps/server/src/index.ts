import Stripe from 'stripe';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { enforceMeetingLimits } from './routes/meetings.js';
import { createLiveKitService } from './services/livekit.js';

async function main() {
  const config = loadConfig();
  if (process.env.MIGRATE_ON_START !== 'false') await runMigrations(config.DATABASE_URL);

  const { db, pool } = createDb(config.DATABASE_URL);
  const media = createLiveKitService(config);
  const stripe = config.STRIPE_SECRET_KEY ? new Stripe(config.STRIPE_SECRET_KEY) : null;
  const app = await buildApp({ config, db, media, stripe });

  const enforcer = setInterval(() => {
    enforceMeetingLimits(db, media).catch((err) => app.log.error({ err }, 'meeting limit enforcement failed'));
  }, 30_000);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(enforcer);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
