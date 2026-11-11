/**
 * Subscription engine (PRD §5) — pure functions, no DB access.
 *
 * Three billing models:
 *   calendar_month — fixed billing period = the calendar month of the start date (e.g. 1–30 Nov).
 *   fixed_days     — N calendar days from the start date (default 30), end date shown explicitly.
 *   session_pack   — N lessons; attended lessons are deducted; optional max validity in days.
 *
 * Rules still marked "TASDIQLASH KERAK" in the PRD are driven by `EngineSettings`
 * so they can be switched per club once the pilot confirms them.
 */
import {
  addDays,
  compareIso,
  daysInclusive,
  daysInMonth,
  endOfMonth,
  type IsoDate,
} from './dates.js';

export type BillingType = 'calendar_month' | 'fixed_days' | 'session_pack';
export type SubscriptionStatus = 'draft' | 'active' | 'frozen' | 'expired' | 'cancelled';
export type AttendanceStatus = 'present' | 'absent' | 'excused';

export interface EngineSettings {
  calendarProration: 'full' | 'daily';
  sessionPackCountsAbsent: boolean;
  sessionPackCountsExcused: boolean;
  maxFreezeDays: number;
  maxFreezesPerSubscription: number;
}

export interface PlanTerms {
  billingType: BillingType;
  price: number; // integer UZS
  durationDays?: number | null;
  sessionLimit?: number | null;
  maxValidityDays?: number | null;
}

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const DEFAULT_FIXED_DAYS = 30;

// ---------- period ----------

export interface Period {
  startDate: IsoDate;
  endDate: IsoDate | null; // null = open-ended (session pack without max validity)
}

export function computePeriod(plan: PlanTerms, startDate: IsoDate): Period {
  switch (plan.billingType) {
    case 'calendar_month':
      return { startDate, endDate: endOfMonth(startDate) };
    case 'fixed_days': {
      const days = plan.durationDays ?? DEFAULT_FIXED_DAYS;
      if (!Number.isInteger(days) || days < 1) throw new EngineError('invalid_plan', 'durationDays must be ≥ 1');
      return { startDate, endDate: addDays(startDate, days - 1) };
    }
    case 'session_pack': {
      if (!plan.sessionLimit || plan.sessionLimit < 1) {
        throw new EngineError('invalid_plan', 'sessionLimit must be ≥ 1 for session_pack');
      }
      const v = plan.maxValidityDays;
      return { startDate, endDate: v ? addDays(startDate, v - 1) : null };
    }
  }
}

// ---------- price ----------

export interface PriceInput {
  plan: PlanTerms;
  startDate: IsoDate;
  /** Individual price override (replaces the plan's list price). */
  individualPrice?: number | null;
  /** Absolute discount in UZS. */
  discount?: number | null;
  settings: Pick<EngineSettings, 'calendarProration'>;
}

export interface PriceResult {
  listPrice: number;
  prorated: boolean;
  /** Price after proration, before discount. */
  basePrice: number;
  discount: number;
  /** Amount to charge. */
  price: number;
}

/** Proration rounds to the nearest 1 000 so'm so cash amounts stay practical. */
export function roundUzs(amount: number): number {
  return Math.round(amount / 1000) * 1000;
}

export function computePrice(input: PriceInput): PriceResult {
  const listPrice = input.individualPrice ?? input.plan.price;
  assertMoney(listPrice, 'price');
  let basePrice = listPrice;
  let prorated = false;

  if (input.plan.billingType === 'calendar_month' && input.settings.calendarProration === 'daily') {
    const total = daysInMonth(input.startDate);
    const remaining = daysInclusive(input.startDate, endOfMonth(input.startDate));
    if (remaining < total) {
      basePrice = roundUzs((listPrice * remaining) / total);
      prorated = true;
    }
  }

  const discount = input.discount ?? 0;
  assertMoney(discount, 'discount');
  if (discount > basePrice) throw new EngineError('invalid_discount', 'Discount exceeds price');

  return { listPrice, prorated, basePrice, discount, price: basePrice - discount };
}

function assertMoney(v: number, field: string) {
  if (!Number.isSafeInteger(v) || v < 0) throw new EngineError('invalid_amount', `${field} must be a non-negative integer (UZS)`);
}

// ---------- session consumption ----------

export function consumesSession(status: AttendanceStatus, s: Pick<EngineSettings, 'sessionPackCountsAbsent' | 'sessionPackCountsExcused'>): boolean {
  switch (status) {
    case 'present':
      return true;
    case 'absent':
      return s.sessionPackCountsAbsent;
    case 'excused':
      return s.sessionPackCountsExcused;
  }
}

