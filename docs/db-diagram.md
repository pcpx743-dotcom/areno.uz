# DB diagram (PRD §3, §17)

Core chains: **club → branch → group → session**, **athlete ↔ guardian**, **subscription → charge → payment**.
Every tenant row carries `club_id`. Money = integer UZS (`bigint`). Timestamps = UTC `timestamptz`; calendar dates = `date`.

```mermaid
erDiagram
  clubs ||--o{ branches : has
  clubs ||--o{ memberships : "staff roles"
  users ||--o{ memberships : "has role in"
  clubs ||--o{ sports : defines

  branches ||--o{ groups : hosts
  sports ||--o{ groups : "sport type"
  coaches ||--o{ groups : leads
  users |o--o{ coaches : "login for"
  coaches ||--o{ coach_compensation_rules : "pay model"
  coaches ||--o{ payroll_entries : earns

  groups ||--o{ schedules : "weekly slots"
  groups ||--o{ sessions : "concrete lessons"
  schedules |o--o{ sessions : generates
  sessions ||--o{ attendance : "one row per athlete"

  athletes ||--o{ athlete_guardians : ""
  guardians ||--o{ athlete_guardians : "one phone, many kids"
  athletes ||--o{ group_enrollments : "history: add/move/pause/end"
  groups ||--o{ group_enrollments : ""
  athletes ||--o{ attendance : ""

  plans ||--o{ subscriptions : "terms copied on create"
  athletes ||--o{ subscriptions : ""
  subscriptions ||--o{ subscription_freezes : ""
  subscriptions ||--o{ charges : "obligation"
  charges ||--o{ payment_allocations : ""
  payments ||--o{ payment_allocations : "split across charges"
  payments |o--o| payments : "reversal_of (storno)"
  athletes ||--o{ balance_adjustments : "discount / correction"

  branches ||--o{ expenses : ""
  guardians ||--o{ notifications : "Telegram queue"
  clubs ||--o{ audit_logs : ""
```

## Key constraints

| Rule (PRD) | Enforcement |
|---|---|
| One attendance record per athlete per session (§7, §14) | `UNIQUE (session_id, athlete_id)` |
| Duplicate cash payment on retry (§12, §14) | `UNIQUE (club_id, idempotency_key)` on `payments` |
| A payment can be reversed only once (§6) | `UNIQUE (reversal_of_id)` |
| One guardian per phone per club; many children (§3, §4) | `UNIQUE (club_id, phone)` on `guardians` + link table |
| One open enrollment per athlete per group (§4) | partial `UNIQUE (athlete_id, group_id) WHERE status <> 'ended'` |
| One session per group/date/start time (§7) | `UNIQUE (group_id, session_date, start_time)` |
| Notification dedupe (§10) | `UNIQUE (club_id, dedupe_key)` |
| Required indexes (§3) | `(club_id, branch_id)`, `(club_id, due_date)`, `(group_id, session_date)` |

## Balance

```
balance = Σ charges (not void) − Σ payments (reversals are negative rows) − Σ balance_adjustments
balance > 0 → debt;  balance < 0 → advance
```
