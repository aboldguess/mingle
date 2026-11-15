import { z } from 'zod';

/**
 * All runtime configuration comes from environment variables and is validated
 * once at startup, so a misconfigured deployment fails fast instead of at the
 * first request that needs a missing value.
 */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Public base URL of the web app, used for invite links, Stripe redirects and Origin checks. */
  APP_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  /** Directory with the built web app. When set, the API server also serves the SPA. */
  WEB_DIST_DIR: optional,
  /** Trust X-Forwarded-* headers (set when running behind a load balancer). */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  /** Max sign-up/login attempts per IP per minute. */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),

  /** URL browsers use to reach LiveKit (ws:// or wss://). */
  LIVEKIT_URL: z.string().min(1),
  /** Optional URL the API uses for LiveKit's server API, when it differs (e.g. inside docker compose). */
  LIVEKIT_API_URL: optional,
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PRICE_PRO: optional,
  STRIPE_PRICE_BUSINESS: optional,

  /** Comma separated emails that get platform super-admin access. */
  PLATFORM_ADMIN_EMAILS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

export function billingEnabled(config: Config): boolean {
  return Boolean(config.STRIPE_SECRET_KEY && config.STRIPE_PRICE_PRO && config.STRIPE_PRICE_BUSINESS);
}
