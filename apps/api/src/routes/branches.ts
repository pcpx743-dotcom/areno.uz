import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { branches } from '../db/schema.js';
import { requireClub } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { branchScope } from '../lib/scope.js';
import { idParam, optText } from '../lib/validation.js';

const body = z.object({
  name: z.string().trim().min(2).max(200),
  address: optText,
  phone: optText,
  active: z.boolean().optional(),
});

export default async function branchRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req);
    return db
      .select()
      .from(branches)
      .where(and(eq(branches.clubId, ctx.clubId), branchScope(ctx, branches.id)))
      .orderBy(asc(branches.name));
  });

  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, 'owner');
    const data = body.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [row] = await tx.insert(branches).values({ ...data, clubId: ctx.clubId }).returning();
      await audit(tx, ctx, { action: 'create', entity: 'branches', entityId: row.id, after: row });
      return row;
    });
    return reply.status(201).send(row);
  });

  app.patch('/:id', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const data = body.partial().parse(req.body);
    return db.transaction(async (tx) => {
      const where = and(eq(branches.id, id), eq(branches.clubId, ctx.clubId));
      const [before] = await tx.select().from(branches).where(where);
      if (!before) throw notFound('Branch');
      const [after] = await tx.update(branches).set(data).where(where).returning();
      await audit(tx, ctx, { action: 'update', entity: 'branches', entityId: id, before, after });
      return after;
    });
  });
}
