import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { meetings, organizations } from '../src/db/schema.js';
import { enforceMeetingLimits } from '../src/routes/meetings.js';
import { Client, createTestApp, signUp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
const { db, pool } = createDb(process.env.DATABASE_URL!);
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
  await pool.end();
});

async function createMeeting(client: Client, orgId: string, body: Record<string, unknown> = {}) {
  const res = await client.post(`/api/orgs/${orgId}/meetings`, { title: 'Weekly sync', ...body });
  expect(res.statusCode).toBe(201);
  return res.data.meeting as { code: string; joinUrl: string; id: string };
}

describe('meetings', () => {
  it('schedules a meeting with a shareable code and lists it', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const start = new Date(Date.now() + 3600_000).toISOString();
    const meeting = await createMeeting(client, orgId, { scheduledStart: start, durationMinutes: 30 });
    expect(meeting.code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    expect(meeting.joinUrl).toBe(`http://localhost:5173/m/${meeting.code}`);
    const list = await client.get(`/api/orgs/${orgId}/meetings`);
    expect(list.data.meetings.map((m: { code: string }) => m.code)).toContain(meeting.code);
  });

  it('lets the host join with admin rights and a guest join without', async () => {
    const { client, orgId, userId } = await signUp(ctx.app);
    const { code } = await createMeeting(client, orgId);

    const host = await client.post(`/api/meetings/${code}/join`);
    expect(host.statusCode).toBe(200);
    expect(host.data).toMatchObject({ status: 'admitted', isHost: true, identity: `u_${userId}`, serverUrl: 'wss://livekit.test' });
    expect(host.data.planLimitEndsAt).toBeTruthy(); // free plan: 40 minute cap

    const guest = new Client(ctx.app);
    const info = await guest.get(`/api/meetings/${code}`);
    expect(info.data).toMatchObject({ title: 'Weekly sync', guestsAllowed: true, isHost: false });
    expect(info.data.meeting).toBeUndefined();
    expect((await guest.post(`/api/meetings/${code}/join`)).data.error.code).toBe('name_required');
    const joined = await guest.post(`/api/meetings/${code}/join`, { displayName: 'Visitor' });
    expect(joined.statusCode).toBe(200);
    expect(joined.data.isHost).toBe(false);
    expect(joined.data.identity).toMatch(/^g_/);

    const roomCalls = ctx.media.calls.filter((c) => c.op === 'ensureRoom' && c.args[0] === `mingle-${code}`);
    expect(roomCalls[0]!.args[1]).toEqual({ maxParticipants: 100 });
  });

  it('requires sign-in when guests are not allowed', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const { code } = await createMeeting(client, orgId, { allowGuests: false });
    const res = await new Client(ctx.app).post(`/api/meetings/${code}/join`, { displayName: 'Visitor' });
    expect(res.statusCode).toBe(401);
  });

  it('runs a waiting room: guest waits, host admits, token is issued once', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const { code } = await createMeeting(client, orgId, { waitingRoom: true });
    const guest = new Client(ctx.app);
    const wait = await guest.post(`/api/meetings/${code}/join`, { displayName: 'Waiting Wendy' });
    expect(wait.statusCode).toBe(202);
    const requestId = wait.data.requestId;
    expect((await guest.get(`/api/meetings/${code}/admission/${requestId}`)).data.status).toBe('waiting');

    // Guests cannot admit themselves.
    expect((await guest.post(`/api/meetings/${code}/admissions/${requestId}`, { admit: true })).statusCode).toBe(401);

    const pending = await client.get(`/api/meetings/${code}/admissions`);
    expect(pending.data.pending).toEqual([expect.objectContaining({ id: requestId, displayName: 'Waiting Wendy' })]);
    expect((await client.post(`/api/meetings/${code}/admissions/${requestId}`, { admit: true })).statusCode).toBe(200);

    const admitted = await guest.get(`/api/meetings/${code}/admission/${requestId}`);
    expect(admitted.data.status).toBe('admitted');
    expect(admitted.data.token).toBeTruthy();
    expect((await guest.get(`/api/meetings/${code}/admission/${requestId}`)).statusCode).toBe(400);
  });

  it('restricts host controls to the host and org admins', async () => {
    const owner = await signUp(ctx.app);
    const { code } = await createMeeting(owner.client, owner.orgId);
    const outsider = await signUp(ctx.app);
    expect((await outsider.client.post(`/api/meetings/${code}/participants/g_abc/remove`)).statusCode).toBe(403);
    expect((await outsider.client.post(`/api/meetings/${code}/end`)).statusCode).toBe(403);
    expect((await owner.client.post(`/api/meetings/${code}/participants/g_abc/mute`)).statusCode).toBe(200);
    expect((await owner.client.post(`/api/meetings/${code}/end`)).statusCode).toBe(200);
    expect(ctx.media.calls).toEqual(expect.arrayContaining([{ op: 'endRoom', args: [`mingle-${code}`] }]));
  });

  it('blocks non-members when the org is members-only', async () => {
    const owner = await signUp(ctx.app);
    await owner.client.patch(`/api/orgs/${owner.orgId}`, { membersOnlyMeetings: true });
    const { code } = await createMeeting(owner.client, owner.orgId);
    const outsider = await signUp(ctx.app);
    expect((await outsider.client.post(`/api/meetings/${code}/join`)).statusCode).toBe(403);
    expect((await new Client(ctx.app).post(`/api/meetings/${code}/join`, { displayName: 'G' })).statusCode).toBe(401);
  });

  it('cancels meetings and refuses joins afterwards', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const { code } = await createMeeting(client, orgId);
    expect((await client.del(`/api/meetings/${code}`)).statusCode).toBe(200);
    expect((await client.post(`/api/meetings/${code}/join`)).data.error.code).toBe('cancelled');
  });

  it('returns 404 for unknown or malformed codes', async () => {
    const c = new Client(ctx.app);
    expect((await c.get('/api/meetings/aaa-aaaa-aaa')).statusCode).toBe(404);
    expect((await c.get('/api/meetings/../../etc')).statusCode).toBe(404);
  });
});

