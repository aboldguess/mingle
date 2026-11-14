import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { memberships, organizations, sessions, users, type Organization, type OrgRole, type User } from '../db/schema.js';
import { newToken, sha256 } from './crypto.js';
import { forbidden, notFound, unauthorized } from './errors.js';

export const SESSION_COOKIE = 'mingle_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ROLE_RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

export async function createSession(db: Db, reply: FastifyReply, req: FastifyRequest, userId: string, secure: boolean) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 500),
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: expiresAt,
  });
}

export async function destroySession(db: Db, reply: FastifyReply, req: FastifyRequest) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function loadSessionUser(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const user = rows[0]?.user;
  if (!user || user.disabledAt) return null;
  return user;
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

export interface OrgContext {
  org: Organization;
  role: OrgRole;
}

/** Load an org the current user belongs to, requiring at least `minRole`. */
export async function requireOrgRole(db: Db, user: User, orgId: string, minRole: OrgRole = 'member'): Promise<OrgContext> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw notFound('Organisation not found');
  const rows = await db
    .select({ org: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('Organisation not found');
  if (ROLE_RANK[row.role] < ROLE_RANK[minRole]) throw forbidden();
  return row;
}

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}
