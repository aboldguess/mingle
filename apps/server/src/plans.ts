/**
 * Plan catalogue. Prices live in Stripe; this file holds the product limits
 * the server enforces. Keep the public pricing page (apps/web) in sync.
 */
export const PLAN_IDS = ['free', 'pro', 'business'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  name: string;
  /** Max participants allowed in one meeting room. */
  maxParticipants: number;
  /** Max meeting length in minutes once two or more people are in the room. */
  maxMeetingMinutes: number;
  /** Max members in the organisation. */
  maxMembers: number;
  /** Display price per host per month in USD, for the pricing page. */
  monthlyPriceUsd: number;
  features: string[];
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    name: 'Free',
    maxParticipants: 100,
    maxMeetingMinutes: 40,
    maxMembers: 3,
    monthlyPriceUsd: 0,
    features: ['Events up to 40 minutes', 'Up to 100 avatars per venue', 'Proximity voice, stage screen and chat', 'Guest invite links'],
  },
  pro: {
    name: 'Pro',
    maxParticipants: 100,
    maxMeetingMinutes: 30 * 60,
    maxMembers: 50,
    monthlyPriceUsd: 14,
    features: ['Events up to 30 hours', 'Up to 100 avatars per venue', 'Door queue and host controls', 'Up to 50 team members'],
  },
  business: {
    name: 'Business',
    maxParticipants: 300,
    maxMeetingMinutes: 30 * 60,
    maxMembers: 1000,
    monthlyPriceUsd: 22,
    features: ['Everything in Pro', 'Up to 300 avatars per venue', 'Audit log and admin console', 'SSO (SAML/OIDC) ready', 'Priority support'],
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

/** Subscription statuses that keep paid features switched on. */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function effectivePlan(org: { plan: string; subscriptionStatus: string | null }): PlanId {
  if (!isPlanId(org.plan) || org.plan === 'free') return 'free';
  return org.subscriptionStatus && ACTIVE_STATUSES.has(org.subscriptionStatus) ? org.plan : 'free';
}
