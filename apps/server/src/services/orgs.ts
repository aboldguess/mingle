import { count, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema.js';
import { memberships, organizations, type Organization } from '../db/schema.js';
import { slugify } from '../lib/crypto.js';
import { randomBytes } from 'node:crypto';

type Tx = NodePgDatabase<typeof schema>;

export async function createOrganization(tx: Tx, input: { name: string; ownerId: string }): Promise<Organization> {
  const base = slugify(input.name);
  let slug = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (!taken.length) break;
    slug = `${base}-${randomBytes(3).toString('hex')}`;
  }
  const [org] = await tx.insert(organizations).values({ name: input.name, slug }).returning();
  await tx.insert(memberships).values({ orgId: org!.id, userId: input.ownerId, role: 'owner' });
  return org!;
}

export async function memberCount(tx: Tx, orgId: string): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.orgId, orgId));
  return row?.n ?? 0;
}

export async function ownerCount(tx: Tx, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(memberships)
    .where(sql`${memberships.orgId} = ${orgId} and ${memberships.role} = 'owner'`);
  return row?.n ?? 0;
}
