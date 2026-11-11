/**
 * Dashboard "Dinamika": one bar per day of the chosen month, with a tick for the same day of the
 * previous month. One y-scale; a zero line when values go negative (daily profit often does).
 */
import { useId, useState } from 'react';
import { fmtMoney } from './ui';
import { DeltaChip } from './kit';

export type MetricKey = 'plan' | 'collected' | 'expenses' | 'result';
export interface DayRow {
  date: string;
  plan: number;
  collected: number;
  expenses: number;
  result: number;
}
export const METRICS: { key: MetricKey; label: string; good: 'up' | 'down' }[] = [
  { key: 'plan', label: 'Reja', good: 'up' },
  { key: 'collected', label: 'Tushum', good: 'up' },
  { key: 'expenses', label: 'Xarajatlar', good: 'down' },
  { key: 'result', label: 'Foyda', good: 'up' },
];

/** A round tick step, so the axis reads 250 / 500 / 750 rather than 263 / 526. */
function niceStep(range: number, count: number) {
  if (range <= 0) return 1;
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
function fmtAxis(v: number) {
  const a = Math.abs(v);
  const trim = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
  if (a >= 1_000_000) return `${trim(v / 1_000_000)} mln`;
  if (a >= 1_000) return `${trim(v / 1_000)} ming`;
  return String(v);
}

export function Dynamics({
  days,
  prevDays,
  metric,
  today,
  label,
  prevLabel,
  fmtDay,
}: {
  days: DayRow[];
  prevDays: DayRow[];
  metric: MetricKey;
  today: string;
  label: string;
  prevLabel: string;
  fmtDay: (iso: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const good = METRICS.find((m) => m.key === metric)!.good;
  const name = METRICS.find((m) => m.key === metric)!.label;
  const values = days.map((d) => (d.date > today ? null : d[metric]));
  const prev = days.map((_, i) => prevDays[i]?.[metric] ?? null);
  const nums = [...values, ...prev].filter((v): v is number => v != null);
  const hi = Math.max(0, ...nums);
  const lo = Math.min(0, ...nums);
  const step = niceStep(hi - lo || 1, 4);
  const top = Math.ceil(hi / step) * step || step;
  const bottom = Math.floor(lo / step) * step;
  const y = (v: number) => ((v - bottom) / (top - bottom)) * 100;
  const ticks: number[] = [];
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(t);
  const zero = y(0);
  const total = values.reduce<number>((a, v) => a + (v ?? 0), 0);
  const prevTotal = prevDays.reduce((a, d) => a + d[metric], 0);
  const empty = nums.every((v) => v === 0);
  const h = hover != null ? days[hover] : null;
  const hv = hover != null ? values[hover] : null;
  const hp = hover != null ? prev[hover] : null;
  const hPct = hv != null && hp != null && hp > 0 ? ((hv - hp) / hp) * 100 : null;

  return (
    <div className="dyn">
      <div className="dyn-totals">
        <div>
          <span className="dyn-key">
            <i className="swatch-bar" /> {label}
          </span>
          <strong className={total < 0 ? 'debt' : ''}>{fmtMoney(total)}</strong>
        </div>
        <div>
          <span className="dyn-key">
            <i className="swatch-tick" /> {prevLabel}
          </span>
          <strong>{fmtMoney(prevTotal)}</strong>
        </div>
        <button type="button" className="btn ghost small" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? 'Grafik' : 'Jadval'}
        </button>
      </div>

      {table ? (
        <div className="table-wrap dyn-table">
          <table>
            <thead>
              <tr>
                <th>Sana</th>
                <th className="num">{label}</th>
                <th className="num">{prevLabel}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d.date}>
                  <td>{fmtDay(d.date)}</td>
                  <td className={`num ${(values[i] ?? 0) < 0 ? 'debt' : ''}`}>{values[i] == null ? '—' : fmtMoney(values[i]!)}</td>
                  <td className="num">{prev[i] == null ? '—' : fmtMoney(prev[i]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dyn-chart" role="img" aria-label={`${name}: ${label} kunlar bo‘yicha, ${prevLabel} bilan solishtirilgan. Aniq raqamlar uchun Jadval tugmasini bosing.`}>
          <div className="dyn-axis" aria-hidden>
            {ticks.map((t) => (
              <span key={t} style={{ bottom: `${y(t)}%` }}>
                {fmtAxis(t)}
              </span>
            ))}
          </div>
          <div className="dyn-plot" onPointerLeave={() => setHover(null)} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {bottom < 0 && <div className="dyn-zero" style={{ bottom: `${zero}%` }} />}
            {days.map((d, i) => {
              const v = values[i];
              const p = prev[i];
              const future = v == null;
              return (
                <div
                  key={d.date}
                  className={`dyn-col ${future ? 'future' : ''} ${hover === i ? 'hl' : ''} ${hover != null && hover !== i ? 'dim' : ''} ${d.date === today ? 'today' : ''}`}
                  onPointerEnter={() => setHover(i)}
                  onClick={() => setHover(i)}
                >
                  <div className="dyn-track" />
                  {!!v && (
                    <div
                      className={`dyn-bar ${v < 0 ? 'neg' : ''}`}
                      style={{ bottom: `${Math.min(zero, y(v))}%`, height: `max(3px, ${Math.abs(y(v) - zero)}%)` }}
                    />
                  )}
                  {!!p && <div className="dyn-tick" style={{ bottom: `${y(p)}%` }} />}
                  <span className="dyn-day" aria-hidden>
                    {i === 0 || (i + 1) % 5 === 0 || d.date === today ? i + 1 : ''}
                  </span>
                </div>
              );
            })}
            {h && (
              <div className={`dyn-tip ${hover! > days.length * 0.6 ? 'left' : ''}`} style={{ left: `${((hover! + 0.5) / days.length) * 100}%` }}>
                <b>{fmtDay(h.date)}</b>
                <div className="tip-row">
                  <i className="swatch-bar" /> {label}
                  <b>{hv == null ? '—' : fmtMoney(hv)}</b>
                </div>
                <div className="tip-row">
                  <i className="swatch-tick" /> {prevLabel}
                  <b>{hp == null ? '—' : fmtMoney(hp)}</b>
                </div>
                {hPct != null && (
                  <div className="tip-delta">
                    <DeltaChip pct={hPct} good={good} />
                  </div>
                )}
              </div>
            )}
            {empty && <div className="dyn-empty">Bu oyda va o‘tgan oyda {name.toLowerCase()} yo‘q</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Tiny trend in a KPI tile: shape only, the tile states the value. */
export function Spark({ values }: { values: number[] }) {
  const id = useId();
  if (values.length < 2) return <div className="spark" />;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 28 - ((v - lo) / span) * 24] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--trend-a)" stopOpacity="0.4" />
          <stop offset="1" stopColor="var(--trend-b)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L100 32 L0 32 Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--trend-a)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Month-by-month area chart with one y-scale, hover read-out and a table view. */
export function TrendChart({ rows, name }: { rows: { key: string; label: string; full: string; value: number }[]; name: string }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const nums = rows.map((r) => r.value);
  const hi = Math.max(0, ...nums);
  const lo = Math.min(0, ...nums);
  const step = niceStep(hi - lo || 1, 5);
  const top = Math.ceil(hi / step) * step || step;
  const bottom = Math.floor(lo / step) * step;
  const y = (v: number) => ((v - bottom) / (top - bottom)) * 100;
  const ticks: number[] = [];
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(t);
  const x = (i: number) => ((i + 0.5) / rows.length) * 100;
  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)} ${100 - y(r.value)}`).join(' ');
  const base = 100 - y(Math.max(bottom, 0));
  const h = hover != null ? rows[hover] : null;
  const before = hover != null && hover > 0 ? rows[hover - 1].value : null;
  const pct = h && before != null && before > 0 ? ((h.value - before) / before) * 100 : null;

  return (
    <>
      <div className="tr-tools">
        <button type="button" className="btn ghost small" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? 'Grafik' : 'Jadval'}
        </button>
      </div>
      {table ? (
        <div className="table-wrap dyn-table">
          <table>
            <thead>
              <tr>
                <th>Oy</th>
                <th className="num">{name}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.full}</td>
                  <td className={`num ${r.value < 0 ? 'debt' : ''}`}>{fmtMoney(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="tr-chart" role="img" aria-label={`${name}, oylar bo‘yicha. Aniq raqamlar uchun Jadval tugmasini bosing.`}>
          <div className="dyn-axis" aria-hidden>
            {ticks.map((t) => (
              <span key={t} style={{ bottom: `${y(t)}%` }}>
                {fmtAxis(t)}
              </span>
            ))}
          </div>
          <div className="tr-plot" onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <i key={t} className="tr-grid" style={{ bottom: `${y(t)}%` }} />
            ))}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--trend-a)" stopOpacity="0.55" />
                  <stop offset="1" stopColor="var(--trend-b)" stopOpacity="0.08" />
                </linearGradient>
              </defs>
              <path d={`${line} L${x(rows.length - 1)} ${base} L${x(0)} ${base} Z`} fill={`url(#${id})`} />
              <path d={line} fill="none" stroke="var(--trend-a)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            </svg>
            {rows.map((r, i) => (
              <i key={r.key} className={`tr-dot ${hover === i ? 'hl' : ''}`} style={{ left: `${x(i)}%`, bottom: `${y(r.value)}%` }} />
            ))}
            <div className="tr-hits" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
              {rows.map((r, i) => (
                <div key={r.key} onPointerEnter={() => setHover(i)} onClick={() => setHover(i)}>
                  <span className="tr-label">{r.label}</span>
                </div>
              ))}
            </div>
            {h && (
              <div className={`dyn-tip ${hover! > rows.length * 0.6 ? 'left' : ''}`} style={{ left: `${x(hover!)}%` }}>
                <b>{h.full}</b>
                <div className="tip-row">
                  {name}
                  <b>{fmtMoney(h.value)}</b>
                </div>
                {pct != null && (
                  <div className="tip-delta">
                    <DeltaChip pct={pct} good={METRICS.find((m) => m.label === name)?.good ?? 'up'} /> <span className="muted">oldingi oyga</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
