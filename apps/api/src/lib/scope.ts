import { getTableName, inArray, sql, type SQL, type Column } from 'drizzle-orm';
import type { ClubCtx } from '../auth/context.js';

/** SQL condition restricting `column` (a branch_id column) to the user's branch scope. */
export function branchScope(ctx: ClubCtx, column: Column): SQL | undefined {
  if (ctx.branchIds === null) return undefined;
  if (ctx.branchIds.length === 0) return sql`false`;
  return inArray(column, ctx.branchIds);
}

export function idsOrNone(column: Column, ids: string[]): SQL {
  return ids.length ? inArray(column, ids) : sql`false`;
}

/** Upper bound for lists the web app pages through in the browser (filters & totals need every row). */
export const LIST_MAX = 5000;

export function page(q: { limit?: unknown; offset?: unknown }, max = 200) {
  return {
    limit: Math.min(max, Math.max(1, Number(q.limit) || 50)),
    offset: Math.max(0, Number(q.offset) || 0),
  };
}

/**
 * Fully-qualified column reference ("table"."column") for correlated subqueries.
 * Drizzle renders columns unqualified in single-table selects, which inside a
 * subquery would silently bind to the inner table.
 */
export function qcol(column: Column): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
