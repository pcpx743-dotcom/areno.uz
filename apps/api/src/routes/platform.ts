/** Platform superadmin (PRD §2): manages clubs; does not read club business data. */
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { athletes, branches, clubs, memberships, users } from '../db/schema.js';
import { requireSuperadmin } from '../auth/context.js';
import { hashPassword } from '../auth/password.js';
import { audit } from '../lib/audit.js';
import { idParam } from '../lib/validation.js';
import { notFound } from '../lib/errors.js';
import { qcol } from '../lib/scope.js';

const createClub = z.object({
  name: z.string().trim().min(2).max(200),
  timezone: z.string().default('Asia/Tashkent'),
  owner: z.object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    fullName: z.string().trim().min(2),
    password: z.string().min(8),
  }),
});

export default async function platformRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/clubs', async (req) => {
    requireSuperadmin(req);
    // Aggregates only — no personal data.
    return db
      .select({
        id: clubs.id,
        name: clubs.name,
        status: clubs.status,
        timezone: clubs.timezone,
        createdAt: clubs.createdAt,
        branchCount: sql<number>`(select count(*) from ${branches} b where b.club_id = ${qcol(clubs.id)})`.mapWith(Number),
        athleteCount: sql<number>`(select count(*) from ${athletes} a where a.club_id = ${qcol(clubs.id)} and a.status = 'active')`.mapWith(
          Number,
        ),
      })
      .from(clubs)
      .orderBy(clubs.createdAt);
  });

  app.post('/clubs', async (req, reply) => {
    const auth = requireSuperadmin(req);
    const body = createClub.parse(req.body);
    const passwordHash = await hashPassword(body.owner.password);
    const result = await db.transaction(async (tx) => {
      const [club] = await tx.insert(clubs).values({ name: body.name, timezone: body.timezone }).returning();
      let [owner] = await tx.select().from(users).where(eq(users.email, body.owner.email));
      if (!owner) {
        [owner] = await tx.insert(users).values({ email: body.owner.email, fullName: body.owner.fullName, passwordHash }).returning();
      }
      await tx.insert(memberships).values({ userId: owner.id, clubId: club.id, role: 'owner' });
      await audit(tx, { clubId: club.id, userId: auth.userId }, { action: 'create', entity: 'clubs', entityId: club.id, after: club });
      return { club, ownerUserId: owner.id };
    });
    return reply.status(201).send(result);
  });

  app.patch('/clubs/:id', async (req) => {
    const auth = requireSuperadmin(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        status: z.enum(['active', 'suspended', 'archived']).optional(),
        name: z.string().trim().min(2).optional(),
        logoUrl: z.string().trim().max(500).regex(/^(https:\/\/|\/)/, 'Must be an https URL or a /path').nullable().optional(),
      })
      .parse(req.body);
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(clubs).where(eq(clubs.id, id));
      if (!before) throw notFound('Club');
      const [after] = await tx.update(clubs).set(body).where(eq(clubs.id, id)).returning();
      await audit(tx, { clubId: id, userId: auth.userId }, { action: 'update', entity: 'clubs', entityId: id, before, after });
      return after;
    });
  });
}
