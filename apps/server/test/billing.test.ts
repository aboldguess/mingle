import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/db/client.js';
import { organizations } from '../src/db/schema.js';
import { createTestApp, signUp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
const { db, pool } = createDb(process.env.DATABASE_URL!);
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
  await pool.end();
});

function signedWebhook(event: object) {
  const payload = JSON.stringify(event);
  const header = ctx.stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
  return ctx.app.inject({
    method: 'POST',
    url: '/api/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    payload,
  });
}

function subscriptionEvent(id: string, type: string, orgId: string, status: string, price: string) {
  return {
    id,
    object: 'event',
    type,
    data: {
      object: {
        id: 'sub_123',
        object: 'subscription',
        customer: `cus_${orgId.slice(0, 8)}`,
        status,
        metadata: { orgId },
        items: { data: [{ price: { id: price }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
      },
    },
  };
}

describe('billing', () => {
  it('lists plans publicly', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/plans' });
    expect(res.json().plans.map((p: { id: string }) => p.id)).toEqual(['free', 'pro', 'business']);
  });

  it('creates a Stripe checkout session for admins', async () => {
    const { client, orgId } = await signUp(ctx.app);
    vi.spyOn(ctx.stripe.customers, 'create').mockResolvedValue({ id: 'cus_new' } as never);
    const createSession = vi.spyOn(ctx.stripe.checkout.sessions, 'create').mockResolvedValue({ url: 'https://checkout.stripe.test/x' } as never);
    const res = await client.post(`/api/orgs/${orgId}/billing/checkout`, { plan: 'pro' });
    expect(res.statusCode).toBe(200);
    expect(res.data.url).toBe('https://checkout.stripe.test/x');
    const args = createSession.mock.calls[0]![0]!;
    expect(args).toMatchObject({ mode: 'subscription', customer: 'cus_new', client_reference_id: orgId, line_items: [{ price: 'price_pro', quantity: 1 }] });
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(org!.stripeCustomerId).toBe('cus_new');
  });

  it('rejects webhooks with a bad signature', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(400);
  });

  it('upgrades and downgrades the org from subscription webhooks, idempotently', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const upgrade = subscriptionEvent(`evt_${orgId}_1`, 'customer.subscription.created', orgId, 'active', 'price_business');
    expect((await signedWebhook(upgrade)).statusCode).toBe(200);
    const dup = await signedWebhook(upgrade);
    expect(dup.json().duplicate).toBe(true);

    let info = await client.get(`/api/orgs/${orgId}`);
    expect(info.data.org.effectivePlan).toBe('business');
    expect(info.data.limits.maxParticipants).toBe(300);

    // A failed payment that ends in cancellation drops the org back to free.
    await signedWebhook(subscriptionEvent(`evt_${orgId}_2`, 'customer.subscription.deleted', orgId, 'canceled', 'price_business'));
    info = await client.get(`/api/orgs/${orgId}`);
    expect(info.data.org.effectivePlan).toBe('free');
  });

  it('treats unpaid subscriptions as free', async () => {
    const { client, orgId } = await signUp(ctx.app);
    await signedWebhook(subscriptionEvent(`evt_${orgId}_3`, 'customer.subscription.updated', orgId, 'unpaid', 'price_pro'));
    const info = await client.get(`/api/orgs/${orgId}`);
    expect(info.data.org.plan).toBe('pro');
    expect(info.data.org.effectivePlan).toBe('free');
  });
});

describe('seat sync', () => {
  it('updates the Stripe quantity when a member joins', async () => {
    const owner = await signUp(ctx.app);
    await db.update(organizations).set({ plan: 'pro', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_seats' }).where(eq(organizations.id, owner.orgId));
    vi.spyOn(ctx.stripe.subscriptions, 'retrieve').mockResolvedValue({ items: { data: [{ id: 'si_1', quantity: 1 }] } } as never);
    const update = vi.spyOn(ctx.stripe.subscriptionItems, 'update').mockResolvedValue({} as never);
    const invitee = await signUp(ctx.app, 'Seat Person');
    const inv = await owner.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: invitee.email });
    await invitee.client.post(`/api/orgs/invitations/${inv.data.inviteUrl.split('/invite/')[1]}/accept`);
    expect(update).toHaveBeenCalledWith('si_1', { quantity: 2, proration_behavior: 'create_prorations' });
  });
});