describe('plan limits', () => {
  it('ends free meetings after 40 minutes but not paid ones', async () => {
    const free = await signUp(ctx.app);
    const paid = await signUp(ctx.app);
    await db.update(organizations).set({ plan: 'pro', subscriptionStatus: 'active' }).where(eq(organizations.id, paid.orgId));
    const freeMeeting = await createMeeting(free.client, free.orgId);
    const paidMeeting = await createMeeting(paid.client, paid.orgId);
    await free.client.post(`/api/meetings/${freeMeeting.code}/join`);
    const paidJoin = await paid.client.post(`/api/meetings/${paidMeeting.code}/join`);
    expect(paidJoin.data.planLimitEndsAt).toBeNull();

    const fortyOneMinutesLater = new Date(Date.now() + 41 * 60_000);
    await enforceMeetingLimits(db, ctx.media, fortyOneMinutesLater);
    const [f] = await db.select().from(meetings).where(eq(meetings.code, freeMeeting.code));
    const [p] = await db.select().from(meetings).where(eq(meetings.code, paidMeeting.code));
    expect(f!.status).toBe('ended');
    expect(p!.status).toBe('live');
  });

  it('refuses to rejoin a live free meeting past the limit', async () => {
    const free = await signUp(ctx.app);
    const m = await createMeeting(free.client, free.orgId);
    await free.client.post(`/api/meetings/${m.code}/join`);
    await db.update(meetings).set({ startedAt: new Date(Date.now() - 45 * 60_000) }).where(eq(meetings.code, m.code));
    const res = await free.client.post(`/api/meetings/${m.code}/join`);
    expect(res.statusCode).toBe(402);
    expect(res.data.error.code).toBe('time_limit');
  });
});
