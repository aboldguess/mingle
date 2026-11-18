import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import Stripe from 'stripe';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import type { JoinGrant, MediaService } from '../src/services/livekit.js';

export class FakeMedia implements MediaService {
  url = 'wss://livekit.test';
  calls: Array<{ op: string; args: unknown[] }> = [];
  grants: JoinGrant[] = [];
  async createJoinToken(grant: JoinGrant) {
    this.grants.push(grant);
    return `token-for-${grant.identity}`;
  }
  async ensureRoom(...args: unknown[]) {
    this.calls.push({ op: 'ensureRoom', args });
  }
  async removeParticipant(...args: unknown[]) {
    this.calls.push({ op: 'removeParticipant', args });
  }
  async muteParticipant(...args: unknown[]) {
    this.calls.push({ op: 'muteParticipant', args });
  }
  async endRoom(...args: unknown[]) {
    this.calls.push({ op: 'endRoom', args });
  }
  async listParticipantCount() {
    return 0;
  }
  async verifyJoinToken(token: string) {
    const g = this.grants.find((x) => `token-for-${x.identity}` === token);
    return g ? { room: g.roomName, identity: g.identity } : null;
  }
  async receiveWebhook(body: string) {
    return JSON.parse(body);
  }
}

export interface TestCtx {
  app: FastifyInstance;
  media: FakeMedia;
  stripe: Stripe;
  close: () => Promise<void>;
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestCtx> {
  const config = loadConfig({ ...process.env, ...overrides });
  const { db, pool } = createDb(config.DATABASE_URL);
  const media = new FakeMedia();
  const stripe = new Stripe(config.STRIPE_SECRET_KEY!);
  const app = await buildApp({ config, db, media, stripe });
  return {
    app,
    media,
    stripe,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** A tiny cookie-jar client so tests read like a browser session. */
export class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown): Promise<LightMyRequestResponse & { data: any }> {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      payload: body as object | undefined,
      headers: { cookie: this.cookie, origin: 'http://localhost:5173' },
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const first = (Array.isArray(setCookie) ? setCookie : [setCookie])[0]!;
      const pair = first.split(';')[0]!;
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    let data: any = null;
    try {
      data = res.json();
    } catch {
      data = res.body;
    }
    return Object.assign(res, { data });
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  patch = (url: string, body?: unknown) => this.req('PATCH', url, body ?? {});
  del = (url: string) => this.req('DELETE', url);
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter++;
  return `${prefix}.${Date.now()}.${counter}@example.com`;
}

export async function signUp(app: FastifyInstance, name = 'Ada Lovelace') {
  const client = new Client(app);
  const email = uniqueEmail(name.split(' ')[0]!.toLowerCase());
  const res = await client.post('/api/auth/signup', { email, password: 'correct horse battery', name });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  return { client, email, userId: res.data.user.id as string, orgId: res.data.orgId as string };
}
