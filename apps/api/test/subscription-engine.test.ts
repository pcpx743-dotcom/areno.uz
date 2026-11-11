import { describe, it, expect } from 'vitest';
import {
  computePeriod,
  computePrice,
  consumesSession,
  sessionUsageDelta,
  evaluateStatus,
  isValidOn,
  planFreeze,
  remainingSessions,
  daysUntilEnd,
  nextPeriodStart,
  EngineError,
  type EngineSettings,
  type SubscriptionState,
} from '../src/domain/subscription-engine.js';
import { computeBalance, allocatePayment } from '../src/domain/balance.js';
import { ageOn, addDays, daysInclusive } from '../src/domain/dates.js';

const settings: EngineSettings = {
  calendarProration: 'full',
  sessionPackCountsAbsent: false,
  sessionPackCountsExcused: false,
  maxFreezeDays: 30,
  maxFreezesPerSubscription: 2,
};

describe('dates', () => {
  it('handles month ends and leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysInclusive('2026-11-01', '2026-11-30')).toBe(30);
    expect(ageOn('2014-11-05', '2026-11-04')).toBe(11);
    expect(ageOn('2014-11-04', '2026-11-04')).toBe(12);
  });
});

describe('calendar_month model', () => {
  const plan = { billingType: 'calendar_month' as const, price: 400_000 };

  it('period is the calendar month of the start date', () => {
    expect(computePeriod(plan, '2026-11-01')).toEqual({ startDate: '2026-11-01', endDate: '2026-11-30' });
    expect(computePeriod(plan, '2026-02-10')).toEqual({ startDate: '2026-02-10', endDate: '2026-02-28' });
  });

  it('full price when proration = full (default)', () => {
    const r = computePrice({ plan, startDate: '2026-11-16', settings });
    expect(r).toMatchObject({ price: 400_000, prorated: false });
  });

  it('daily proration when enabled: 15 of 30 days → half price', () => {
    const r = computePrice({ plan, startDate: '2026-11-16', settings: { calendarProration: 'daily' } });
    expect(r).toMatchObject({ basePrice: 200_000, price: 200_000, prorated: true });
  });

  it('no proration when starting on the 1st', () => {
    const r = computePrice({ plan, startDate: '2026-11-01', settings: { calendarProration: 'daily' } });
    expect(r).toMatchObject({ price: 400_000, prorated: false });
  });

  it('proration rounds to 1 000 so‘m', () => {
    // 31-day month, start on the 21st → 11/31 × 350 000 = 124 193.5 → 124 000
    const r = computePrice({
      plan: { billingType: 'calendar_month', price: 350_000 },
      startDate: '2026-12-21',
      settings: { calendarProration: 'daily' },
    });
    expect(r.price).toBe(124_000);
  });
});

describe('fixed_days (30-day) model', () => {
  const plan = { billingType: 'fixed_days' as const, price: 450_000, durationDays: 30 };

  it('30 calendar days including the start date', () => {
    expect(computePeriod(plan, '2026-11-15')).toEqual({ startDate: '2026-11-15', endDate: '2026-12-14' });
  });

  it('defaults to 30 days', () => {
    expect(computePeriod({ billingType: 'fixed_days', price: 1 }, '2026-01-31').endDate).toBe('2026-03-01');
  });

  it('never prorated', () => {
    expect(computePrice({ plan, startDate: '2026-11-15', settings: { calendarProration: 'daily' } }).price).toBe(450_000);
  });

  it('expires the day after end date', () => {
    const sub: SubscriptionState = {
      billingType: 'fixed_days',
      status: 'active',
      startDate: '2026-11-15',
      endDate: '2026-12-14',
      sessionLimit: null,
      usedSessions: 0,
    };
    expect(evaluateStatus(sub, '2026-12-14')).toBe('active');
    expect(evaluateStatus(sub, '2026-12-15')).toBe('expired');
    expect(daysUntilEnd(sub, '2026-12-11')).toBe(3);
  });
});

