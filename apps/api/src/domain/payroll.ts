/**
 * Coach payroll calculation (PRD §8) — pure functions.
 * Models: fixed_monthly, revenue_percent (of actual cash received), per_session (held lessons × rate).
 * The total is split across branches: per_session / percent by where the work/revenue happened,
 * fixed by the share of lessons held in each branch.
 */
import { compareIso, daysInclusive, type IsoDate } from './dates.js';
import { roundUzs } from './subscription-engine.js';

export interface Rule {
  id: string;
  model: 'fixed_monthly' | 'revenue_percent' | 'per_session';
  fixedAmount: number | null;
  percentBp: number | null; // 2500 = 25 %
  perSessionAmount: number | null;
  validFrom: IsoDate;
  validTo: IsoDate | null;
}

export interface HeldSession {
  date: IsoDate;
  branchId: string;
  groupId: string;
}

export interface RevenueItem {
  date: IsoDate; // payment date (club tz)
  branchId: string;
  groupId: string;
  amount: number; // already split for this coach; reversals negative
}

export interface PayrollLine {
  ruleId: string;
  model: Rule['model'];
  base: number; // sessions count, revenue sum, or prorated days
  amount: number;
  byBranch: Record<string, number>;
}

export interface PayrollResult {
  accrued: number;
  lines: PayrollLine[];
  byBranch: Record<string, number>;
}

function overlap(rule: Rule, start: IsoDate, end: IsoDate): [IsoDate, IsoDate] | null {
  const from = compareIso(rule.validFrom, start) > 0 ? rule.validFrom : start;
  const to = rule.validTo && compareIso(rule.validTo, end) < 0 ? rule.validTo : end;
  return compareIso(from, to) > 0 ? null : [from, to];
}

const inRange = (d: IsoDate, [a, b]: [IsoDate, IsoDate]) => compareIso(d, a) >= 0 && compareIso(d, b) <= 0;

function add(map: Record<string, number>, k: string, v: number) {
  map[k] = (map[k] ?? 0) + v;
}

/** Split `amount` proportionally to `weights` (integer UZS, remainder to the largest share). */
export function splitProportional(amount: number, weights: Record<string, number>): Record<string, number> {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  const total = keys.reduce((a, k) => a + weights[k], 0);
  if (!total) return amount ? { unassigned: amount } : {};
  const out: Record<string, number> = {};
  let used = 0;
  for (const k of keys) {
    out[k] = Math.floor((amount * weights[k]) / total);
    used += out[k];
  }
  const biggest = keys.reduce((a, k) => (weights[k] > weights[a] ? k : a), keys[0]);
  out[biggest] += amount - used;
  return out;
}

export function calculatePayroll(input: {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  rules: Rule[];
  sessions: HeldSession[];
  revenue: RevenueItem[];
}): PayrollResult {
  const { periodStart, periodEnd } = input;
  const periodDays = daysInclusive(periodStart, periodEnd);
  const lines: PayrollLine[] = [];

  for (const rule of input.rules) {
    const win = overlap(rule, periodStart, periodEnd);
    if (!win) continue;
    const sess = input.sessions.filter((s) => inRange(s.date, win));
    const sessionsByBranch: Record<string, number> = {};
    for (const s of sess) add(sessionsByBranch, s.branchId, 1);

    if (rule.model === 'fixed_monthly') {
      const days = daysInclusive(win[0], win[1]);
      const amount = roundUzs(((rule.fixedAmount ?? 0) * days) / periodDays);
      lines.push({ ruleId: rule.id, model: rule.model, base: days, amount, byBranch: splitProportional(amount, sessionsByBranch) });
    } else if (rule.model === 'per_session') {
      const rate = rule.perSessionAmount ?? 0;
      const byBranch: Record<string, number> = {};
      for (const [b, n] of Object.entries(sessionsByBranch)) byBranch[b] = n * rate;
      lines.push({ ruleId: rule.id, model: rule.model, base: sess.length, amount: sess.length * rate, byBranch });
    } else {
      const items = input.revenue.filter((r) => inRange(r.date, win));
      const revByBranch: Record<string, number> = {};
      for (const r of items) add(revByBranch, r.branchId, r.amount);
      const base = items.reduce((a, r) => a + r.amount, 0);
      const amount = Math.max(0, Math.round((base * (rule.percentBp ?? 0)) / 10_000));
      lines.push({ ruleId: rule.id, model: rule.model, base, amount, byBranch: splitProportional(amount, revByBranch) });
    }
  }

  const byBranch: Record<string, number> = {};
  for (const l of lines) for (const [b, v] of Object.entries(l.byBranch)) add(byBranch, b, v);
  return { accrued: lines.reduce((a, l) => a + l.amount, 0), lines, byBranch };
}