/**
 * Change to `used_sessions` when an attendance mark is created or edited.
 * prev = null means first mark. Returns −1, 0 or +1.
 */
export function sessionUsageDelta(
  prev: AttendanceStatus | null,
  next: AttendanceStatus,
  s: Pick<EngineSettings, 'sessionPackCountsAbsent' | 'sessionPackCountsExcused'>,
): number {
  const before = prev ? (consumesSession(prev, s) ? 1 : 0) : 0;
  const after = consumesSession(next, s) ? 1 : 0;
  return after - before;
}

// ---------- status lifecycle ----------

export interface SubscriptionState {
  billingType: BillingType;
  status: SubscriptionStatus;
  startDate: IsoDate;
  endDate: IsoDate | null;
  sessionLimit: number | null;
  usedSessions: number;
}

export function remainingSessions(sub: Pick<SubscriptionState, 'billingType' | 'sessionLimit' | 'usedSessions'>): number | null {
  if (sub.billingType !== 'session_pack' || sub.sessionLimit == null) return null;
  return Math.max(0, sub.sessionLimit - sub.usedSessions);
}

/**
 * Status the subscription should have on `today` (daily job, PRD §13C).
 * Only active subscriptions transition automatically; frozen/cancelled/draft are left as-is.
 */
export function evaluateStatus(sub: SubscriptionState, today: IsoDate): SubscriptionStatus {
  if (sub.status !== 'active') return sub.status;
  if (sub.endDate && compareIso(today, sub.endDate) > 0) return 'expired';
  if (sub.billingType === 'session_pack' && sub.sessionLimit != null && sub.usedSessions >= sub.sessionLimit) {
    return 'expired';
  }
  return 'active';
}

/** Is the subscription usable for a lesson on `date`? */
export function isValidOn(sub: SubscriptionState, date: IsoDate): boolean {
  if (sub.status !== 'active') return false;
  if (compareIso(date, sub.startDate) < 0) return false;
  if (sub.endDate && compareIso(date, sub.endDate) > 0) return false;
  const rem = remainingSessions(sub);
  return rem === null || rem > 0;
}

/** Days until end date (0 = ends today, negative = already past). null if open-ended. */
export function daysUntilEnd(sub: Pick<SubscriptionState, 'endDate'>, today: IsoDate): number | null {
  if (!sub.endDate) return null;
  return daysInclusive(today, sub.endDate) - 1;
}

// ---------- freeze ----------

export interface FreezeInput {
  sub: SubscriptionState & { freezeCount: number; frozenDays: number };
  fromDate: IsoDate;
  toDate: IsoDate;
  settings: Pick<EngineSettings, 'maxFreezeDays' | 'maxFreezesPerSubscription'>;
}

export interface FreezeResult {
  days: number;
  newEndDate: IsoDate | null;
  freezeCount: number;
  frozenDays: number;
}

/**
 * Freezing extends the end date by the number of frozen days.
 * Limits (max days total, max count) are club settings — TASDIQLASH KERAK.
 */
export function planFreeze({ sub, fromDate, toDate, settings }: FreezeInput): FreezeResult {
  if (sub.status !== 'active') throw new EngineError('invalid_state', 'Only active subscriptions can be frozen');
  if (compareIso(toDate, fromDate) < 0) throw new EngineError('invalid_range', 'toDate is before fromDate');
  if (compareIso(fromDate, sub.startDate) < 0) throw new EngineError('invalid_range', 'Freeze starts before subscription');
  if (sub.endDate && compareIso(fromDate, sub.endDate) > 0) throw new EngineError('invalid_range', 'Freeze starts after subscription end');
  if (sub.freezeCount >= settings.maxFreezesPerSubscription) {
    throw new EngineError('freeze_limit', `Max ${settings.maxFreezesPerSubscription} freezes per subscription`);
  }
  const days = daysInclusive(fromDate, toDate);
  if (sub.frozenDays + days > settings.maxFreezeDays) {
    throw new EngineError('freeze_limit', `Max ${settings.maxFreezeDays} frozen days per subscription`);
  }
  return {
    days,
    newEndDate: sub.endDate ? addDays(sub.endDate, days) : null,
    freezeCount: sub.freezeCount + 1,
    frozenDays: sub.frozenDays + days,
  };
}

// ---------- renewal ----------

/** Start date of the next period when renewing (PRD §13C, only if club enables autoRenew). */
export function nextPeriodStart(sub: Pick<SubscriptionState, 'endDate'>, today: IsoDate): IsoDate {
  if (!sub.endDate) return today;
  const next = addDays(sub.endDate, 1);
  return compareIso(next, today) < 0 ? today : next;
}
