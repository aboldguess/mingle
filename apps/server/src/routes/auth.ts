import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { memberships, organizations, users } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { createSession, destroySession, publicUser, requireUser } from '../lib/auth.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { createOrganization } from '../services/orgs.js';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10, 'must be at least 10 characters').max(200);

const signupBody = z.object({
  email,
  password,
  name: z.string().trim().min(1).max(100),
  orgName: z.string().trim().min(1).max(100).optional(),
});

const loginBody = z.object({ email, password: z.string().min(1).max(200) });

// Used to keep login timing the same whether or not the email exists.
const DUMMY_HASH = hashPassword('not-a-real-password-just-timing');

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app.deps;
  const secureCookies = config.APP_URL.startsWith('https://');
  const authRateLimit = { config: { rateLimit: { max: config.AUTH_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } } };

  app.post('/signup', authRateLimit, async (req, reply) => {
    const body = signupBody.parse(req.body);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${body.email}`)
      .limit(1);
    if (existing.length) throw conflict('An account with that email already exists', 'email_taken');

    const passwordHash = await hashPassword(body.password);
    const { user, org } = await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email: body.email, name: body.name, passwordHash }).returning();
      const org = await createOrganization(tx, { name: body.orgName ?? `${body.name}'s team`, ownerId: user!.id });
      return { user: user!, org };
    });

    await createSession(db, reply, req, user.id, secureCookies);
    await audit(db, req, { orgId: org.id, actorId: user.id, action: 'user.signup' });
    return reply.code(201).send({ user: publicUser(user), orgId: org.id });
  });

  app.post('/login', authRateLimit, async (req, reply) => {
    const body = loginBody.parse(req.body);
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${body.email}`)
      .limit(1);
    const ok = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : (await DUMMY_HASH, false);
    if (!user || !ok || user.disabledAt) {
      await audit(db, req, { actorId: user?.id, action: 'user.login_failed', metadata: { email: body.email } });
      throw unauthorized('Incorrect email or password');
    }
    await createSession(db, reply, req, user.id, secureCookies);
    await audit(db, req, { actorId: user.id, action: 'user.login' });
    return { user: publicUser(user) };
  });

  app.post('/logout', async (req, reply) => {
    await destroySession(db, reply, req);
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const user = requireUser(req);
    const orgs = await db
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, plan: organizations.plan, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, user.id))
      .orderBy(memberships.createdAt);
    return { user: publicUser(user), orgs, isPlatformAdmin: config.PLATFORM_ADMIN_EMAILS.includes(user.email.toLowerCase()) };
  });

  app.patch('/me', async (req) => {
    const user = requireUser(req);
    const body = z
      .object({ name: z.string().trim().min(1).max(100).optional(), currentPassword: z.string().optional(), newPassword: password.optional() })
      .parse(req.body);
    const update: Partial<typeof users.$inferInsert> = {};
    if (body.name) update.name = body.name;
    if (body.newPassword) {
      if (!user.passwordHash || !body.currentPassword || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
        throw unauthorized('Current password is incorrect');
      }
      update.passwordHash = await hashPassword(body.newPassword);
    }
    if (Object.keys(update).length) {
      const [updated] = await db.update(users).set(update).where(eq(users.id, user.id)).returning();
      if (body.newPassword) await audit(db, req, { actorId: user.id, action: 'user.password_changed' });
      return { user: publicUser(updated!) };
    }
    return { user: publicUser(user) };
  });
};
