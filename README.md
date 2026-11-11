# Sport ERP

Multi-tenant SaaS for sports clubs and academies (football, MMA, kickboxing, boxing, karate…).
Spec: [SPORT_ERP_Texnik_Topshiriq_v1.pdf](SPORT_ERP_Texnik_Topshiriq_v1.pdf) (PRD v1.0). First pilot: an MMA club.

## Status: Sprint 1 (PRD §17), done

| PRD §17 task | Where |
|---|---|
| Monorepo, env example, migrations, CI | `package.json` (npm workspaces), `.env.example`, `apps/api/drizzle/`, `.github/workflows/ci.yml` |
| DB diagram | [docs/db-diagram.md](docs/db-diagram.md), schema in `apps/api/src/db/schema.ts` (all §3 entities) |
| Auth + roles + tenant middleware + automated authorization tests | `apps/api/src/auth/`, `test/tenant-isolation.test.ts`, `test/rbac.test.ts` |
| Branches, sports, coaches, athletes CRUD screens | `apps/api/src/routes/`, `apps/web/src/pages/` |
| Subscription rules as an independent service + unit tests | `apps/api/src/domain/subscription-engine.ts`, `test/subscription-engine.test.ts` |
| Demo data: 2 branches, 3 coaches, 4 groups, 20 athletes | `apps/api/src/db/seed-data.ts` |
| Sprint demo: owner creates athlete → group → subscription | `test/sprint-demo.test.ts`, and in the UI |

The pilot questions (TASDIQLASH KERAK) have recommended answers, stored as club **settings** that can be changed in *Sozlamalar*:
see [docs/open-questions.md](docs/open-questions.md).

## Status: Phase 3 (Billing) and Phase 4 (Operations), done

| Area | API | Screen |
|---|---|---|
| Cash payments: idempotency key, partial payment, advance, split across charges, receipt numbers | `routes/payments.ts`, `lib/billing.ts` | Athlete profile → *Naqd to‘lov* |
| Reversal (storno) instead of deleting; admin same day only, owner any time | `POST /payments/:id/reverse` | Profile, *To‘lovlar* |
| Cash report by branch and cashier; end-of-day close with counted vs expected | `routes/cash.ts` | *Kassa* |
| Debtors; due soon, overdue and paid lists; manual charges; owner adjustments and voids | `routes/charges.ts` | *Qarzdorlar* |
| Lessons generated from the weekly schedule; cancel, move, holidays (parents notified) | `routes/sessions.ts` | *Davomat* |
| Attendance sheet (mobile); lesson-pack deduction; edit history; debtor warn/block | `PUT /sessions/:id/attendance` | *Davomat* → sheet |
| Expenses (voided, never deleted; club-wide = owner only) | `routes/expenses.ts` | *Xarajatlar* |
| Coach payroll: fixed / % of cash / per lesson, split by branch, close, correction, payout → expense | `routes/payroll.ts`, `domain/payroll.ts` | *Ish haqi* |
| Reports: cash vs accrued, debt, expenses, operating result by branch and sport; attendance | `routes/reports.ts` | *Hisobotlar* |
| Daily job: freezes, expiry, auto-renew, payment/expiry reminders (runs hourly) | `jobs/daily.ts` | Settings → automatic |
| Telegram notifications are **queued** in `notifications` (outbox, deduplicated) | `lib/notify.ts` | Sending happens in Phase 5 |

## Stack

- **API**: Node 22, TypeScript, Fastify 5, Drizzle ORM, zod, JWT (jose), bcrypt
- **DB**: PostgreSQL. Local dev and tests use **PGlite** (embedded Postgres, no Docker needed). Same SQL migrations for both.
- **Web**: React 19 + Vite + React Router; Uzbek (Latin) UI; responsive (coaches use a phone browser)

## Run locally

```bash
npm install
cp .env.example .env          # defaults to embedded Postgres in apps/api/.data
npm run db:seed               # applies migrations + demo data
npm run dev:api               # http://localhost:4000
npm run dev:web               # http://localhost:5173  (proxies /api → :4000)
```

Demo logins (password `demo12345`):

| Role | Email |
|---|---|
| Club owner | owner@demo-mma.uz |
| Branch admin (Chilonzor only) | admin.chilonzor@demo-mma.uz |
| Coach (2 groups, 2 branches) | coach.aziz@demo-mma.uz |
| Platform superadmin | superadmin@sport-erp.uz |

To use a real PostgreSQL server, set `DATABASE_URL=postgres://user:pass@host:5432/sport_erp`, then `npm run db:migrate`.

## Commands

| | |
|---|---|
| `npm test` | Unit and integration tests (in-memory Postgres) |
| `npm run typecheck` | Both apps |
| `npm run db:generate` | New migration after editing `schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run build` | API → `apps/api/dist`, web → `apps/web/dist` |

## Security model (PRD §2, §12)

- **Tenant isolation**: the JWT carries only `user id` + `membership id`. On every request the server loads the membership
  from the DB and derives `club_id`, role and branch scope. Any `club_id` sent by the client is ignored.
  Disabled memberships or suspended clubs stop working on the next request.
- **Scope**: owner = all branches; branch admin = assigned branches; coach = only groups where they are the coach
  (no finances); superadmin = club management and aggregates only, no club data.
- Out-of-scope records return **404**, not 403, so the response doesn't reveal whether a record exists.
- Every write runs in a **transaction** with **zod validation** and an **audit_logs** entry (before/after).
- Money is integer UZS; timestamps are UTC, shown in the club's timezone (`Asia/Tashkent`).
- Logger redacts `authorization`, `phone` and `password`; `maskPhone()` is available for app logs.

## Status: Phase 5, done (except the pilot itself)

| Area | Where |
|---|---|
| Parent Telegram bot: linking by own shared contact (Telegram-verified), consent, `/stop`; menu with children, subscription, payments, attendance, schedule, contact | `src/telegram/bot.ts` |
| Message sender: outbox, retry with backoff (1→8 min, 5 attempts), error log, unlinks parents who block the bot | `src/telegram/worker.ts`, *Kommunikatsiya* page |
| CSV import of athletes and parents: Uzbek headers, dry-run preview, all-or-nothing, duplicate skip | `routes/import.ts`, *Import (CSV)* page |
| Login rate limiting (failed attempts), password change, owner resets staff passwords | `routes/auth.ts`, *Mening hisobim*, *Xodimlar* |
| Staging/production: Docker image, PostgreSQL, HTTPS (Caddy), nightly backups, restore test | `Dockerfile`, `docker-compose.yml`, [docs/deploy.md](docs/deploy.md) |

The bot runs only when `TELEGRAM_BOT_TOKEN` is set; until then messages stay queued.

## Still open

- Running the pilot with the MMA club, and fixing what it reveals.
- Russian UI (decision #10: later).
- Payroll attributes revenue by payment date. An advance applied to a later charge is credited to the period
  when the money was received.
