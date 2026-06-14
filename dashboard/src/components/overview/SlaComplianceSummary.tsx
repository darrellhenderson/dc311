import { MonthlySlaSummary, slaVerdictLabel } from '../../lib/overviewAnalytics';
import { colors } from '../../lib/theme';
import MonthlySlaTimeline from './MonthlySlaTimeline';

interface SlaComplianceSummaryProps {
  pctMetSla: number;
  failures: number;
  errorBudgetAt99: number;
  months: MonthlySlaSummary[];
  categoriesBelow95Count: number;
  totalCategoryCount: number;
}

const toneColor = {
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
} as const;

function errorBudgetDetail(failures: number, errorBudgetAt99: number): string | null {
  if (errorBudgetAt99 <= 0) return null;
  const multiple = Math.round(failures / errorBudgetAt99);
  if (multiple <= 1) return null;
  return `${failures.toLocaleString()} failures, ${multiple}× the error budget at 99%`;
}

export default function SlaComplianceSummary({
  pctMetSla,
  failures,
  errorBudgetAt99,
  months,
  categoriesBelow95Count,
  totalCategoryCount,
}: SlaComplianceSummaryProps) {
  const verdict = slaVerdictLabel(pctMetSla);
  const color = toneColor[verdict.tone];
  const detail = verdict.tone === 'danger' ? errorBudgetDetail(failures, errorBudgetAt99) : null;

  return (
    <section className="article-section article-prose">
      <h2 className="article-headline">SLA compliance</h2>
      <p className="article-dek">
        Whether DC met its promised 311 deadlines over the last twelve months.
        {categoriesBelow95Count > 0 && (
          <> {categoriesBelow95Count} of {totalCategoryCount} categories fall below 95%.</>
        )}
      </p>

      <div className="font-mono">
        <div
          className="flex flex-wrap items-baseline gap-x-4 sm:gap-x-5 gap-y-1 mb-2"
          aria-label={`${pctMetSla}% met SLA, ${verdict.label}`}
        >
          <span
            className="text-7xl sm:text-8xl font-bold leading-none tabular-nums tracking-tight"
            style={{ color }}
          >
            {pctMetSla}%
          </span>
          <span
            className="text-xl sm:text-2xl font-bold leading-snug"
            style={{ color }}
          >
            {verdict.label}
          </span>
        </div>

        <div className="mb-3">
          {detail && <p className="text-caption text-text-muted mb-0">{detail}</p>}
        </div>

        <MonthlySlaTimeline months={months} />
      </div>
    </section>
  );
}
