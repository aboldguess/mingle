import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, signUp, uniqueEmail, type TestCtx } from './helpers.js';
import { hashPassword, verifyPassword } from '../src/lib/crypto.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('s3cret-password');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('s3cret-password', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('auth', () => {
  it('signs up, creates a personal org, and returns the session user', async () => {
    const { client, email, orgId } = await signUp(ctx.app);
    expect(client.cookie).toMatch(/^mingle_session=/);
    const me = await client.get('/api/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.data.user.email).toBe(email);
    expect(me.data.orgs).toEqual([expect.objectContaining({ id: orgId, role: 'owner', plan: 'free' })]);
    expect(JSON.stringify(me.data)).not.toContain('password');
  });

  it('rejects duplicate emails case-insensitively', async () => {
    const { email } = await signUp(ctx.app);
    const res = await new Client(ctx.app).post('/api/auth/signup', { email: email.toUpperCase(), password: 'another long password', name: 'X' });
    expect(res.statusCode).toBe(409);
    expect(res.data.error.code).toBe('email_taken');
  });

  it('enforces a minimum password length', async () => {
    const res = await new Client(ctx.app).post('/api/auth/signup', { email: uniqueEmail(), password: 'short', name: 'X' });
    expect(res.statusCode).toBe(400);
    expect(res.data.error.code).toBe('invalid_input');
  });

  it('logs in and out', async () => {
    const { email } = await signUp(ctx.app);
    const client = new Client(ctx.app);
    expect((await client.post('/api/auth/login', { email, password: 'wrong password!' })).statusCode).toBe(401);
    expect((await client.post('/api/auth/login', { email, password: 'correct horse battery' })).statusCode).toBe(200);
    expect((await client.get('/api/auth/me')).statusCode).toBe(200);
    await client.post('/api/auth/logout');
    expect((await client.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('blocks cross-site state-changing requests', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'a@b.co', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('changes password only with the current password', async () => {
    const { client, email } = await signUp(ctx.app);
    expect((await client.patch('/api/auth/me', { currentPassword: 'nope', newPassword: 'a brand new password' })).statusCode).toBe(401);
    expect((await client.patch('/api/auth/me', { currentPassword: 'correct horse battery', newPassword: 'a brand new password' })).statusCode).toBe(200);
    const fresh = new Client(ctx.app);
    expect((await fresh.post('/api/auth/login', { email, password: 'a brand new password' })).statusCode).toBe(200);
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_PER_MIN: '3' });
    try {
      const client = new Client(limited.app);
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await client.post('/api/auth/login', { email: 'nobody@example.com', password: 'x' })).statusCode);
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes[4]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
