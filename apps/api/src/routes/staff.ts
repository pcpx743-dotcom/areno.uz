/** Staff accounts & roles inside a club (owner only). */
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { branches, coaches, memberships, users } from '../db/schema.js';
import { requireClub, type ClubCtx } from '../auth/context.js';
import { hashPassword } from '../auth/password.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { idParam, phone } from '../lib/validation.js';
import type { Db, Tx } from '../db/client.js';

const createBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  fullName: z.string().trim().min(2),
  phone: phone.optional().nullable(),
  password: z.string().min(8),
  role: z.enum(['branch_admin', 'coach']),
  branchIds: z.array(z.uuid()).default([]),
  /** For role=coach: link to an existing coach record (else one is created). */
  coachId: z.uuid().optional(),
});

async function assertBranchesInClub(db: Db | Tx, ctx: ClubCtx, ids: string[]) {
  if (!ids.length) return;
  const rows = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.clubId, ctx.clubId), inArray(branches.id, ids)));
  if (rows.length !== new Set(ids).size) throw badRequest('invalid_branch', 'Unknown branch');
}

export default async function staffRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req, 'owner');
    return db
      .select({
        membershipId: memberships.id,
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        role: memberships.role,
        branchIds: memberships.branchIds,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.clubId, ctx.clubId), inArray(memberships.role, ['owner', 'branch_admin', 'coach'])));
  });

  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, 'owner');
    const data = createBody.parse(req.body);
    if (data.role === 'branch_admin' && data.branchIds.length === 0) {
      throw badRequest('branch_required', 'Branch admin needs at least one branch');
    }
    const passwordHash = await hashPassword(data.password);
    const result = await db.transaction(async (tx) => {
      await assertBranchesInClub(tx, ctx, data.branchIds);
      let [user] = await tx.select().from(users).where(eq(users.email, data.email));
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({ email: data.email, fullName: data.fullName, phone: data.phone ?? null, passwordHash })
          .returning();
      }
      const [m] = await tx
        .insert(memberships)
        .values({ userId: user.id, clubId: ctx.clubId, role: data.role, branchIds: data.branchIds })
        .returning();
      let coachId: string | null = null;
      if (data.role === 'coach') {
        if (data.coachId) {
          const [c] = await tx
            .update(coaches)
            .set({ userId: user.id })
            .where(and(eq(coaches.id, data.coachId), eq(coaches.clubId, ctx.clubId)))
            .returning();
          if (!c) throw notFound('Coach');
          coachId = c.id;
        } else {
          const [c] = await tx
            .insert(coaches)
            .values({ clubId: ctx.clubId, userId: user.id, fullName: data.fullName, phone: data.phone ?? null })
            .returning();
          coachId = c.id;
        }
      }
      await audit(tx, ctx, { action: 'create', entity: 'memberships', entityId: m.id, after: { ...m, email: data.email } });
      return { membershipId: m.id, userId: user.id, role: m.role, branchIds: m.branchIds, coachId };
    });
    return reply.status(201).send(result);
  });

  /** Owner sets a new password for a staff member who belongs only to this club. */
  app.post('/:id/password', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const { password } = z.object({ password: z.string().min(8).max(200) }).parse(req.body);
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, id), eq(memberships.clubId, ctx.clubId)));
    if (!m) throw notFound('Membership');
    if (m.role === 'owner') throw badRequest('owner_immutable', 'Owners change their own password');
    const others = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, m.userId));
    if (others.some((o) => o.id !== m.id)) {
      throw badRequest('shared_account', 'This user also belongs to another club; they must change the password themselves');
    }
    await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, m.userId));
    await audit(db, ctx, { action: 'reset_password', entity: 'users', entityId: m.userId });
    return { ok: true };
  });

  app.patch('/:id', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const data = z
      .object({ branchIds: z.array(z.uuid()).optional(), status: z.enum(['active', 'disabled']).optional() })
      .parse(req.body);
    return db.transaction(async (tx) => {
      if (data.branchIds) await assertBranchesInClub(tx, ctx, data.branchIds);
      const where = and(eq(memberships.id, id), eq(memberships.clubId, ctx.clubId));
      const [before] = await tx.select().from(memberships).where(where);
      if (!before) throw notFound('Membership');
      if (before.role === 'owner') throw badRequest('owner_immutable', 'Owner membership cannot be changed here');
      const [after] = await tx.update(memberships).set(data).where(where).returning();
      await audit(tx, ctx, { action: 'update', entity: 'memberships', entityId: id, before, after });
      return after;
    });
  });
}
