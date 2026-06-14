import { useState } from 'react';
import { colors } from '../../lib/theme';
import { MonthlySlaSummary, slaMonthBarColor } from '../../lib/overviewAnalytics';

interface MonthlySlaTimelineProps {
  months: MonthlySlaSummary[];
}

export default function MonthlySlaTimeline({ months }: MonthlySlaTimelineProps) {
  const [keepDetails, setKeepDetails] = useState(false);
  const [hoverMonth, setHoverMonth] = useState<string | null>(null);
  const [lastHoverMonth, setLastHoverMonth] = useState<string | null>(null);

  const showMonth = (month: string) => {
    setHoverMonth(month);
    setLastHoverMonth(month);
  };

  const hideMonth = () => {
    setHoverMonth(null);
  };

  const displayMonth = hoverMonth ?? (keepDetails ? lastHoverMonth : null);

  const toggleKeepDetails = (month: string) => {
    setLastHoverMonth(month);
    setKeepDetails((prev) => !prev);
  };

  return (
    <div className="font-mono">
      <div
        className="flex gap-1 sm:gap-1.5 items-stretch h-10 sm:h-12"
        role="img"
        aria-label="Monthly SLA compliance timeline"
      >
        {months.map((m) => (
          <button
            key={m.month}
            type="button"
            className="relative flex-1 min-w-0 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            style={{ backgroundColor: slaMonthBarColor(m) }}
            aria-label={`${m.label}: ${m.pctMetSla}% met SLA, ${m.total.toLocaleString()} requests`}
            aria-pressed={keepDetails && displayMonth === m.month}
            onMouseEnter={() => showMonth(m.month)}
            onMouseLeave={hideMonth}
            onFocus={() => showMonth(m.month)}
            onBlur={hideMonth}
            onClick={() => toggleKeepDetails(m.month)}
          >
            {m.immatureCohort && (
              <span
                className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full border border-gray-600 bg-white"
                title="Immature cohort: many tickets still in flight. Compliance is provisional."
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>

      <div className="flex justify-between mt-1.5 text-caption text-text-muted">
        <span>{months[0]?.label}</span>
        <span>{months[months.length - 1]?.label}</span>
      </div>

      {displayMonth && (() => {
        const m = months.find((x) => x.month === displayMonth);
        if (!m) return null;
        return (
          <div className="sla-month-detail">
            <p>{m.label}</p>
            <p><span className="text-text-muted">% Met SLA:</span> {m.pctMetSla}%</p>
            <p><span className="text-text-muted">Closed-only % Met SLA:</span> {m.pctMetSlaClosedOnly}%</p>
            <p><span className="text-text-muted">Requests filed:</span> {m.total.toLocaleString()}</p>
            <p><span className="text-text-muted">Known failures:</span> {m.failures.toLocaleString()}</p>
            <p><span className="text-text-muted">Open:</span> {m.open.toLocaleString()} · <span className="text-text-muted">Resolved:</span> {m.resolved.toLocaleString()}</p>
            <p><span className="text-text-muted">% Resolved:</span> {m.pctResolved}%</p>
            {m.immatureCohort && (
              <p className="text-warning">Immature cohort: many tickets still in flight. Compliance is provisional.</p>
            )}
          </div>
        );
      })()}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-caption text-text-muted mb-0">
        <span
          className="inline-flex items-center gap-1"
          title="Less than 1 in 100 requests missed its deadline. Failure is rare enough that most residents never encounter it."
        >
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colors.success }} />
          ≥99% meeting expectations
        </span>
        <span
          className="inline-flex items-center gap-1"
          title="Between 1 and 5 in 100 requests missed their deadline. Failures are becoming noticeable."
        >
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colors.warning }} />
          ≥95% slipping
        </span>
        <span
          className="inline-flex items-center gap-1"
          title="More than 1 in 20 requests missed its deadline. Failure is perceptible and trust begins to erode."
        >
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colors.danger }} />
          <span aria-hidden="true">→</span>
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colors.dangerDeep }} />
          <span aria-hidden="true">→</span>
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colors.primaryDeep }} />
          &lt;95% below expectations
        </span>
        <span
          className="inline-flex items-center gap-1"
          title="More than 30% of tickets filed this month are still open. Compliance will change as tickets close."
        >
          <span className="w-2 h-2 rounded-full border border-gray-400 bg-white shrink-0" />
          immature cohort
        </span>
      </p>
    </div>
  );
}
