/**
 * SPORT ERP — database schema (PRD §3).
 *
 * Conventions:
 *  - Every tenant-owned row carries `club_id`; all queries are scoped by it on the server.
 *  - Money is stored as integer UZS (bigint, number mode — safe up to 2^53).
 *  - Timestamps are UTC (timestamptz); calendar dates are `date` (YYYY-MM-DD strings).
 */
import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  date,
  time,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
  customType,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const clubId = () =>
  uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' });
const money = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------- enums ----------
export const clubStatus = pgEnum('club_status', ['active', 'suspended', 'archived']);
export const role = pgEnum('role', ['owner', 'branch_admin', 'coach', 'guardian']);
export const membershipStatus = pgEnum('membership_status', ['active', 'disabled']);
export const athleteStatus = pgEnum('athlete_status', ['active', 'paused', 'archived']);
export const enrollmentStatus = pgEnum('enrollment_status', ['active', 'paused', 'ended']);
export const billingType = pgEnum('billing_type', ['calendar_month', 'fixed_days', 'session_pack']);
export const planKind = pgEnum('plan_kind', ['group', 'single', 'individual']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'draft',
  'active',
  'frozen',
  'expired',
  'cancelled',
]);
export const chargeStatus = pgEnum('charge_status', ['open', 'partially_paid', 'paid', 'void']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'click_payme', 'terminal']);
export const sessionStatus = pgEnum('session_status', ['scheduled', 'held', 'cancelled']);
export const attendanceStatus = pgEnum('attendance_status', ['present', 'absent', 'excused']);
export const expenseCategory = pgEnum('expense_category', [
  'rent',
  'utilities',
  'salary',
  'equipment',
  'marketing',
  'repair',
  'other',
]);
export const compensationModel = pgEnum('compensation_model', ['fixed_monthly', 'revenue_percent', 'per_session']);
export const notificationStatus = pgEnum('notification_status', ['queued', 'sent', 'failed', 'skipped']);

// ---------- platform / tenancy ----------
export type ClubSettings = {
  /** What to do when a group is at capacity. */
  capacityPolicy: 'warn' | 'block';
  /** Calendar-month plan joined mid-month. TASDIQLASH KERAK (PRD §5, §16). */
  calendarProration: 'full' | 'daily';
  /** Session-pack: does "absent" consume a lesson? TASDIQLASH KERAK. */
  sessionPackCountsAbsent: boolean;
  /** Session-pack: does "excused" consume a lesson? TASDIQLASH KERAK. */
  sessionPackCountsExcused: boolean;
  /** Freeze limits. TASDIQLASH KERAK. */
  maxFreezeDays: number;
  maxFreezesPerSubscription: number;
  /** Create the next period's charge automatically on expiry (PRD §13C). */
  autoRenew: boolean;
  /** Debtor entering class: warn only or block. */
  debtorPolicy: 'warn' | 'block';
  /** Telegram attendance message to parents. */
  attendanceNotify: 'all' | 'absent_only' | 'off';
};

/** Defaults = decisions in docs/open-questions.md. */
export const DEFAULT_CLUB_SETTINGS: ClubSettings = {
  capacityPolicy: 'warn',
  calendarProration: 'daily',
  sessionPackCountsAbsent: true,
  sessionPackCountsExcused: false,
  maxFreezeDays: 30,
  maxFreezesPerSubscription: 2,
  autoRenew: true,
  debtorPolicy: 'warn',
  attendanceNotify: 'absent_only',
};

export const clubs = pgTable('clubs', {
  id: id(),
  name: text('name').notNull(),
  status: clubStatus('status').notNull().default('active'),
  timezone: text('timezone').notNull().default('Asia/Tashkent'),
  /** Club logo (URL or path served by the web app). Shown in the app header. */
  logoUrl: text('logo_url'),
  settings: jsonb('settings').$type<ClubSettings>().notNull().default(DEFAULT_CLUB_SETTINGS),
  /** Receipt number counter (atomic increment per payment). */
  receiptSeq: integer('receipt_seq').notNull().default(0),
  createdAt: createdAt(),
});

