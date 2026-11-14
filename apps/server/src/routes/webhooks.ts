import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type Stripe from 'stripe';
import { meetings, organizations, stripeEvents } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { planForPrice } from './billing.js';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const { db, config, stripe, media } = app.deps;

  // Webhook signatures are computed over the exact bytes, so keep the raw body.
  app.addContentTypeParser(['application/json', 'application/webhook+json'], { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.post('/stripe', async (req, reply) => {
    if (!stripe || !config.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: { code: 'billing_disabled', message: 'Billing disabled' } });
    const signature = req.headers['stripe-signature'];
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as string, String(signature ?? ''), config.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw badRequest('Invalid signature', 'bad_signature');
    }

    // Idempotency: Stripe retries deliveries, so process each event once.
    const inserted = await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
    if (!inserted.length) return { received: true, duplicate: true };

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const orgId = session.client_reference_id;
          if (orgId && typeof session.customer === 'string') {
            await db
              .update(organizations)
              .set({
                stripeCustomerId: session.customer,
                stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
              })
              .where(eq(organizations.id, orgId));
          }
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          await applySubscription(sub, event.type === 'customer.subscription.deleted');
          break;
        }
        default:
          break;
      }
    } catch (err) {
      // Let Stripe retry if we failed mid-way.
      await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
      throw err;
    }
    return { received: true };
  });

  async function applySubscription(sub: Stripe.Subscription, deleted: boolean) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const item = sub.items.data[0];
    const plan = planForPrice(config, item?.price.id);
    const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
    const orgId = sub.metadata?.orgId;
    const where = orgId ? eq(organizations.id, orgId) : eq(organizations.stripeCustomerId, customerId);
    const [org] = await db
      .update(organizations)
      .set({
        stripeCustomerId: customerId,
        stripeSubscriptionId: deleted ? null : sub.id,
        subscriptionStatus: deleted ? 'canceled' : sub.status,
        plan: deleted || !plan ? 'free' : plan,
        currentPeriodEnd: periodEnd,
      })
      .where(where)
      .returning();
    if (org) {
      await audit(db, null, { orgId: org.id, action: 'billing.subscription_updated', metadata: { status: sub.status, plan: org.plan } });
    }
  }

  // LiveKit room lifecycle keeps meeting status accurate when everyone leaves.
  app.post('/livekit', async (req) => {
    let event;
    try {
      event = await media.receiveWebhook(req.body as string, req.headers.authorization);
    } catch {
      throw badRequest('Invalid webhook', 'bad_signature');
    }
    const roomName = event.room?.name ?? '';
    const code = roomName.startsWith('mingle-') ? roomName.slice('mingle-'.length) : null;
    if (code && event.event === 'room_finished') {
      await db
        .update(meetings)
        .set({ status: 'ended', endedAt: new Date(), startedAt: null })
        .where(and(eq(meetings.code, code), eq(meetings.status, 'live')));
    }
    return { received: true };
  });
};
