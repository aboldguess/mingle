import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { User } from './db/schema.js';
import { loadSessionUser, SESSION_COOKIE } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { meetingRoutes } from './routes/meetings.js';
import { orgRoutes } from './routes/orgs.js';
import { webhookRoutes } from './routes/webhooks.js';
import type { MediaService } from './services/livekit.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  media: MediaService;
  stripe: Stripe | null;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : { level: config.LOG_LEVEL, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  app.decorate('deps', deps);
  app.decorateRequest('user', null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // LiveKit signalling (wss) and TURN/HTTP endpoints.
        connectSrc: ["'self'", config.LIVEKIT_URL, config.LIVEKIT_URL.replace(/^ws/, 'http')],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // Resolve the signed-in user once per request.
  app.addHook('onRequest', async (req) => {
    req.user = await loadSessionUser(deps.db, req.cookies[SESSION_COOKIE]);
  });

  // CSRF defence in depth on top of SameSite=Lax cookies: browsers always send
  // Origin on cross-site state-changing requests, so reject foreign origins.
  const allowedOrigin = new URL(config.APP_URL).origin;
  app.addHook('onRequest', async (req, reply) => {
    if (!STATE_CHANGING.has(req.method) || req.url.startsWith('/api/webhooks/')) return;
    const origin = req.headers.origin;
    if (origin && origin !== allowedOrigin) {
      return reply.code(403).send({ error: { code: 'bad_origin', message: 'Cross-site request blocked' } });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const message = first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input';
      return reply.code(400).send({ error: { code: 'invalid_input', message } });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.code(status).send({
      error: { code: status === 429 ? 'rate_limited' : 'error', message: status >= 500 ? 'Something went wrong' : (err as Error).message },
    });
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await deps.db.execute('select 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(orgRoutes, { prefix: '/api/orgs' });
  await app.register(meetingRoutes, { prefix: '/api' });
  await app.register(billingRoutes, { prefix: '/api' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });

  // Serve the built SPA from the same origin in production.
  if (config.WEB_DIST_DIR && fs.existsSync(config.WEB_DIST_DIR)) {
    const root = path.resolve(config.WEB_DIST_DIR);
    await app.register(fastifyStatic, { root, wildcard: false, maxAge: '1h' });
    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.type('text/html').header('cache-control', 'no-cache').send(indexHtml);
      }
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }));
  }

  return app;
}
