import { describe, expect, it } from 'vitest';
import { calculatePayroll, splitProportional, type Rule } from '../src/domain/payroll.js';

const rule = (r: Partial<Rule>): Rule => ({
  id: 'r',
  model: 'fixed_monthly',
  fixedAmount: null,
  percentBp: null,
  perSessionAmount: null,
  validFrom: '2026-01-01',
  validTo: null,
  ...r,
});

describe('payroll engine', () => {
  const period = { periodStart: '2026-11-01', periodEnd: '2026-11-30' };
  const sessions = [
    { date: '2026-11-02', branchId: 'A', groupId: 'g1' },
    { date: '2026-11-04', branchId: 'A', groupId: 'g1' },
    { date: '2026-11-05', branchId: 'B', groupId: 'g2' },
    { date: '2026-11-20', branchId: 'B', groupId: 'g2' },
  ];

  it('fixed monthly: full month, split across branches by lessons held', () => {
    const r = calculatePayroll({ ...period, rules: [rule({ fixedAmount: 3_000_000 })], sessions, revenue: [] });
    expect(r.accrued).toBe(3_000_000);
    expect(r.byBranch).toEqual({ A: 1_500_000, B: 1_500_000 });
  });

  it('fixed monthly: prorated when the rule starts mid-period', () => {
    const r = calculatePayroll({ ...period, rules: [rule({ fixedAmount: 3_000_000, validFrom: '2026-11-16' })], sessions, revenue: [] });
    expect(r.accrued).toBe(1_500_000); // 15 of 30 days
    expect(r.byBranch).toEqual({ B: 1_500_000 }); // only the 20th falls in the window
  });

  it('per session: held lessons × rate, by branch', () => {
    const r = calculatePayroll({ ...period, rules: [rule({ model: 'per_session', perSessionAmount: 100_000 })], sessions, revenue: [] });
    expect(r.accrued).toBe(400_000);
    expect(r.byBranch).toEqual({ A: 200_000, B: 200_000 });
  });

  it('revenue percent: cash net of reversals', () => {
    const revenue = [
      { date: '2026-11-03', branchId: 'A', groupId: 'g1', amount: 400_000 },
      { date: '2026-11-10', branchId: 'B', groupId: 'g2', amount: 600_000 },
      { date: '2026-11-11', branchId: 'B', groupId: 'g2', amount: -100_000 },
    ];
    const r = calculatePayroll({ ...period, rules: [rule({ model: 'revenue_percent', percentBp: 2500 })], sessions: [], revenue });
    expect(r.lines[0].base).toBe(900_000);
    expect(r.accrued).toBe(225_000);
    expect(r.byBranch).toEqual({ A: 100_000, B: 125_000 });
  });

  it('rules outside the period are ignored; several rules add up', () => {
    const r = calculatePayroll({
      ...period,
      rules: [
        rule({ id: 'old', fixedAmount: 1_000_000, validTo: '2026-10-31' }),
        rule({ id: 'fix', fixedAmount: 1_000_000 }),
        rule({ id: 'ps', model: 'per_session', perSessionAmount: 50_000 }),
      ],
      sessions,
      revenue: [],
    });
    expect(r.lines.map((l) => l.ruleId)).toEqual(['fix', 'ps']);
    expect(r.accrued).toBe(1_200_000);
  });

  it('splitProportional keeps integer totals', () => {
    const s = splitProportional(1_000_000, { A: 1, B: 1, C: 1 });
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(1_000_000);
    expect(splitProportional(500, {})).toEqual({ unassigned: 500 });
  });
});
