import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export async function audit(
  db: Db,
  req: FastifyRequest | null,
  entry: { orgId?: string | null; actorId?: string | null; action: string; target?: string; metadata?: Record<string, unknown> },
) {
  try {
    await db.insert(auditLogs).values({
      orgId: entry.orgId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      target: entry.target,
      metadata: entry.metadata,
      ip: req?.ip,
    });
  } catch (err) {
    // Auditing must never break the request that triggered it.
    req?.log.error({ err }, 'failed to write audit log');
  }
}
