import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { admissionRequests, meetings, memberships, organizations, users, type Meeting, type Organization, type User } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { requireOrgRole, requireUser, roleAtLeast } from '../lib/auth.js';
import { newMeetingCode } from '../lib/crypto.js';
import { badRequest, forbidden, HttpError, notFound, paymentRequired, unauthorized } from '../lib/errors.js';
import { effectivePlan, PLANS } from '../plans.js';
import { roomNameFor, type MediaService } from '../services/livekit.js';

const meetingInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  scheduledStart: z.coerce.date().optional().nullable(),
  durationMinutes: z.coerce.number().int().min(5).max(24 * 60).default(60),
  allowGuests: z.boolean().default(true),
  waitingRoom: z.boolean().default(false),
  muteOnEntry: z.boolean().default(false),
});

const joinBody = z.object({ displayName: z.string().trim().min(1).max(80).optional() });

const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export function serializeMeeting(m: Meeting, appUrl: string) {
  return {
    id: m.id,
    orgId: m.orgId,
    hostId: m.hostId,
    code: m.code,
    title: m.title,
    description: m.description,
    scheduledStart: m.scheduledStart,
    durationMinutes: m.durationMinutes,
    status: m.status,
    allowGuests: m.allowGuests,
    waitingRoom: m.waitingRoom,
    muteOnEntry: m.muteOnEntry,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    joinUrl: `${appUrl}/m/${m.code}`,
  };
}

interface MeetingAccess {
  meeting: Meeting;
  org: Organization;
  /** Org role of the current user, if they are a member. */
  role: 'owner' | 'admin' | 'member' | null;
  isHost: boolean;
}

async function loadMeeting(db: Db, code: string, user: User | null): Promise<MeetingAccess> {
  if (!CODE_RE.test(code)) throw notFound('Meeting not found');
  const [row] = await db
    .select({ meeting: meetings, org: organizations })
    .from(meetings)
    .innerJoin(organizations, eq(organizations.id, meetings.orgId))
    .where(eq(meetings.code, code))
    .limit(1);
  if (!row) throw notFound('Meeting not found');
  let role: MeetingAccess['role'] = null;
  if (user) {
    const [m] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, row.org.id), eq(memberships.userId, user.id)));
    role = m?.role ?? null;
  }
  const isHost = Boolean(user && (row.meeting.hostId === user.id || (role && roleAtLeast(role, 'admin'))));
  return { ...row, role, isHost };
}

function requireHost(access: MeetingAccess) {
  if (!access.isHost) throw forbidden('Only the host can do that');
}

/** Minutes left before the plan's meeting length limit ends this meeting, or null if not started. */
export function minutesRemaining(meeting: Meeting, org: Organization, now = new Date()): number | null {
  if (!meeting.startedAt) return null;
  const limit = PLANS[effectivePlan(org)].maxMeetingMinutes;
  return limit - (now.getTime() - meeting.startedAt.getTime()) / 60000;
}

async function issueJoin(
  deps: { db: Db; media: MediaService },
  access: MeetingAccess,
  who: { identity: string; name: string; isHost: boolean },
) {
  const { meeting, org } = access;
  const plan = PLANS[effectivePlan(org)];
  const roomName = roomNameFor(meeting.code);
  const remaining = minutesRemaining(meeting, org);
  if (meeting.status === 'live' && remaining !== null && remaining <= 0) {
    throw paymentRequired(`This meeting reached the ${plan.maxMeetingMinutes}-minute limit of the ${plan.name} plan.`, 'time_limit');
  }
  await deps.media.ensureRoom(roomName, { maxParticipants: plan.maxParticipants });
  let startedAt = meeting.startedAt;
  if (meeting.status !== 'live' || !startedAt) {
    startedAt = new Date();
    await deps.db.update(meetings).set({ status: 'live', startedAt, endedAt: null }).where(eq(meetings.id, meeting.id));
  }
  const token = await deps.media.createJoinToken({
    roomName,
    identity: who.identity,
    name: who.name,
    isHost: who.isHost,
    metadata: { meetingCode: meeting.code },
  });
  const endsAt = new Date(startedAt.getTime() + plan.maxMeetingMinutes * 60000);
  return {
    status: 'admitted' as const,
    token,
    serverUrl: deps.media.url,
    isHost: who.isHost,
    identity: who.identity,
    muteOnEntry: meeting.muteOnEntry && !who.isHost,
    planLimitEndsAt: plan.maxMeetingMinutes < 24 * 60 ? endsAt : null,
  };
}

