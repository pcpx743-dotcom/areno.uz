/**
 * Request auth context + RBAC helpers (PRD §2).
 * The club (tenant) and branch scope are resolved on the server from the token's
 * membership id — club_id sent by the client is never trusted.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { clubs, coaches, groups, memberships, users, DEFAULT_CLUB_SETTINGS, type ClubSettings } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { TokenService } from './tokens.js';

export type Role = 'owner' | 'branch_admin' | 'coach' | 'guardian';

export interface ClubCtx {
  userId: string;
  membershipId: string;
  clubId: string;
  role: Role;
  /** Branches this user may access; null = all branches of the club. */
  branchIds: string[] | null;
  /** Coach record ids linked to this user (role = coach). */
  coachIds: string[];
  timezone: string;
  settings: ClubSettings;
}

export interface AuthCtx {
  userId: string;
  isSuperadmin: boolean;
  club: ClubCtx | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthCtx;
  }
}

export async function resolveAuth(req: FastifyRequest, db: Db, tokens: TokenService): Promise<AuthCtx> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let claims;
  try {
    claims = await tokens.verify(header.slice(7));
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const [user] = await db.select({ id: users.id, isSuperadmin: users.isSuperadmin }).from(users).where(eq(users.id, claims.sub));
  if (!user) throw unauthorized();

  let club: ClubCtx | null = null;
  if (claims.mid) {
    const [m] = await db
      .select({
        id: memberships.id,
        clubId: memberships.clubId,
        role: memberships.role,
        branchIds: memberships.branchIds,
        status: memberships.status,
        clubStatus: clubs.status,
        timezone: clubs.timezone,
        settings: clubs.settings,
      })
      .from(memberships)
      .innerJoin(clubs, eq(clubs.id, memberships.clubId))
      .where(and(eq(memberships.id, claims.mid), eq(memberships.userId, user.id)));
    if (!m || m.status !== 'active') throw unauthorized('Membership is not active');
    if (m.clubStatus !== 'active') throw forbidden('Club is not active');
    let coachIds: string[] = [];
    if (m.role === 'coach') {
      const rows = await db
        .select({ id: coaches.id })
        .from(coaches)
        .where(and(eq(coaches.clubId, m.clubId), eq(coaches.userId, user.id)));
      coachIds = rows.map((r) => r.id);
    }
    club = {
      userId: user.id,
      membershipId: m.id,
      clubId: m.clubId,
      role: m.role,
      branchIds: m.role === 'owner' ? null : m.branchIds,
      coachIds,
      timezone: m.timezone,
      // stored settings may predate newer keys
      settings: { ...DEFAULT_CLUB_SETTINGS, ...m.settings },
    };
  }
  return { userId: user.id, isSuperadmin: user.isSuperadmin, club };
}

// ---------- guards ----------

export function requireClub(req: FastifyRequest, ...roles: Role[]): ClubCtx {
  const ctx = req.auth?.club;
  if (!ctx) throw forbidden('No club context');
  if (roles.length && !roles.includes(ctx.role)) throw forbidden(`Requires role: ${roles.join(', ')}`);
  return ctx;
}

export function requireSuperadmin(req: FastifyRequest): AuthCtx {
  if (!req.auth?.isSuperadmin) throw forbidden('Superadmin only');
  return req.auth;
}

/** Staff = roles that manage club data (not coaches / guardians). */
export const STAFF: Role[] = ['owner', 'branch_admin'];

export function canAccessBranch(ctx: ClubCtx, branchId: string): boolean {
  return ctx.branchIds === null || ctx.branchIds.includes(branchId);
}

export function assertBranch(ctx: ClubCtx, branchId: string): void {
  if (!canAccessBranch(ctx, branchId)) throw forbidden('No access to this branch');
}

/** Group ids a coach is assigned to. */
export async function coachGroupIds(db: Db, ctx: ClubCtx): Promise<string[]> {
  if (!ctx.coachIds.length) return [];
  const rows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.clubId, ctx.clubId), inArray(groups.coachId, ctx.coachIds)));
  return rows.map((r) => r.id);
}
