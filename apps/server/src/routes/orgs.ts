import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { auditLogs, invitations, memberships, organizations, users } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { requireOrgRole, requireUser } from '../lib/auth.js';
import { newToken, sha256 } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, paymentRequired } from '../lib/errors.js';
import { billingEnabled } from '../config.js';
import { effectivePlan, PLANS } from '../plans.js';
import { createOrganization, memberCount, ownerCount } from '../services/orgs.js';
import { syncSeats } from './billing.js';

const role = z.enum(['owner', 'admin', 'member']);
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const orgRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app.deps;

  app.post('/', async (req, reply) => {
    const user = requireUser(req);
    const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    const org = await db.transaction((tx) => createOrganization(tx, { name: body.name, ownerId: user.id }));
    await audit(db, req, { orgId: org.id, actorId: user.id, action: 'org.created' });
    return reply.code(201).send({ org });
  });

  app.get<{ Params: { orgId: string } }>('/:orgId', async (req) => {
    const user = requireUser(req);
    const { org, role } = await requireOrgRole(db, user, req.params.orgId);
    const plan = effectivePlan(org);
    return {
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        effectivePlan: plan,
        subscriptionStatus: org.subscriptionStatus,
        currentPeriodEnd: org.currentPeriodEnd,
        membersOnlyMeetings: org.membersOnlyMeetings,
      },
      role,
      limits: PLANS[plan],
      usage: { members: await memberCount(db, org.id) },
      billingEnabled: billingEnabled(config),
    };
  });

  app.patch<{ Params: { orgId: string } }>('/:orgId', async (req) => {
    const user = requireUser(req);
    const { org } = await requireOrgRole(db, user, req.params.orgId, 'admin');
    const body = z
      .object({ name: z.string().trim().min(1).max(100).optional(), membersOnlyMeetings: z.boolean().optional() })
      .parse(req.body);
    const [updated] = await db.update(organizations).set(body).where(eq(organizations.id, org.id)).returning();
    await audit(db, req, { orgId: org.id, actorId: user.id, action: 'org.updated', metadata: body });
    return { org: updated };
  });

  app.get<{ Params: { orgId: string } }>('/:orgId/members', async (req) => {
    const user = requireUser(req);
    const { org } = await requireOrgRole(db, user, req.params.orgId);
    const members = await db
      .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, joinedAt: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, org.id))
      .orderBy(memberships.createdAt);
    return { members };
  });

  app.patch<{ Params: { orgId: string; userId: string } }>('/:orgId/members/:userId', async (req) => {
    const user = requireUser(req);
    const ctx = await requireOrgRole(db, user, req.params.orgId, 'admin');
    const body = z.object({ role }).parse(req.body);
    const [target] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, ctx.org.id), eq(memberships.userId, req.params.userId)));
    if (!target) throw notFound('Member not found');
    // Only owners can create or demote owners.
    if ((body.role === 'owner' || target.role === 'owner') && ctx.role !== 'owner') throw forbidden('Only owners can change owner roles');
    if (target.role === 'owner' && body.role !== 'owner' && (await ownerCount(db, ctx.org.id)) <= 1) {
      throw badRequest('An organisation needs at least one owner', 'last_owner');
    }
    await db
      .update(memberships)
      .set({ role: body.role })
      .where(and(eq(memberships.orgId, ctx.org.id), eq(memberships.userId, target.userId)));
    await audit(db, req, { orgId: ctx.org.id, actorId: user.id, action: 'member.role_changed', target: target.userId, metadata: { from: target.role, to: body.role } });
    return { ok: true };
  });

  app.delete<{ Params: { orgId: string; userId: string } }>('/:orgId/members/:userId', async (req) => {
    const user = requireUser(req);
    const isSelf = req.params.userId === user.id;
    const ctx = await requireOrgRole(db, user, req.params.orgId, isSelf ? 'member' : 'admin');
    const [target] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, ctx.org.id), eq(memberships.userId, req.params.userId)));
    if (!target) throw notFound('Member not found');
    if (target.role === 'owner' && !isSelf && ctx.role !== 'owner') throw forbidden('Only owners can remove owners');
    if (target.role === 'owner' && (await ownerCount(db, ctx.org.id)) <= 1) {
      throw badRequest('An organisation needs at least one owner', 'last_owner');
    }
    await db.delete(memberships).where(and(eq(memberships.orgId, ctx.org.id), eq(memberships.userId, target.userId)));
    await audit(db, req, { orgId: ctx.org.id, actorId: user.id, action: isSelf ? 'member.left' : 'member.removed', target: target.userId });
    await syncSeats(app.deps, ctx.org.id, req.log);
    return { ok: true };
  });

  app.get<{ Params: { orgId: string } }>('/:orgId/invitations', async (req) => {
    const user = requireUser(req);
    const { org } = await requireOrgRole(db, user, req.params.orgId, 'admin');
    const rows = await db
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
      .from(invitations)
      .where(and(eq(invitations.orgId, org.id), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .orderBy(desc(invitations.createdAt));
    return { invitations: rows };
  });

  app.post<{ Params: { orgId: string } }>('/:orgId/invitations', async (req, reply) => {
    const user = requireUser(req);
    const ctx = await requireOrgRole(db, user, req.params.orgId, 'admin');
    const body = z.object({ email: z.string().trim().toLowerCase().email(), role: role.default('member') }).parse(req.body);
    if (body.role === 'owner' && ctx.role !== 'owner') throw forbidden('Only owners can invite owners');

    const limits = PLANS[effectivePlan(ctx.org)];
    if ((await memberCount(db, ctx.org.id)) >= limits.maxMembers) {
      throw paymentRequired(`The ${limits.name} plan allows ${limits.maxMembers} members. Upgrade to add more.`);
    }
    const alreadyMember = await db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, ctx.org.id), sql`lower(${users.email}) = ${body.email}`));
    if (alreadyMember.length) throw conflict('That person is already a member', 'already_member');

    const token = newToken();
    const [invite] = await db
      .insert(invitations)
      .values({
        orgId: ctx.org.id,
        email: body.email,
        role: body.role,
        tokenHash: sha256(token),
        invitedBy: user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();
    await audit(db, req, { orgId: ctx.org.id, actorId: user.id, action: 'invitation.created', target: body.email, metadata: { role: body.role } });
    // Email delivery is pluggable (see docs/ROADMAP.md); for now admins share the link.
    return reply.code(201).send({ invitation: { id: invite!.id, email: invite!.email, role: invite!.role }, inviteUrl: `${config.APP_URL}/invite/${token}` });
  });

  app.delete<{ Params: { orgId: string; inviteId: string } }>('/:orgId/invitations/:inviteId', async (req) => {
    const user = requireUser(req);
    const { org } = await requireOrgRole(db, user, req.params.orgId, 'admin');
    await db.delete(invitations).where(and(eq(invitations.orgId, org.id), eq(invitations.id, req.params.inviteId)));
    await audit(db, req, { orgId: org.id, actorId: user.id, action: 'invitation.revoked', target: req.params.inviteId });
    return { ok: true };
  });

  // Public preview so the invite page can show which team you're joining.
  app.get<{ Params: { token: string } }>('/invitations/:token', async (req) => {
    const invite = await findInvite(req.params.token);
    return { orgName: invite.orgName, email: invite.email, role: invite.role };
  });

  app.post<{ Params: { token: string } }>('/invitations/:token/accept', async (req) => {
    const user = requireUser(req);
    const invite = await findInvite(req.params.token);
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw forbidden(`This invitation was sent to ${invite.email}. Sign in with that email to accept it.`);
    }
    await db.transaction(async (tx) => {
      await tx.insert(memberships).values({ orgId: invite.orgId, userId: user.id, role: invite.role }).onConflictDoNothing();
      await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
    });
    await audit(db, req, { orgId: invite.orgId, actorId: user.id, action: 'invitation.accepted', target: invite.email });
    await syncSeats(app.deps, invite.orgId, req.log);
    return { orgId: invite.orgId };
  });

  app.get<{ Params: { orgId: string }; Querystring: { before?: string } }>('/:orgId/audit-logs', async (req) => {
    const user = requireUser(req);
    const { org } = await requireOrgRole(db, user, req.params.orgId, 'admin');
    const before = req.query.before ? new Date(req.query.before) : null;
    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        target: auditLogs.target,
        metadata: auditLogs.metadata,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(eq(auditLogs.orgId, org.id), before && !Number.isNaN(before.getTime()) ? lt(auditLogs.createdAt, before) : undefined))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
    return { entries: rows };
  });

  async function findInvite(token: string) {
    const [row] = await db
      .select({
        id: invitations.id,
        orgId: invitations.orgId,
        email: invitations.email,
        role: invitations.role,
        orgName: organizations.name,
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.orgId))
      .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .limit(1);
    if (!row) throw notFound('This invitation is invalid or has expired');
    return row;
  }
};
