import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const orgRole = pgEnum('org_role', ['owner', 'admin', 'member']);
export const meetingStatus = pgEnum('meeting_status', ['scheduled', 'live', 'ended', 'cancelled']);

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_hash_unique').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    plan: text('plan').notNull().default('free'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    subscriptionStatus: text('subscription_status'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    /** Require every participant to be a signed-in org member (no guests). */
    membersOnlyMeetings: boolean('members_only_meetings').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('organizations_slug_unique').on(t.slug), uniqueIndex('organizations_stripe_customer_unique').on(t.stripeCustomerId)],
);

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index('memberships_user_idx').on(t.userId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: orgRole('role').notNull().default('member'),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invitations_token_hash_unique').on(t.tokenHash), index('invitations_org_idx').on(t.orgId)],
);

export const meetings = pgTable(
  'meetings',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    hostId: uuid('host_id').references(() => users.id, { onDelete: 'set null' }),
    /** Public, hard-to-guess join code, e.g. "kdu-xmpq-wza". Also the LiveKit room name suffix. */
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    status: meetingStatus('status').notNull().default('scheduled'),
    allowGuests: boolean('allow_guests').notNull().default(true),
    waitingRoom: boolean('waiting_room').notNull().default(false),
    muteOnEntry: boolean('mute_on_entry').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('meetings_code_unique').on(t.code),
    index('meetings_org_start_idx').on(t.orgId, t.scheduledStart),
    index('meetings_status_idx').on(t.status),
  ],
);

/** Guests waiting for a host to admit them, when the meeting has a waiting room. */
export const admissionRequests = pgTable(
  'admission_requests',
  {
    id: id(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('admission_requests_meeting_idx').on(t.meetingId, t.status)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_org_created_idx').on(t.orgId, t.createdAt)],
);

/** Processed Stripe webhook event ids, for idempotency. */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type OrgRole = (typeof orgRole.enumValues)[number];
