import { defineConfig } from 'vitest/config';

const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://mingle:mingle@localhost:5432/mingle_test',
  APP_URL: 'http://localhost:5173',
  AUTH_RATE_LIMIT_PER_MIN: '10000',
  LIVEKIT_URL: 'wss://livekit.test',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'devsecret-devsecret-devsecret-devsecret',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_BUSINESS: 'price_business',
};
// Global setup runs in this process, so expose the env here as well.
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    env: testEnv,
  },
});