export const branches = pgTable(
  'branches',
  {
    id: id(),
    clubId: clubId(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('branches_club_idx').on(t.clubId)],
);

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  isSuperadmin: boolean('is_superadmin').notNull().default(false),
  createdAt: createdAt(),
});

/** A user's role inside one club. `branchIds` empty = all branches (owner). */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clubId: clubId(),
    role: role('role').notNull(),
    branchIds: uuid('branch_ids').array().notNull().default(sql`'{}'::uuid[]`),
    status: membershipStatus('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('memberships_user_club_role_uq').on(t.userId, t.clubId, t.role)],
);

// ---------- sports, coaches, groups ----------
export const sports = pgTable(
  'sports',
  {
    id: id(),
    clubId: clubId(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sports_club_name_uq').on(t.clubId, t.name)],
);

export const coaches = pgTable(
  'coaches',
  {
    id: id(),
    clubId: clubId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    employment: text('employment'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('coaches_club_idx').on(t.clubId), index('coaches_user_idx').on(t.userId)],
);

/** Coach pay rule with validity period (PRD §8). Calculation lands in phase 4. */
export const coachCompensationRules = pgTable('coach_compensation_rules', {
  id: id(),
  clubId: clubId(),
  coachId: uuid('coach_id')
    .notNull()
    .references(() => coaches.id, { onDelete: 'cascade' }),
  model: compensationModel('model').notNull(),
  fixedAmount: money('fixed_amount'),
  percentBp: integer('percent_bp'), // basis points: 2500 = 25%
  perSessionAmount: money('per_session_amount'),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  createdAt: createdAt(),
});

export const groups = pgTable(
  'groups',
  {
    id: id(),
    clubId: clubId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    sportId: uuid('sport_id')
      .notNull()
      .references(() => sports.id),
    coachId: uuid('coach_id').references(() => coaches.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    capacity: integer('capacity'),
    ageMin: integer('age_min'),
    ageMax: integer('age_max'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('groups_club_branch_idx').on(t.clubId, t.branchId), index('groups_coach_idx').on(t.coachId)],
);

export const schedules = pgTable(
  'schedules',
  {
    id: id(),
    clubId: clubId(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(), // 1 = Monday … 7 = Sunday (ISO)
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    room: text('room'),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
  },
  (t) => [check('schedules_weekday_ck', sql`${t.weekday} between 1 and 7`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    clubId: clubId(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    coachId: uuid('coach_id').references(() => coaches.id, { onDelete: 'set null' }),
    sessionDate: date('session_date').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    room: text('room'),
    status: sessionStatus('status').notNull().default('scheduled'),
    note: text('note'),
  },
  (t) => [
    index('sessions_group_date_idx').on(t.groupId, t.sessionDate),
    uniqueIndex('sessions_group_date_time_uq').on(t.groupId, t.sessionDate, t.startTime),
  ],
);

// ---------- athletes & guardians ----------
export const athletes = pgTable(
  'athletes',
  {
    id: id(),
    clubId: clubId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    fullName: text('full_name').notNull(),
    birthDate: date('birth_date'),
    phone: text('phone'),
    status: athleteStatus('status').notNull().default('active'),
    joinedAt: date('joined_at').notNull().default(sql`current_date`),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('athletes_club_branch_idx').on(t.clubId, t.branchId)],
);

export const guardians = pgTable(
  'guardians',
  {
    id: id(),
    clubId: clubId(),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    telegramChatId: text('telegram_chat_id'),
    telegramConsentAt: timestamp('telegram_consent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  // One phone = one guardian per club; that guardian may have several children.
  (t) => [uniqueIndex('guardians_club_phone_uq').on(t.clubId, t.phone)],
);

export const athleteGuardians = pgTable(
  'athlete_guardians',
  {
    clubId: clubId(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    guardianId: uuid('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    relation: text('relation').notNull().default('parent'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.athleteId, t.guardianId] })],
);

/** Group membership with history: add / move / pause / end (PRD §4). */
export const groupEnrollments = pgTable(
  'group_enrollments',
  {
    id: id(),
    clubId: clubId(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    status: enrollmentStatus('status').notNull().default('active'),
    startedAt: date('started_at').notNull(),
    endedAt: date('ended_at'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('enrollments_group_idx').on(t.groupId, t.status),
    index('enrollments_athlete_idx').on(t.athleteId),
    // at most one open (non-ended) enrollment of an athlete in a group
    uniqueIndex('enrollments_open_uq').on(t.athleteId, t.groupId).where(sql`${t.status} <> 'ended'`),
  ],
);

// ---------- billing ----------
export const plans = pgTable(
  'plans',
  {
    id: id(),
    clubId: clubId(),
    sportId: uuid('sport_id').references(() => sports.id),
    name: text('name').notNull(),
    kind: planKind('kind').notNull().default('group'),
    billingType: billingType('billing_type').notNull(),
    price: money('price').notNull(),
    /** fixed_days: period length (default 30). */
    durationDays: integer('duration_days'),
    /** session_pack: number of lessons. */
    sessionLimit: integer('session_limit'),
    /** session_pack: max validity in days (club setting per plan). */
    maxValidityDays: integer('max_validity_days'),
    /** Empty = valid in all branches. */
    branchIds: uuid('branch_ids').array().notNull().default(sql`'{}'::uuid[]`),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('plans_club_idx').on(t.clubId), check('plans_price_ck', sql`${t.price} >= 0`)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    clubId: clubId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    billingType: billingType('billing_type').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    listPrice: money('list_price').notNull(),
    discount: money('discount').notNull().default(0),
    discountReason: text('discount_reason'),
    /** Final price after proration and discount. */
    price: money('price').notNull(),
    sessionLimit: integer('session_limit'),
    usedSessions: integer('used_sessions').notNull().default(0),
    freezeCount: integer('freeze_count').notNull().default(0),
    frozenDays: integer('frozen_days').notNull().default(0),
    status: subscriptionStatus('status').notNull().default('active'),
    renewedFromId: uuid('renewed_from_id').references((): AnyPgColumn => subscriptions.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('subscriptions_club_athlete_idx').on(t.clubId, t.athleteId),
    index('subscriptions_club_end_idx').on(t.clubId, t.endDate),
  ],
);

export const subscriptionFreezes = pgTable('subscription_freezes', {
  id: id(),
  clubId: clubId(),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});

/** Obligation (hisob). Balance = Σ charges − Σ payments − Σ adjustments. */
export const charges = pgTable(
  'charges',
  {
    id: id(),
    clubId: clubId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
    description: text('description').notNull(),
    dueDate: date('due_date').notNull(),
    amount: money('amount').notNull(),
    paidAmount: money('paid_amount').notNull().default(0),
    status: chargeStatus('status').notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [
    index('charges_club_due_idx').on(t.clubId, t.dueDate),
    index('charges_club_branch_idx').on(t.clubId, t.branchId),
    index('charges_athlete_idx').on(t.athleteId),
    check('charges_amount_ck', sql`${t.amount} >= 0`),
  ],
);

/** Cash payments. Never deleted: a reversal (storno) is a new row with negative amount. */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    clubId: clubId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    method: paymentMethod('method').notNull().default('cash'),
    amount: money('amount').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    receivedBy: uuid('received_by').references(() => users.id),
    receiptNo: text('receipt_no'),
    note: text('note'),
    idempotencyKey: text('idempotency_key'),
    reversalOfId: uuid('reversal_of_id').references((): AnyPgColumn => payments.id),
    reversalReason: text('reversal_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('payments_idempotency_uq').on(t.clubId, t.idempotencyKey),
    uniqueIndex('payments_reversal_uq').on(t.reversalOfId),
    index('payments_club_branch_paid_idx').on(t.clubId, t.branchId, t.paidAt),
  ],
);

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    chargeId: uuid('charge_id')
      .notNull()
      .references(() => charges.id, { onDelete: 'cascade' }),
    amount: money('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.paymentId, t.chargeId] })],
);

/** Approved discounts / corrections that reduce the balance. */
export const balanceAdjustments = pgTable('balance_adjustments', {
  id: id(),
  clubId: clubId(),
  athleteId: uuid('athlete_id')
    .notNull()
    .references(() => athletes.id, { onDelete: 'cascade' }),
  chargeId: uuid('charge_id').references(() => charges.id),
  amount: money('amount').notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});

// ---------- operations ----------
export const attendance = pgTable(
  'attendance',
  {
    id: id(),
    clubId: clubId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    status: attendanceStatus('status').notNull(),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
    markedBy: uuid('marked_by').references(() => users.id),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  // PRD §7: one final record per athlete per session, enforced by the DB.
  (t) => [uniqueIndex('attendance_session_athlete_uq').on(t.sessionId, t.athleteId)],
);

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    clubId: clubId(),
    branchId: uuid('branch_id').references(() => branches.id), // null = club-wide
    category: expenseCategory('category').notNull(),
    amount: money('amount').notNull(),
    incurredAt: date('incurred_at').notNull(),
    note: text('note'),
    fileKey: text('file_key'),
    paidBy: uuid('paid_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    /** Expenses are voided, never deleted. */
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    payrollEntryId: uuid('payroll_entry_id'),
    createdAt: createdAt(),
  },
  (t) => [index('expenses_club_branch_idx').on(t.clubId, t.branchId, t.incurredAt)],
);

export const payrollEntries = pgTable('payroll_entries', {
  id: id(),
  clubId: clubId(),
  coachId: uuid('coach_id')
    .notNull()
    .references(() => coaches.id, { onDelete: 'cascade' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  accrued: money('accrued').notNull().default(0),
  bonus: money('bonus').notNull().default(0),
  deduction: money('deduction').notNull().default(0),
  paid: money('paid').notNull().default(0),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  correctionOfId: uuid('correction_of_id').references((): AnyPgColumn => payrollEntries.id),
  /** Calculation breakdown: per rule, per group, per branch. */
  details: jsonb('details'),
  note: text('note'),
  createdAt: createdAt(),
});

/** End-of-day cash closing per branch (PRD §6, §13D). */
export const cashClosings = pgTable(
  'cash_closings',
  {
    id: id(),
    clubId: clubId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    date: date('date').notNull(),
    expectedAmount: money('expected_amount').notNull(),
    countedAmount: money('counted_amount').notNull(),
    difference: money('difference').notNull(),
    note: text('note'),
    closedBy: uuid('closed_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('cash_closings_branch_date_uq').on(t.branchId, t.date)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    clubId: clubId(),
    guardianId: uuid('guardian_id').references(() => guardians.id, { onDelete: 'cascade' }),
    template: text('template').notNull(),
    payload: jsonb('payload').notNull(),
    /** Dedupe key, e.g. `payment_received:<paymentId>`. */
    dedupeKey: text('dedupe_key').notNull(),
    status: notificationStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Retry backoff: not delivered before this time. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('notifications_dedupe_uq').on(t.clubId, t.dedupeKey), index('notifications_queue_idx').on(t.status, t.nextAttemptAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_club_entity_idx').on(t.clubId, t.entity, t.entityId)],
);

// ---------- athlete documents (086 medical certificate, passport, birth certificate) ----------
/** Raw file bytes. Kept in Postgres so the existing DB backup/restore covers documents too. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  toDriver: (v) => v,
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

export const documentType = pgEnum('document_type', ['medical_086', 'passport', 'birth_certificate', 'other']);

export const athleteDocuments = pgTable(
  'athlete_documents',
  {
    id: id(),
    clubId: clubId(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    type: documentType('type').notNull(),
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Expiry (e.g. 086 is valid for a year); null = no expiry. */
    validUntil: date('valid_until'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('athlete_documents_athlete_idx').on(t.clubId, t.athleteId)],
);

/** File content lives apart from the metadata so listing documents never loads the bytes. */
export const documentFiles = pgTable('document_files', {
  documentId: uuid('document_id')
    .primaryKey()
    .references(() => athleteDocuments.id, { onDelete: 'cascade' }),
  content: bytea('content').notNull(),
});
