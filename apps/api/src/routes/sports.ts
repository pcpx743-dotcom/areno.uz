import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { sports } from '../db/schema.js';
import { requireClub } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { idParam } from '../lib/validation.js';

const body = z.object({ name: z.string().trim().min(2).max(100), active: z.boolean().optional() });

export default async function sportRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req);
    return db.select().from(sports).where(eq(sports.clubId, ctx.clubId)).orderBy(asc(sports.name));
  });

  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, 'owner');
    const data = body.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [row] = await tx.insert(sports).values({ ...data, clubId: ctx.clubId }).returning();
      await audit(tx, ctx, { action: 'create', entity: 'sports', entityId: row.id, after: row });
      return row;
    });
    return reply.status(201).send(row);
  });

  app.patch('/:id', async (req) => {
    const ctx = requireClub(req, 'owner');
    const { id } = idParam.parse(req.params);
    const data = body.partial().parse(req.body);
    return db.transaction(async (tx) => {
      const where = and(eq(sports.id, id), eq(sports.clubId, ctx.clubId));
      const [before] = await tx.select().from(sports).where(where);
      if (!before) throw notFound('Sport');
      const [after] = await tx.update(sports).set(data).where(where).returning();
      await audit(tx, ctx, { action: 'update', entity: 'sports', entityId: id, before, after });
      return after;
    });
  });
}
