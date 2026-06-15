import { useMemo } from 'react';
import type { Data } from 'plotly.js';
import { cohortDispositionChart } from '../../lib/charts';
import type { CohortDispositionBucket } from '../../lib/monthlyReport';
import { formatPctSlaOutcomeKnown } from '../../lib/overviewAnalytics';
import { useIsMobile } from '../../hooks/useBreakpoint';
import { colors, fonts } from '../../lib/theme';
import PlotlyChart from '../shared/PlotlyChart';
import DeferredChart from '../shared/DeferredChart';

interface CohortDispositionChartProps {
  cohortLabel: string;
  buckets: CohortDispositionBucket[];
  total: number;
  pctSlaOutcomeKnown: number;
  variant?: 'full' | 'mini';
}

/** SLA outcome marker sitting just above the scorecard detail line. */
export function MiniOutcomeMarker({
  pct,
  color,
}: {
  pct: number;
  color: string;
}) {
  return (
    <div className="relative h-[9px] w-full overflow-visible" aria-hidden="true">
      <div
        className="absolute w-px"
        style={{
          left: `${pct}%`,
          top: 0,
          bottom: 0,
          backgroundColor: color,
        }}
      />
      <span
        className="absolute font-mono tabular-nums leading-none"
        style={{
          left: `${pct}%`,
          bottom: 0,
          transform: 'translateX(calc(-100% - 3px))',
          color,
          fontFamily: fonts.mono,
          fontSize: 9,
        }}
      >
        {formatPctSlaOutcomeKnown(pct)}
      </span>
    </div>
  );
}

/** Plotly cohort disposition bar with an SLA-colored outcome marker. */
export default function CohortDispositionChart({
  cohortLabel,
  buckets,
  total,
  pctSlaOutcomeKnown,
  variant = 'full',
}: CohortDispositionChartProps) {
  const isMobile = useIsMobile();

  const chart = useMemo(
    () => cohortDispositionChart({
      cohortLabel,
      buckets,
      total,
      pctSlaOutcomeKnown,
      isMobile,
      variant,
    }),
    [cohortLabel, buckets, total, pctSlaOutcomeKnown, isMobile, variant],
  );

  const plot = (
    <PlotlyChart
      data={chart.traces as Data[]}
      layout={{
        barmode: 'stack' as const,
        height: chart.height,
        bargap: variant === 'mini' ? 0 : 0.55,
        paper_bgcolor: colors.surface,
        plot_bgcolor: colors.surface,
        showlegend: false,
        xaxis: {
          range: [0, 100],
          visible: false,
          fixedrange: true,
        },
        yaxis: {
          visible: false,
          automargin: false,
          fixedrange: true,
          domain: chart.barDomain,
        },
        margin: variant === 'mini'
          ? { t: 0, b: 0, l: 0, r: 0 }
          : { t: 8, b: isMobile ? 72 : 64, l: 4, r: 32 },
        shapes: chart.shapes,
        annotations: chart.annotations,
      }}
      style={variant === 'mini' ? { width: '100%', height: chart.height } : undefined}
    />
  );

  if (variant === 'mini') {
    return (
      <div className="h-7 flex items-center" aria-hidden="true">
        {plot}
      </div>
    );
  }

  return (
    <DeferredChart minHeight={chart.height}>
      {plot}
    </DeferredChart>
  );
}
