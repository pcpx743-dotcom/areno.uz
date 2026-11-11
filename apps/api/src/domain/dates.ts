/** Calendar-date helpers on ISO `YYYY-MM-DD` strings (timezone-free, UTC arithmetic). */

export type IsoDate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIso(d: IsoDate): Date {
  if (!ISO_RE.test(d)) throw new Error(`Invalid ISO date: ${d}`);
  const dt = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || toIso(dt) !== d) throw new Error(`Invalid ISO date: ${d}`);
  return dt;
}

export function toIso(dt: Date): IsoDate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const dt = parseIso(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toIso(dt);
}

/** Inclusive day count: daysBetween('2026-11-01','2026-11-30') = 30. */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000) + 1;
}

export function daysInMonth(d: IsoDate): number {
  const dt = parseIso(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
}

export function endOfMonth(d: IsoDate): IsoDate {
  const dt = parseIso(d);
  return toIso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)));
}

export function startOfMonth(d: IsoDate): IsoDate {
  return `${d.slice(0, 7)}-01`;
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "Today" as a calendar date in the club's timezone. */
export function todayInTz(timezone: string, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Age in full years on a given date. */
export function ageOn(birthDate: IsoDate, on: IsoDate): number {
  const b = parseIso(birthDate);
  const o = parseIso(on);
  let age = o.getUTCFullYear() - b.getUTCFullYear();
  const m = o.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && o.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** Offset (ms) of `timezone` from UTC at instant `at`. */
function tzOffsetMs(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** UTC instants [from, to) covering the calendar day `d` in `timezone`. */
export function zonedDayRangeUtc(d: IsoDate, timezone: string, days = 1): { from: Date; to: Date } {
  const startGuess = parseIso(d).getTime();
  const from = new Date(startGuess - tzOffsetMs(timezone, new Date(startGuess)));
  const endGuess = parseIso(addDays(d, days)).getTime();
  const to = new Date(endGuess - tzOffsetMs(timezone, new Date(endGuess)));
  return { from, to };
}

/** Calendar date of instant `at` in `timezone`. */
export function dateInTz(at: Date, timezone: string): IsoDate {
  return todayInTz(timezone, at);
}

/** ISO weekday 1 (Mon) … 7 (Sun). */
export function isoWeekday(d: IsoDate): number {
  const w = parseIso(d).getUTCDay();
  return w === 0 ? 7 : w;
}
