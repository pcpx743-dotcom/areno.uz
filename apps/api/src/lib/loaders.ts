/**
 * Scoped loaders: fetch a record only if it belongs to the caller's club AND is inside
 * their branch / coach scope. Out-of-scope records return 404 (not 403) to avoid
 * leaking the existence of other tenants' data.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { athletes, groupEnrollments, groups } from '../db/schema.js';
import { canAccessBranch, type ClubCtx } from '../auth/context.js';
import { notFound } from './errors.js';

export async function loadGroup(db: Db | Tx, ctx: ClubCtx, id: string) {
  const [g] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, id), eq(groups.clubId, ctx.clubId)));
  if (!g) throw notFound('Group');
  if (ctx.role === 'coach') {
    if (!g.coachId || !ctx.coachIds.includes(g.coachId)) throw notFound('Group');
  } else if (!canAccessBranch(ctx, g.branchId)) {
    throw notFound('Group');
  }
  return g;
}

export async function loadAthlete(db: Db | Tx, ctx: ClubCtx, id: string) {
  const [a] = await db
    .select()
    .from(athletes)
    .where(and(eq(athletes.id, id), eq(athletes.clubId, ctx.clubId)));
  if (!a) throw notFound('Athlete');
  if (ctx.role === 'coach') {
    if (!ctx.coachIds.length) throw notFound('Athlete');
    const rows = await db
      .select({ id: groupEnrollments.id })
      .from(groupEnrollments)
      .innerJoin(groups, eq(groups.id, groupEnrollments.groupId))
      .where(
        and(
          eq(groupEnrollments.athleteId, id),
          ne(groupEnrollments.status, 'ended'),
          inArray(groups.coachId, ctx.coachIds),
        ),
      )
      .limit(1);
    if (!rows.length) throw notFound('Athlete');
  } else if (ctx.role === 'guardian' || !canAccessBranch(ctx, a.branchId)) {
    throw notFound('Athlete');
  }
  return a;
}
