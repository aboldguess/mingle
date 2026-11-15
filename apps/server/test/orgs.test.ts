import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, signUp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

async function inviteAndAccept(owner: Client, orgId: string, role = 'member') {
  const invitee = await signUp(ctx.app, 'Grace Hopper');
  const inv = await owner.post(`/api/orgs/${orgId}/invitations`, { email: invitee.email, role });
  expect(inv.statusCode).toBe(201);
  const token = inv.data.inviteUrl.split('/invite/')[1];
  const preview = await new Client(ctx.app).get(`/api/orgs/invitations/${token}`);
  expect(preview.data.email).toBe(invitee.email);
  const accept = await invitee.client.post(`/api/orgs/invitations/${token}/accept`);
  expect(accept.statusCode).toBe(200);
  return { ...invitee, token };
}

describe('organisations', () => {
  it('shows org details with plan limits', async () => {
    const { client, orgId } = await signUp(ctx.app);
    const res = await client.get(`/api/orgs/${orgId}`);
    expect(res.statusCode).toBe(200);
    expect(res.data.role).toBe('owner');
    expect(res.data.limits.maxMeetingMinutes).toBe(40);
    expect(res.data.usage.members).toBe(1);
  });

  it('hides orgs from non-members', async () => {
    const a = await signUp(ctx.app);
    const b = await signUp(ctx.app);
    expect((await b.client.get(`/api/orgs/${a.orgId}`)).statusCode).toBe(404);
    expect((await b.client.get(`/api/orgs/not-a-uuid`)).statusCode).toBe(404);
  });

  it('invites a member who accepts, and the invite cannot be reused', async () => {
    const owner = await signUp(ctx.app);
    const member = await inviteAndAccept(owner.client, owner.orgId);
    const members = await owner.client.get(`/api/orgs/${owner.orgId}/members`);
    expect(members.data.members).toHaveLength(2);
    expect((await member.client.post(`/api/orgs/invitations/${member.token}/accept`)).statusCode).toBe(404);
  });

  it('only lets the invited email accept', async () => {
    const owner = await signUp(ctx.app);
    const inv = await owner.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: 'someone.else@example.com' });
    const token = inv.data.inviteUrl.split('/invite/')[1];
    const stranger = await signUp(ctx.app);
    expect((await stranger.client.post(`/api/orgs/invitations/${token}/accept`)).statusCode).toBe(403);
  });

  it('enforces roles: members cannot invite or change roles', async () => {
    const owner = await signUp(ctx.app);
    const member = await inviteAndAccept(owner.client, owner.orgId);
    expect((await member.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: 'x@example.com' })).statusCode).toBe(403);
    expect((await member.client.patch(`/api/orgs/${owner.orgId}/members/${owner.userId}`, { role: 'member' })).statusCode).toBe(403);
    expect((await member.client.get(`/api/orgs/${owner.orgId}/audit-logs`)).statusCode).toBe(403);
  });

  it('never removes the last owner', async () => {
    const owner = await signUp(ctx.app);
    const res = await owner.client.patch(`/api/orgs/${owner.orgId}/members/${owner.userId}`, { role: 'admin' });
    expect(res.statusCode).toBe(400);
    expect(res.data.error.code).toBe('last_owner');
    expect((await owner.client.del(`/api/orgs/${owner.orgId}/members/${owner.userId}`)).statusCode).toBe(400);
  });

  it('caps members on the free plan', async () => {
    const owner = await signUp(ctx.app);
    await inviteAndAccept(owner.client, owner.orgId);
    await inviteAndAccept(owner.client, owner.orgId);
    const res = await owner.client.post(`/api/orgs/${owner.orgId}/invitations`, { email: 'fourth@example.com' });
    expect(res.statusCode).toBe(402);
  });

  it('records an audit trail', async () => {
    const owner = await signUp(ctx.app);
    await owner.client.patch(`/api/orgs/${owner.orgId}`, { name: 'Renamed Co' });
    const logs = await owner.client.get(`/api/orgs/${owner.orgId}/audit-logs`);
    expect(logs.data.entries.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['user.signup', 'org.updated']));
  });
});
