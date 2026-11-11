/** Expenses (PRD §9). Voided, never deleted. Club-wide expenses (no branch) are owner-only. */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { branches, expenses, users } from '../db/schema.js';
import { assertBranch, requireClub, STAFF } from '../auth/context.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { branchScope, LIST_MAX } from '../lib/scope.js';
import { idParam, isoDate, optText } from '../lib/validation.js';
import { todayInTz } from '../domain/dates.js';

export const EXPENSE_CATEGORIES = ['rent', 'utilities', 'salary', 'equipment', 'marketing', 'repair', 'other'] as const;

export default async function expenseRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const q = z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        branchId: z.uuid().optional(),
        category: z.enum(EXPENSE_CATEGORIES).optional(),
        includeVoided: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);
    return db
      .select({
        id: expenses.id,
        branchId: expenses.branchId,
        branchName: branches.name,
        category: expenses.category,
        amount: expenses.amount,
        incurredAt: expenses.incurredAt,
        note: expenses.note,
        createdByName: users.fullName,
        voidedAt: expenses.voidedAt,
        voidReason: expenses.voidReason,
      })
      .from(expenses)
      .leftJoin(branches, eq(branches.id, expenses.branchId))
      .leftJoin(users, eq(users.id, expenses.createdBy))
      .where(
        and(
          eq(expenses.clubId, ctx.clubId),
          branchScope(ctx, expenses.branchId), // admins never see club-wide (null) rows
          q.branchId ? eq(expenses.branchId, q.branchId) : undefined,
          q.category ? eq(expenses.category, q.category) : undefined,
          q.from ? gte(expenses.incurredAt, q.from) : undefined,
          q.to ? lte(expenses.incurredAt, q.to) : undefined,
          q.includeVoided === 'true' ? undefined : isNull(expenses.voidedAt),
        ),
      )
      .orderBy(desc(expenses.incurredAt), desc(expenses.createdAt))
      .limit(LIST_MAX);
  });

  app.post('/', async (req, reply) => {
    const ctx = requireClub(req, ...STAFF);
    const data = z
      .object({
        branchId: z.uuid().nullable(),
        category: z.enum(EXPENSE_CATEGORIES),
        amount: z.number().int().positive().max(10_000_000_000),
        incurredAt: isoDate.optional(),
        note: optText,
      })
      .parse(req.body);
    if (data.branchId === null && ctx.role !== 'owner') throw forbidden('Club-wide expenses are owner-only');
    if (data.branchId) assertBranch(ctx, data.branchId);
    const row = await db.transaction(async (tx) => {
      if (data.branchId) {
        const [b] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, data.branchId), eq(branches.clubId, ctx.clubId)));
        if (!b) throw badRequest('invalid_branch', 'Unknown branch');
      }
      const [e] = await tx
        .insert(expenses)
        .values({
          ...data,
          clubId: ctx.clubId,
          incurredAt: data.incurredAt ?? todayInTz(ctx.timezone),
          createdBy: ctx.userId,
          paidBy: ctx.userId,
        })
        .returning();
      await audit(tx, ctx, { action: 'create', entity: 'expenses', entityId: e.id, after: e });
      return e;
    });
    return reply.status(201).send(row);
  });

  app.post('/:id/void', async (req) => {
    const ctx = requireClub(req, ...STAFF);
    const { id } = idParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.clubId, ctx.clubId), branchScope(ctx, expenses.branchId)));
      if (!before) throw notFound('Expense');
      if (before.voidedAt) throw badRequest('already_void', 'Expense is already voided');
      if (before.payrollEntryId && ctx.role !== 'owner') throw forbidden('Salary payouts can be voided by the owner only');
      const [after] = await tx.update(expenses).set({ voidedAt: new Date(), voidReason: reason }).where(eq(expenses.id, id)).returning();
      await audit(tx, ctx, { action: 'void', entity: 'expenses', entityId: id, before, after });
      return after;
    });
  });
}
