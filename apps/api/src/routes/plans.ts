import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { branches, plans, sports } from '../db/schema.js';
import { requireClub, STAFF } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { idParam, uzs } from '../lib/validation.js';
import type { Db, Tx } from '../db/client.js';
import type { ClubCtx } from '../auth/context.js';

const planBase = z.object({
  name: z.string().trim().min(2).max(200),
  sportId: z.uuid().nullable().optional(),
  kind: z.enum(['group', 'single', 'individual']).default('group'),
  billingType: z.enum(['calendar_month', 'fixed_days', 'session_pack']),
  price: uzs,
  durationDays: z.number().int().min(1).max(366).nullable().optional(),
  sessionLimit: z.number().int().min(1).max(500).nullable().optional(),
  maxValidityDays: z.number().int().min(1).max(366).nullable().optional(),
  branchIds: z.array(z.uuid()).default([]),
  active: z.boolean().optional(),
});

type PlanInput = Partial<z.infer<typeof planBase>>;

function validateTerms(p: PlanInput) {
  if (p.billingType === 'session_pack' && !p.sessionLimit) throw badRequest('invalid_plan', 'session_pack requires sessionLimit');
  if (p.billingType === 'fixed_days' && p.durationDays == null) p.durationDays = 30;
}

async function assertRefs(db: Db | Tx, ctx: ClubCtx, p: PlanInput) {
  if (p.sportId) {
    const [s] = await db
      .select({ id: sports.id })
      .from(sports)
      .where(and(eq(sports.id, p.sportId), eq(sports.clubId, ctx.clubId)));
    if (!s) throw badRequest('invalid_reference', 'Unknown sport');
  }
  if (p.branchIds?.length) {
    const rows = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.clubId, ctx.clubId), inArray(branches.id, p.branchIds)));
    if (rows.length !== new Set(p.branchIds).size) throw badRequest('invalid_reference', 'Unknown branch');
  }
}

export default async function planRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    return db.select().from(plans).where(eq(plans.clubId, ctx.clubId)).orderBy(asc(plans.name));
  });

  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, 'owner');
    const data = planBase.parse(req.body);
    validateTerms(data);
    const row = await db.transaction(async (tx) => {
      await assertRefs(tx, ctx, data);
      const [row] = await tx.insert(plans).values({ ...data, clubId: ctx.clubId }).returning();
      await audit(tx, ctx, { action: 'create', entity: 'plans', entityId: row.id, after: row });
      return row;
    });
    return reply.status(201).send(row);
  });

  app.patch('/:id', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const data = planBase.partial().parse(req.body);
    return db.transaction(async (tx) => {
      const where = and(eq(plans.id, id), eq(plans.clubId, ctx.clubId));
      const [before] = await tx.select().from(plans).where(where);
      if (!before) throw notFound('Plan');
      validateTerms({ ...before, ...data });
      await assertRefs(tx, ctx, data);
      // Existing subscriptions keep their own copy of terms; edits affect new ones only.
      const [after] = await tx.update(plans).set(data).where(where).returning();
      await audit(tx, ctx, { action: 'update', entity: 'plans', entityId: id, before, after });
      return after;
    });
  });
}
