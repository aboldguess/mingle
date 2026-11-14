import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { billingEnabled, type Config } from '../config.js';
import { organizations } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { requireOrgRole, requireUser } from '../lib/auth.js';
import { badRequest, unavailable } from '../lib/errors.js';
import { PLAN_IDS, PLANS, type PlanId } from '../plans.js';
import { memberCount } from '../services/orgs.js';

export function priceIdFor(config: Config, plan: PlanId): string | undefined {
  if (plan === 'pro') return config.STRIPE_PRICE_PRO;
  if (plan === 'business') return config.STRIPE_PRICE_BUSINESS;
  return undefined;
}

export function planForPrice(config: Config, priceId: string | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === config.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === config.STRIPE_PRICE_BUSINESS) return 'business';
  return null;
}

export const billingRoutes: FastifyPluginAsync = async (app) => {
  const { db, config, stripe } = app.deps;

  app.get('/plans', async () => ({
    billingEnabled: billingEnabled(config),
    plans: PLAN_IDS.map((id) => ({ id, ...PLANS[id] })),
  }));

  function requireStripe() {
    if (!stripe || !billingEnabled(config)) throw unavailable('Billing is not configured on this server', 'billing_disabled');
    return stripe;
  }

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/billing/checkout', async (req) => {
    const user = requireUser(req);
    const { org } = await requireOrgRole(db, user, req.params.orgId, 'admin');
    const body = z.object({ plan: z.enum(['pro', 'business']) }).parse(req.body);
    const s = requireStripe();
    if (org.stripeSubscriptionId && org.subscriptionStatus && org.subscriptionStatus !== 'canceled') {
      throw badRequest('This organisation already has a subscription. Use Manage billing to change plans.', 'already_subscribed');
    }

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await s.customers.create({ email: user.email, name: org.name, metadata: { orgId: org.id } });
      customerId = customer.id;
      await db.update(organizations).set({ stripeCustomerId: customerId }).where(eq(organizations.id, org.id));
    }

    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: org.id,
      line_items: [{ price: priceIdFor(config, body.plan)!, quantity: Math.max(1, await memberCount(db, org.id)) }],
      subscription_data: { metadata: { orgId: org.id } },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      success_url: `${config.APP_URL}/app/${org.id}/billing?checkout=success`,
      cancel_url: `${config.APP_URL}/app/${org.id}/billing?checkout=cancelled`,
    });
    await audit(db, req, { orgId: org.id, actorId: user.id, action: 'billing.checkout_started', metadata: { plan: body.plan } });
    return { url: session.url };
  });

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/billing/portal', async (req) => {
    const user = requireUser(req);
    const { org } = await requireOrgRole(db, user, req.params.orgId, 'admin');
    const s = requireStripe();
    if (!org.stripeCustomerId) throw badRequest('No billing account yet. Choose a plan first.', 'no_customer');
    const session = await s.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${config.APP_URL}/app/${org.id}/billing`,
    });
    return { url: session.url };
  });
};
