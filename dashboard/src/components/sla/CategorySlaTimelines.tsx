import { useState } from 'react';
import { colors } from '../../lib/theme';
import { CategoryMonthlySla, MonthlySlaSummary, slaMonthBarColor } from '../../lib/overviewAnalytics';

interface CategorySlaTimelinesProps {
  categories: CategoryMonthlySla[];
  /** Compact uses a fixed detail strip so hover never covers the chart or shifts floated article text. */
  detailMode?: 'inline' | 'compact';
}

interface ActiveCell {
  category: string;
  month: string;
}

function MonthDetail({ category, month }: { category: string; month: MonthlySlaSummary }) {
  return (
    <div className="sla-month-detail">
      <p>{category} · {month.label}</p>
      {month.total > 0 ? (
        <>
          <p><span className="text-text-muted">% Met SLA:</span> {month.pctMetSla}%</p>
          <p><span className="text-text-muted">Closed-only % Met SLA:</span> {month.pctMetSlaClosedOnly}%</p>
          <p><span className="text-text-muted">Requests filed:</span> {month.total.toLocaleString()}</p>
          <p><span className="text-text-muted">Known failures:</span> {month.failures.toLocaleString()}</p>
          <p><span className="text-text-muted">Open:</span> {month.open.toLocaleString()} · <span className="text-text-muted">Resolved:</span> {month.resolved.toLocaleString()}</p>
          <p><span className="text-text-muted">% Resolved:</span> {month.pctResolved}%</p>
          {month.immatureCohort && (
            <p className="text-warning">Immature cohort: many tickets still in flight. Compliance is provisional.</p>
          )}
        </>
      ) : (
        <p className="text-text-muted">No requests filed this month.</p>
      )}
    </div>
  );
}

function MonthDetailCompact({ category, month }: { category: string; month: MonthlySlaSummary }) {
  if (month.total === 0) {
    return (
      <div className="sla-month-detail-compact-text">
        <span className="font-semibold text-gray-900">{category}</span>
        <span className="text-text-muted"> · {month.label} — no requests filed</span>
      </div>
    );
  }

  return (
    <div className="sla-month-detail-compact-text">
      <span className="font-semibold text-gray-900">{category}</span>
      <span className="text-text-muted"> · {month.label} — </span>
      <span className="font-semibold tabular-nums">{month.pctMetSla}%</span>
      <span className="text-text-muted"> met SLA · </span>
      <span className="tabular-nums">{month.total.toLocaleString()}</span>
      <span className="text-text-muted"> requests · </span>
      <span className="tabular-nums">{month.failures.toLocaleString()}</span>
      <span className="text-text-muted"> failures</span>
      {month.immatureCohort && (
        <span className="text-warning"> · immature cohort</span>
      )}
    </div>
  );
}

