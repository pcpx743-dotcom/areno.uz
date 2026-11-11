# Pilot questions — decisions (PRD §16)

The PRD marks these rules **TASDIQLASH KERAK**. Decisions below were taken as sensible defaults for the MMA pilot.
Every rule is a **club setting** (`clubs.settings`, editable in *Sozlamalar*), so the pilot can override any of them
without code changes.

| # | Question | Decision | Setting (default) |
|---|---|---|---|
| 1 | Calendar plan started mid-month: full or prorated? | **Prorated by remaining days**, rounded to 1 000 so‘m | `calendarProration: 'daily'` |
| 2 | 12-lesson pack: does "absent" / "excused" consume a lesson? | **Absent consumes, excused does not** | `sessionPackCountsAbsent: true`, `sessionPackCountsExcused: false` |
| 3 | Freeze limits | **Max 30 days total, max 2 freezes** per subscription; end date extended by frozen days | `maxFreezeDays: 30`, `maxFreezesPerSubscription: 2` |
| 4 | Debtor attending class | **Warn, don't block** — coach/admin see a debt flag on the attendance sheet | `debtorPolicy: 'warn'` |
| 5 | Coach % base | **Actual cash received** (net of reversals), attributed to the coach's groups by sport; split equally if an athlete trains with several coaches of that sport | payroll rule `revenue_percent` |
| 6 | Coach in several branches | Pay is computed per group; the result is **split across branches by sessions held** (stored in payroll details) | — |
| 7 | Telegram attendance messages | **Only when absent** | `attendanceNotify: 'absent_only'` (`all` / `off`) |
| 8 | Cash handling | Owner and branch admins accept cash (cashier = logged-in user). **Reversal:** admin — own branch, same day, before day close; owner — any time. **Day close:** admin enters counted cash; system stores expected vs counted and the difference. | — |
| 9 | Import Excel / notebook data | **Yes** — CSV import of athletes + guardians | phase 5 |
| 10 | UI language | **Uzbek (Latin) first**, Russian later | — |

Also decided:

- **Group over capacity:** warn and require confirmation (`capacityPolicy: 'warn'`).
- **Next period billing (PRD §13C):** `autoRenew: true` for `calendar_month` and `fixed_days` plans, **only** for athletes who are
  active and still enrolled in a group; session packs are not auto-renewed.
- **Advance (overpayment):** kept on the athlete and automatically applied to the next charge.
