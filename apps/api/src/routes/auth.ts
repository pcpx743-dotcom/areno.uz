import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { clubs, memberships, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { badRequest, HttpError, unauthorized } from '../lib/errors.js';
import { RateLimiter } from '../lib/rate-limit.js';

// failed attempts only: 10 per email+IP and 50 per IP in 15 minutes
const perAccount = new RateLimiter(10, 15 * 60_000);
const perIp = new RateLimiter(50, 15 * 60_000);

const loginBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
  membershipId: z.uuid().optional(),
});

export default async function authRoutes(app: FastifyInstance) {
  const db = app.db;

  async function listMemberships(userId: string) {
    return db
      .select({
        id: memberships.id,
        clubId: memberships.clubId,
        clubName: clubs.name,
        logoUrl: clubs.logoUrl,
        role: memberships.role,
        branchIds: memberships.branchIds,
      })
      .from(memberships)
      .innerJoin(clubs, eq(clubs.id, memberships.clubId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active'), eq(clubs.status, 'active')));
  }

  app.post('/login', { config: { public: true } }, async (req) => {
    const body = loginBody.parse(req.body);
    const accountKey = `${req.ip}|${body.email}`;
    const wait = Math.max(perAccount.check(accountKey), perIp.check(req.ip));
    if (wait) throw new HttpError(429, 'too_many_attempts', `Too many login attempts. Try again in ${Math.ceil(wait / 60)} min.`, { retryAfter: wait });
    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    // Same error for unknown email and wrong password.
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      perAccount.hit(accountKey);
      perIp.hit(req.ip);
      throw unauthorized('Invalid email or password');
    }
    perAccount.reset(accountKey);
    const ms = await listMemberships(user.id);
    if (body.membershipId && !ms.some((m) => m.id === body.membershipId)) {
      throw badRequest('invalid_membership', 'Membership not available');
    }
    const active = body.membershipId ? ms.find((m) => m.id === body.membershipId) : ms[0];
    const token = await app.tokens.sign({ sub: user.id, mid: active?.id ?? null });
    return {
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, isSuperadmin: user.isSuperadmin },
      memberships: ms,
      activeMembershipId: active?.id ?? null,
    };
  });

  app.post('/switch', async (req) => {
    const { membershipId } = z.object({ membershipId: z.uuid() }).parse(req.body);
    const ms = await listMemberships(req.auth!.userId);
    if (!ms.some((m) => m.id === membershipId)) throw badRequest('invalid_membership', 'Membership not available');
    return { token: await app.tokens.sign({ sub: req.auth!.userId, mid: membershipId }), activeMembershipId: membershipId };
  });

  app.post('/password', async (req) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) })
      .parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.userId));
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw badRequest('wrong_password', 'Current password is incorrect');
    if (currentPassword === newPassword) throw badRequest('same_password', 'New password must differ');
    await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, user.id));
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const auth = req.auth!;
    const [user] = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName, isSuperadmin: users.isSuperadmin })
      .from(users)
      .where(eq(users.id, auth.userId));
    const ms = await listMemberships(auth.userId);
    const club = auth.club;
    return {
      user,
      memberships: ms,
      club: club
        ? {
            membershipId: club.membershipId,
            clubId: club.clubId,
            clubName: ms.find((m) => m.id === club.membershipId)?.clubName ?? null,
            logoUrl: ms.find((m) => m.id === club.membershipId)?.logoUrl ?? null,
            role: club.role,
            branchIds: club.branchIds,
            coachIds: club.coachIds,
            settings: club.settings,
          }
        : null,
    };
  });
}