describe('session_pack (12 lessons) model', () => {
  const plan = { billingType: 'session_pack' as const, price: 350_000, sessionLimit: 12, maxValidityDays: 45 };
  const base: SubscriptionState = {
    billingType: 'session_pack',
    status: 'active',
    startDate: '2026-11-01',
    endDate: '2026-12-15',
    sessionLimit: 12,
    usedSessions: 0,
  };

  it('max validity sets the end date; without it the pack is open-ended', () => {
    expect(computePeriod(plan, '2026-11-01').endDate).toBe('2026-12-15');
    expect(computePeriod({ ...plan, maxValidityDays: null }, '2026-11-01').endDate).toBeNull();
  });

  it('requires a session limit', () => {
    expect(() => computePeriod({ billingType: 'session_pack', price: 1 }, '2026-11-01')).toThrow(EngineError);
  });

  it('present always consumes; absent/excused follow club settings', () => {
    expect(consumesSession('present', settings)).toBe(true);
    expect(consumesSession('absent', settings)).toBe(false);
    expect(consumesSession('absent', { ...settings, sessionPackCountsAbsent: true })).toBe(true);
    expect(consumesSession('excused', { ...settings, sessionPackCountsExcused: true })).toBe(true);
  });

  it('editing attendance adjusts usage without double counting', () => {
    expect(sessionUsageDelta(null, 'present', settings)).toBe(1);
    expect(sessionUsageDelta('present', 'present', settings)).toBe(0);
    expect(sessionUsageDelta('present', 'absent', settings)).toBe(-1);
    expect(sessionUsageDelta('absent', 'present', settings)).toBe(1);
    expect(sessionUsageDelta('absent', 'excused', settings)).toBe(0);
  });

  it('12 attended lessons exhaust the pack', () => {
    let used = 0;
    for (let i = 0; i < 12; i++) used += sessionUsageDelta(null, 'present', settings);
    const sub = { ...base, usedSessions: used };
    expect(remainingSessions(sub)).toBe(0);
    expect(isValidOn(sub, '2026-11-20')).toBe(false);
    expect(evaluateStatus(sub, '2026-11-20')).toBe('expired');
    expect(evaluateStatus({ ...base, usedSessions: 11 }, '2026-11-20')).toBe('active');
  });

  it('expires by max validity even with lessons left', () => {
    expect(evaluateStatus({ ...base, usedSessions: 3 }, '2026-12-16')).toBe('expired');
  });
});

describe('discounts and individual price', () => {
  const plan = { billingType: 'fixed_days' as const, price: 450_000 };
  it('applies individual price then discount', () => {
    const r = computePrice({ plan, startDate: '2026-11-01', individualPrice: 400_000, discount: 50_000, settings });
    expect(r).toMatchObject({ listPrice: 400_000, discount: 50_000, price: 350_000 });
  });
  it('rejects discount above price and non-integer money', () => {
    expect(() => computePrice({ plan, startDate: '2026-11-01', discount: 500_000, settings })).toThrow(EngineError);
    expect(() => computePrice({ plan, startDate: '2026-11-01', discount: 10.5, settings })).toThrow(EngineError);
  });
});

describe('freeze', () => {
  const sub = {
    billingType: 'fixed_days' as const,
    status: 'active' as const,
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    sessionLimit: null,
    usedSessions: 0,
    freezeCount: 0,
    frozenDays: 0,
  };
  it('extends end date by frozen days', () => {
    const r = planFreeze({ sub, fromDate: '2026-11-10', toDate: '2026-11-16', settings });
    expect(r).toEqual({ days: 7, newEndDate: '2026-12-07', freezeCount: 1, frozenDays: 7 });
  });
  it('enforces day and count limits', () => {
    expect(() => planFreeze({ sub, fromDate: '2026-11-01', toDate: '2026-12-15', settings })).toThrow(/frozen days/);
    expect(() => planFreeze({ sub: { ...sub, freezeCount: 2 }, fromDate: '2026-11-10', toDate: '2026-11-11', settings })).toThrow(
      /freezes/,
    );
  });
  it('rejects freezing non-active subscriptions', () => {
    expect(() => planFreeze({ sub: { ...sub, status: 'expired' as never }, fromDate: '2026-11-10', toDate: '2026-11-11', settings })).toThrow(
      EngineError,
    );
  });
});

describe('renewal', () => {
  it('next period starts the day after end, never in the past', () => {
    expect(nextPeriodStart({ endDate: '2026-11-30' }, '2026-11-28')).toBe('2026-12-01');
    expect(nextPeriodStart({ endDate: '2026-11-30' }, '2026-12-05')).toBe('2026-12-05');
  });
});

describe('balance (PRD §6, §14)', () => {
  it('400 000 charge − 150 000 payment = 250 000 debt', () => {
    const b = computeBalance({ charges: [{ amount: 400_000 }], payments: [{ amount: 150_000 }], adjustments: [] });
    expect(b.balance).toBe(250_000);
    expect(b.debt).toBe(250_000);
  });
  it('reversal restores debt; overpayment becomes advance; void charges ignored', () => {
    const b1 = computeBalance({
      charges: [{ amount: 400_000 }],
      payments: [{ amount: 150_000 }, { amount: -150_000 }],
      adjustments: [],
    });
    expect(b1.debt).toBe(400_000);
    const b2 = computeBalance({
      charges: [{ amount: 400_000 }, { amount: 100_000, status: 'void' }],
      payments: [{ amount: 450_000 }],
      adjustments: [],
    });
    expect(b2).toMatchObject({ debt: 0, advance: 50_000 });
  });
  it('allocates oldest-due first and keeps remainder as advance', () => {
    const r = allocatePayment(500_000, [
      { id: 'b', dueDate: '2026-12-01', amount: 400_000, paidAmount: 0 },
      { id: 'a', dueDate: '2026-11-01', amount: 400_000, paidAmount: 300_000 },
    ]);
    expect(r.allocations).toEqual([
      { chargeId: 'a', amount: 100_000 },
      { chargeId: 'b', amount: 400_000 },
    ]);
    expect(r.remainder).toBe(0);
    expect(allocatePayment(50_000, []).remainder).toBe(50_000);
  });
});
