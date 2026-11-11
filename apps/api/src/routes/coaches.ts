import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { coaches, groups } from '../db/schema.js';
import { requireClub, STAFF } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { forbidden, notFound } from '../lib/errors.js';
import { idParam, optText, phone } from '../lib/validation.js';
import { qcol } from '../lib/scope.js';

const body = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: phone.optional().nullable(),
  employment: optText,
  active: z.boolean().optional(),
});

export default async function coachRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    return db
      .select({
        id: coaches.id,
        fullName: coaches.fullName,
        phone: coaches.phone,
        employment: coaches.employment,
        active: coaches.active,
        userId: coaches.userId,
        groupCount: sql<number>`(select count(*) from ${groups} g where g.coach_id = ${qcol(coaches.id)} and g.active)`.mapWith(Number),
      })
      .from(coaches)
      .where(eq(coaches.clubId, ctx.clubId))
      .orderBy(asc(coaches.fullName));
  });

  app.get('/:id', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const { id } = idParam.parse(req.params);
    if (ctx.role === 'coach' && !ctx.coachIds.includes(id)) throw forbidden();
    const [coach] = await db
      .select()
      .from(coaches)
      .where(and(eq(coaches.id, id), eq(coaches.clubId, ctx.clubId)));
    if (!coach) throw notFound('Coach');
    const coachGroups = await db
      .select()
      .from(groups)
      .where(and(eq(groups.clubId, ctx.clubId), eq(groups.coachId, id)));
    return { ...coach, groups: coachGroups };
  });

  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const data = body.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [row] = await tx.insert(coaches).values({ ...data, clubId: ctx.clubId }).returning();
      await audit(tx, ctx, { action: 'create', entity: 'coaches', entityId: row.id, after: row });
      return row;
    });
    return reply.status(201).send(row);
  });

  app.patch('/:id', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const data = body.partial().parse(req.body);
    return db.transaction(async (tx) => {
      const where = and(eq(coaches.id, id), eq(coaches.clubId, ctx.clubId));
      const [before] = await tx.select().from(coaches).where(where);
      if (!before) throw notFound('Coach');
      const [after] = await tx.update(coaches).set(data).where(where).returning();
      await audit(tx, ctx, { action: 'update', entity: 'coaches', entityId: id, before, after });
      return after;
    });
  });
}