export default function CategorySlaTimelines({
  categories,
  detailMode = 'inline',
}: CategorySlaTimelinesProps) {
  const [active, setActive] = useState<ActiveCell | null>(null);

  if (categories.length === 0) return null;

  const axisMonths = categories[0]?.months ?? [];
  const centerIdx = Math.floor((axisMonths.length - 1) / 2);
  const activeMonth = active
    ? categories.find((row) => row.category === active.category)?.months.find((m) => m.month === active.month)
    : null;

  const selectCell = (category: string, month: string) => {
    setActive({ category, month });
  };

  const clearActiveUnlessTouch = () => {
    if (window.matchMedia('(hover: hover)').matches) {
      setActive(null);
    }
  };

  return (
    <div className="font-mono min-w-0" onMouseLeave={clearActiveUnlessTouch}>
      <p className="text-caption text-text-muted mb-2">% met SLA by month</p>
      <div className="flex flex-col gap-1">
        {categories.map((row) => {
          const rowActive = active?.category === row.category;
          return (
            <div
              key={row.category}
              className={`flex items-center gap-3 min-w-0 rounded-sm transition-colors ${rowActive ? 'bg-surface-muted/70' : ''}`}
            >
              <span
                className={`text-[10px] sm:text-xs leading-tight w-36 sm:w-44 shrink-0 truncate transition-colors ${
                  rowActive ? 'text-gray-900 font-medium' : 'text-text-muted'
                }`}
                title={row.category}
              >
                {row.category}
              </span>
              <div
                className="grid gap-px flex-1 min-w-0 h-4 sm:h-3.5 w-full"
                style={{ gridTemplateColumns: `repeat(${row.months.length}, minmax(0, 1fr))` }}
                role="img"
                aria-label={`${row.category} monthly SLA compliance`}
              >
                {row.months.map((m) => {
                  const cellActive = rowActive && active?.month === m.month;
                  const fill = slaMonthBarColor(m);
                  return (
                    <button
                      key={m.month}
                      type="button"
                      className={`relative min-w-0 w-full h-full rounded-[1px] border-0 p-0 overflow-hidden appearance-none touch-manipulation transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${
                        cellActive ? 'sla-cell-active' : ''
                      }`}
                      aria-label={
                        m.total > 0
                          ? `${row.category}, ${m.label}: ${m.pctMetSla}% met SLA, ${m.failures.toLocaleString()} failures, ${m.total.toLocaleString()} requests`
                          : `${row.category}, ${m.label}: no requests`
                      }
                      onMouseEnter={() => selectCell(row.category, m.month)}
                      onClick={() => selectCell(row.category, m.month)}
                      onFocus={() => selectCell(row.category, m.month)}
                      onBlur={(e) => {
                        // Keep selection when moving focus between month cells in the same chart.
                        if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
                          setActive(null);
                        }
                      }}
                    >
                      {/* Inner fill span: iOS Safari often skips backgroundColor on small grid buttons. */}
                      <span
                        className="absolute inset-0 rounded-[1px]"
                        style={{ backgroundColor: fill }}
                        aria-hidden="true"
                      />
                      {m.immatureCohort && m.total > 0 && (
                        <span
                          className="absolute top-0 right-0 z-[1] w-1 h-1 rounded-full border border-gray-600 bg-white"
                          title="Immature cohort: many tickets still in flight. Compliance is provisional."
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {axisMonths.length > 0 && (
        <div className="flex gap-3 mt-1 min-w-0">
          <span className="w-36 sm:w-44 shrink-0" aria-hidden="true" />
          <div className="flex justify-between flex-1 min-w-0 text-[10px] sm:text-xs text-text-muted">
            <span>{axisMonths[0]?.label}</span>
            {axisMonths.length > 2 && <span>{axisMonths[centerIdx]?.label}</span>}
            <span>{axisMonths[axisMonths.length - 1]?.label}</span>
          </div>
        </div>
      )}
      {detailMode === 'compact' && (
        <div className="sla-month-detail-compact" aria-live="polite">
          {active && activeMonth ? (
            <MonthDetailCompact category={active.category} month={activeMonth} />
          ) : (
            <div className="sla-month-detail-compact-text text-text-muted">Tap or hover a month for details</div>
          )}
        </div>
      )}
      {detailMode === 'inline' && active && activeMonth && (
        <MonthDetail category={active.category} month={activeMonth} />
      )}
      <div className="flex flex-wrap gap-4 mt-3 text-caption text-text-muted">
        <span
          className="flex items-center gap-1.5"
          title="Less than 1 in 100 requests missed its deadline. Failure is rare enough that most residents never encounter it."
        >
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors.success }} /> ≥99% met target
        </span>
        <span
          className="flex items-center gap-1.5"
          title="Between 1 and 5 in 100 requests missed their deadline. Failures are becoming noticeable."
        >
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors.warning }} /> ≥95% at risk
        </span>
        <span
          className="flex items-center gap-1.5"
          title="More than 1 in 20 requests missed its deadline. Failure is perceptible and trust begins to erode."
        >
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#e57373' }} />
          <span className="text-text-muted">→</span>
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors.dangerDeep }} />
          <span className="text-text-muted">→</span>
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors.primaryDeep }} />
          {' '} &lt;95% below target
        </span>
        <span
          className="flex items-center gap-1.5"
          title="More than 30% of tickets filed this month are still open. Compliance will change as tickets close."
        >
          <span className="w-2 h-2 rounded-full border border-gray-400 bg-white" /> immature cohort
        </span>
      </div>
    </div>
  );
}
