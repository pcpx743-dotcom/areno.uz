import type { Db, Tx } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export interface AuditEntry {
  action: string; // e.g. 'create' | 'update' | 'archive' | 'freeze'
  entity: string; // table name
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function audit(tx: Db | Tx, actor: { clubId: string | null; userId: string | null }, e: AuditEntry) {
  await tx.insert(auditLogs).values({
    clubId: actor.clubId,
    actorUserId: actor.userId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    before: (e.before ?? null) as never,
    after: (e.after ?? null) as never,
  });
}