export const meetingRoutes: FastifyPluginAsync = async (app) => {
  const { db, media, config } = app.deps;

  // ----- Organisation scoped -----

  app.get<{ Params: { orgId: string }; Querystring: { scope?: string } }>('/orgs/:orgId/meetings', async (req) => {
    const user = requireUser(req);
    const { org } = await requireOrgRole(db, user, req.params.orgId);
    const past = req.query.scope === 'past';
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ meeting: meetings, hostName: users.name })
      .from(meetings)
      .leftJoin(users, eq(users.id, meetings.hostId))
      .where(
        and(
          eq(meetings.orgId, org.id),
          past
            ? or(inArray(meetings.status, ['ended', 'cancelled']), lt(meetings.scheduledStart, dayAgo))
            : and(
                inArray(meetings.status, ['scheduled', 'live']),
                or(isNull(meetings.scheduledStart), gte(meetings.scheduledStart, dayAgo)),
              ),
        ),
      )
      .orderBy(past ? desc(meetings.createdAt) : asc(meetings.scheduledStart))
      .limit(200);
    return { meetings: rows.map((r) => ({ ...serializeMeeting(r.meeting, config.APP_URL), hostName: r.hostName })) };
  });

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/meetings', async (req, reply) => {
    const user = requireUser(req);
    const { org } = await requireOrgRole(db, user, req.params.orgId);
    const body = meetingInput.parse(req.body ?? {});
    let meeting: Meeting | undefined;
    for (let attempt = 0; attempt < 5 && !meeting; attempt++) {
      [meeting] = await db
        .insert(meetings)
        .values({ ...body, orgId: org.id, hostId: user.id, code: newMeetingCode() })
        .onConflictDoNothing()
        .returning();
    }
    if (!meeting) throw new HttpError(500, 'code_collision', 'Could not allocate a meeting code');
    await audit(db, req, { orgId: org.id, actorId: user.id, action: 'meeting.created', target: meeting.code });
    return reply.code(201).send({ meeting: serializeMeeting(meeting, config.APP_URL) });
  });

  // ----- Meeting scoped (by code) -----

  app.get<{ Params: { code: string } }>('/meetings/:code', async (req) => {
    const access = await loadMeeting(db, req.params.code, req.user);
    const { meeting, org } = access;
    const [host] = meeting.hostId ? await db.select({ name: users.name }).from(users).where(eq(users.id, meeting.hostId)) : [];
    const base = {
      code: meeting.code,
      title: meeting.title,
      orgName: org.name,
      hostName: host?.name ?? null,
      scheduledStart: meeting.scheduledStart,
      status: meeting.status,
      guestsAllowed: meeting.allowGuests && !org.membersOnlyMeetings,
      waitingRoom: meeting.waitingRoom,
    };
    // Full details (settings, description) only for org members.
    if (access.role) return { ...base, isHost: access.isHost, meeting: serializeMeeting(meeting, config.APP_URL) };
    return { ...base, isHost: false };
  });

  app.patch<{ Params: { code: string } }>('/meetings/:code', async (req) => {
    const user = requireUser(req);
    const access = await loadMeeting(db, req.params.code, user);
    requireHost(access);
    const body = meetingInput.partial().parse(req.body ?? {});
    const [updated] = await db.update(meetings).set(body).where(eq(meetings.id, access.meeting.id)).returning();
    await audit(db, req, { orgId: access.org.id, actorId: user.id, action: 'meeting.updated', target: access.meeting.code });
    return { meeting: serializeMeeting(updated!, config.APP_URL) };
  });

  app.delete<{ Params: { code: string } }>('/meetings/:code', async (req) => {
    const user = requireUser(req);
    const access = await loadMeeting(db, req.params.code, user);
    requireHost(access);
    await media.endRoom(roomNameFor(access.meeting.code));
    await db.update(meetings).set({ status: 'cancelled', endedAt: new Date() }).where(eq(meetings.id, access.meeting.id));
    await audit(db, req, { orgId: access.org.id, actorId: user.id, action: 'meeting.cancelled', target: access.meeting.code });
    return { ok: true };
  });

  app.post<{ Params: { code: string } }>(
    '/meetings/:code/join',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const access = await loadMeeting(db, req.params.code, req.user);
      const { meeting, org } = access;
      const body = joinBody.parse(req.body ?? {});
      if (meeting.status === 'cancelled') throw badRequest('This meeting was cancelled', 'cancelled');

      const user = req.user;
      if (!user && (!meeting.allowGuests || org.membersOnlyMeetings)) {
        throw unauthorized('Sign in to join this meeting');
      }
      if (user && !access.role && org.membersOnlyMeetings) {
        throw forbidden(`Only members of ${org.name} can join this meeting`);
      }

      const name = user?.name ?? body.displayName;
      if (!name) throw badRequest('Enter your name to join', 'name_required');

      // Waiting room: anyone outside the organisation waits for the host.
      if (meeting.waitingRoom && !access.role) {
        const [request] = await db
          .insert(admissionRequests)
          .values({ meetingId: meeting.id, displayName: name, userId: user?.id })
          .returning();
        return reply.code(202).send({ status: 'waiting', requestId: request!.id });
      }

      const identity = user ? `u_${user.id}` : `g_${randomBytes(8).toString('hex')}`;
      const result = await issueJoin({ db, media }, access, { identity, name, isHost: access.isHost });
      await audit(db, req, { orgId: org.id, actorId: user?.id, action: 'meeting.joined', target: meeting.code, metadata: { identity, guest: !user } });
      return result;
    },
  );

  // Waiting guests poll this until the host admits or denies them.
  app.get<{ Params: { code: string; requestId: string } }>('/meetings/:code/admission/:requestId', async (req) => {
    const access = await loadMeeting(db, req.params.code, req.user);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.requestId)) throw notFound();
    const [request] = await db
      .select()
      .from(admissionRequests)
      .where(and(eq(admissionRequests.id, req.params.requestId), eq(admissionRequests.meetingId, access.meeting.id)));
    if (!request) throw notFound('Request not found');
    if (request.status === 'pending') return { status: 'waiting' };
    if (request.status === 'denied') return { status: 'denied' };
    if (request.status === 'consumed') throw badRequest('This admission was already used', 'consumed');
    // Admitted: hand out a token exactly once.
    const claimed = await db
      .update(admissionRequests)
      .set({ status: 'consumed' })
      .where(and(eq(admissionRequests.id, request.id), eq(admissionRequests.status, 'admitted')))
      .returning();
    if (!claimed.length) throw badRequest('This admission was already used', 'consumed');
    const identity = request.userId ? `u_${request.userId}` : `g_${randomBytes(8).toString('hex')}`;
    return issueJoin({ db, media }, access, { identity, name: request.displayName, isHost: false });
  });

  app.get<{ Params: { code: string } }>('/meetings/:code/admissions', async (req) => {
    const access = await loadMeeting(db, req.params.code, requireUser(req));
    requireHost(access);
    const pending = await db
      .select({ id: admissionRequests.id, displayName: admissionRequests.displayName, createdAt: admissionRequests.createdAt })
      .from(admissionRequests)
      .where(and(eq(admissionRequests.meetingId, access.meeting.id), eq(admissionRequests.status, 'pending')))
      .orderBy(asc(admissionRequests.createdAt));
    return { pending };
  });

  app.post<{ Params: { code: string; requestId: string } }>('/meetings/:code/admissions/:requestId', async (req) => {
    const user = requireUser(req);
    const access = await loadMeeting(db, req.params.code, user);
    requireHost(access);
    const body = z.object({ admit: z.boolean() }).parse(req.body);
    const updated = await db
      .update(admissionRequests)
      .set({ status: body.admit ? 'admitted' : 'denied', decidedAt: new Date() })
      .where(
        and(
          eq(admissionRequests.id, req.params.requestId),
          eq(admissionRequests.meetingId, access.meeting.id),
          eq(admissionRequests.status, 'pending'),
        ),
      )
      .returning();
    if (!updated.length) throw notFound('Request not found');
    return { ok: true };
  });

  const hostAction = (action: 'remove' | 'mute') =>
    async (req: FastifyRequest<{ Params: { code: string; identity: string } }>) => {
      const user = requireUser(req);
      const access = await loadMeeting(db, req.params.code, user);
      requireHost(access);
      const room = roomNameFor(access.meeting.code);
      if (action === 'remove') await media.removeParticipant(room, req.params.identity);
      else await media.muteParticipant(room, req.params.identity);
      await audit(db, req, { orgId: access.org.id, actorId: user.id, action: `meeting.participant_${action === 'remove' ? 'removed' : 'muted'}`, target: req.params.identity });
      return { ok: true };
    };

  app.post('/meetings/:code/participants/:identity/remove', hostAction('remove'));
  app.post('/meetings/:code/participants/:identity/mute', hostAction('mute'));

  app.post<{ Params: { code: string } }>('/meetings/:code/end', async (req) => {
    const user = requireUser(req);
    const access = await loadMeeting(db, req.params.code, user);
    requireHost(access);
    await endMeeting(db, media, access.meeting);
    await audit(db, req, { orgId: access.org.id, actorId: user.id, action: 'meeting.ended', target: access.meeting.code });
    return { ok: true };
  });
};

export async function endMeeting(db: Db, media: MediaService, meeting: Meeting) {
  await media.endRoom(roomNameFor(meeting.code));
  await db
    .update(meetings)
    .set({ status: 'ended', endedAt: new Date(), startedAt: null })
    .where(eq(meetings.id, meeting.id));
}

/**
 * Ends live meetings that ran past their plan's length limit. Runs on an
 * interval in the server process; safe to run on several instances at once.
 */
export async function enforceMeetingLimits(db: Db, media: MediaService, now = new Date()): Promise<number> {
  const live = await db
    .select({ meeting: meetings, org: organizations })
    .from(meetings)
    .innerJoin(organizations, eq(organizations.id, meetings.orgId))
    .where(eq(meetings.status, 'live'));
  let ended = 0;
  for (const { meeting, org } of live) {
    const remaining = minutesRemaining(meeting, org, now);
    if (remaining !== null && remaining <= 0) {
      await endMeeting(db, media, meeting);
      ended++;
    }
  }
  return ended;
}
