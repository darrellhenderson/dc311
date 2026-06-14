import { useMemo, useCallback } from 'react';
import type { Data } from 'plotly.js';
import { useDashboard } from '../../context/DashboardContext';
import { trackEvent } from '../../lib/analytics';
import { slaCategorySummary } from '../../lib/dataProcessing';
import { mergeSlaRollups } from '../../lib/rollups';
import {
  computeMonthlyScorecard,
  computeCategorySlaForMonth,
  detectNotables,
  computeWardBreakdown,
  computeVolumeSummary,
  computeBacklogSnapshot,
  getAvailableMonths,
  getLatestCompleteMonth,
  findRollup,
  findPrevMonth,
  findYoyMonth,
  formatKpiWithDelta,
  Notable,
} from '../../lib/monthlyReport';
import { slaCategorySummaryChart, slaCategoryVolumeMarkerSize } from '../../lib/charts';
import { useIsMobile, useIsDesktop } from '../../hooks/useBreakpoint';
import {
  capChartHeight,
  chartTitle,
  hBarMargin,
  legendBelow,
  stackedBarMargin,
} from '../../lib/responsiveChartLayout';
import PlotlyChart from '../shared/PlotlyChart';
import DeferredChart from '../shared/DeferredChart';
import SectionCard from '../shared/SectionCard';
import StatRow, { StatItem } from '../shared/StatRow';
import SingleSelect from '../shared/filters/SingleSelect';
import { colors } from '../../lib/theme';
import { plotlyAxisTitleFont } from '../../lib/theme';

interface ReportTabProps {
  month: string | null;
  onMonthChange: (month: string) => void;
}

function NotablesList({ notables }: { notables: Notable[] }) {
  if (notables.length === 0) {
    return <p className="text-caption text-text-muted mb-0">No notable shifts vs last month.</p>;
  }

  return (
    <ul className="space-y-2 text-sm mb-0">
      {notables.map((n) => (
        <li key={`${n.kind}-${n.subject}`} className="flex items-start gap-2">
          <span
            className={`shrink-0 w-2 h-2 rounded-full mt-1.5 ${
              n.severity === 'danger'
                ? 'bg-red-500'
                : n.severity === 'warning'
                  ? 'bg-orange-500'
                  : 'bg-blue-500'
            }`}
          />
          <span>{n.sentence}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ReportTab({ month, onMonthChange }: ReportTabProps) {
  const { data: dashboardData } = useDashboard();
  const isMobile = useIsMobile();
  const isBentoWide = useIsDesktop();

  const rollups = useMemo(() => dashboardData?.monthlyRollups ?? [], [dashboardData?.monthlyRollups]);
  const dicts = dashboardData?.manifest.dictionaries;
  const shards = useMemo(() => dashboardData?.manifest.shards ?? [], [dashboardData?.manifest.shards]);

  const availableMonths = useMemo(() => getAvailableMonths(shards), [shards]);
  const defaultMonth = useMemo(() => getLatestCompleteMonth(shards), [shards]);
  const selectedMonth = month && availableMonths.includes(month) ? month : defaultMonth;

  const currentRollup = useMemo(
    () => findRollup(rollups, selectedMonth),
    [rollups, selectedMonth],
  );
  const prevRollup = useMemo(
    () => findPrevMonth(rollups, selectedMonth),
    [rollups, selectedMonth],
  );
  const yoyRollup = useMemo(
    () => findYoyMonth(rollups, selectedMonth),
    [rollups, selectedMonth],
  );

  const handleMonthChange = useCallback(
    (next: string) => {
      if (next !== selectedMonth) {
        trackEvent('report_month_change', { month: next });
      }
      onMonthChange(next);
    },
    [onMonthChange, selectedMonth],
  );

  const report = useMemo(() => {
    if (!currentRollup || !dicts) return null;
    return computeMonthlyScorecard(currentRollup, prevRollup, yoyRollup, dicts);
  }, [currentRollup, prevRollup, yoyRollup, dicts]);

  const categorySla = useMemo(() => {
    if (!currentRollup || !dicts) return [];
    return computeCategorySlaForMonth(currentRollup, prevRollup, dicts);
  }, [currentRollup, prevRollup, dicts]);

  const notables = useMemo(() => {
    if (!currentRollup || !dicts) return [];
    return detectNotables(currentRollup, prevRollup, dicts);
  }, [currentRollup, prevRollup, dicts]);

  const wardBreakdown = useMemo(() => {
    if (!currentRollup || !dicts) return [];
    return computeWardBreakdown(currentRollup, dicts);
  }, [currentRollup, dicts]);

  const volumeSummary = useMemo(() => {
    if (!currentRollup || !dicts) return null;
    return computeVolumeSummary(currentRollup, dicts);
  }, [currentRollup, dicts]);

  const backlog = useMemo(() => {
    if (!dicts) return null;
    const prevOpen = prevRollup
      ? prevRollup.explorer.categoryBreakdown.reduce((s, r) => s + r.open, 0)
      : null;
    return computeBacklogSnapshot(
      dashboardData?.rows ?? [],
      prevOpen,
      dicts.ageBuckets,
    );
  }, [dashboardData?.rows, prevRollup, dicts]);

  const catChart = useMemo(() => {
    if (!currentRollup || !dicts) return null;
    const slaRows = mergeSlaRollups([currentRollup], dicts);
    const summary = slaCategorySummary(slaRows);
    const height = capChartHeight(Math.max(280, summary.length * 36 + 100), isMobile);
    const markerSize = slaCategoryVolumeMarkerSize(
      summary.length,
      height,
      56,
      isMobile ? 76 : 68,
    );
    return { ...slaCategorySummaryChart(summary, { markerSize }), height };
  }, [currentRollup, dicts, isMobile]);

  const scorecardStats = useMemo((): StatItem[] => {
    if (!report) return [];
    const sla = formatKpiWithDelta(`${report.pctMetSla}%`, report.deltas.pctMetSla, 'up');
    const filed = formatKpiWithDelta(report.totalFiled.toLocaleString(), report.deltas.totalFiled, 'down');
    const resolved = formatKpiWithDelta(report.totalResolved.toLocaleString(), report.deltas.totalResolved, 'up');
    const median = formatKpiWithDelta(
      `${report.medianResolutionDays}d`,
      report.deltas.medianResolutionDays,
      'down',
    );
    return [
      { label: '% Met SLA', value: sla.value, tone: sla.tone },
      { label: 'Requests filed', value: filed.value, tone: filed.tone },
      { label: 'Resolved', value: resolved.value, tone: resolved.tone },
      { label: 'Median resolution', value: median.value, tone: median.tone },
    ];
  }, [report]);

  if (!dashboardData || !currentRollup || !dicts || !report) {
    return (
      <p className="text-caption text-text-muted">No report data available for this month.</p>
    );
  }

  const monthOptions = availableMonths.map((m) => ({
    value: m,
    label: new Date(`${m}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  }));

  const catChartHeight = catChart?.height ?? 320;

  return (
    <div className="space-y-2">
      <div className="bg-surface border border-border rounded-lg px-4 py-3 mb-2">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h2 className="text-body font-semibold text-gray-900 mb-0">Monthly report card</h2>
            <p className="text-caption text-text-muted mb-0 mt-0.5">
              {report.label} · SLA compliance, volume, and notable shifts
            </p>
          </div>
          <div className="w-full sm:w-56">
            <SingleSelect
              label="Report month"
              value={selectedMonth}
              options={monthOptions}
              onChange={handleMonthChange}
            />
          </div>
        </div>
      </div>

      <StatRow stats={scorecardStats} />

      <SectionCard
        title="SLA compliance by category"
        subtitle={`${report.label} · vs prior month`}
        defaultOpen
      >
        <DeferredChart minHeight={catChartHeight}>
          {catChart && (
            <PlotlyChart
              data={[catChart.bars[0], ...catChart.volumeLines, catChart.scatter[0]] as Data[]}
              layout={{
                barmode: 'overlay' as const,
                height: catChartHeight,
                title: chartTitle('SLA compliance by category'),
                xaxis: { title: '% Met SLA', range: [0, 115], domain: isBentoWide ? [0, 0.75] : [0, 1] },
                yaxis: {
                  title: '',
                  automargin: true,
                  categoryorder: 'array' as const,
                  categoryarray: catChart.categories,
                },
                ...(isBentoWide
                  ? {
                      xaxis2: {
                        title: 'Total Requests',
                        range: catChart.volumeAxisRange,
                        overlaying: 'x',
                        side: 'top',
                        showgrid: false,
                        tickformat: ',',
                        tick0: 0,
                        titlefont: plotlyAxisTitleFont,
                      },
                    }
                  : {}),
                shapes: [
                  { type: 'line', x0: 99, x1: 99, y0: 0, y1: 1, yref: 'paper', line: { color: colors.success, width: 1, dash: 'dot' } },
                  { type: 'line', x0: 95, x1: 95, y0: 0, y1: 1, yref: 'paper', line: { color: colors.warning, width: 1, dash: 'dot' } },
                ],
                margin: hBarMargin(isMobile),
                legend: legendBelow(isMobile),
              }}
            />
          )}
        </DeferredChart>
        {categorySla.some((c) => c.delta !== null) && (
          <p className="text-caption text-text-muted mt-2 mb-0">
            Largest MoM moves:{' '}
            {[...categorySla]
              .filter((c) => c.delta !== null)
              .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
              .slice(0, 3)
              .map((c) => `${c.category} (${c.delta! >= 0 ? '+' : ''}${c.delta} pts)`)
              .join(' · ')}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Volume & throughput"
        subtitle={`Filed ${report.totalFiled.toLocaleString()} · resolved ${report.totalResolved.toLocaleString()}`}
        defaultOpen
      >
        <DeferredChart minHeight={280}>
          <PlotlyChart
            data={[
              {
                x: ['Filed', 'Resolved'],
                y: [report.totalFiled, report.totalResolved],
                type: 'bar' as const,
                marker: { color: [colors.primary, colors.success] },
                text: [report.totalFiled, report.totalResolved].map((n) => n.toLocaleString()),
                textposition: 'outside' as const,
              },
              ...(volumeSummary?.weeklyTotals.length
                ? [{
                    x: volumeSummary.weeklyTotals.map((w) => w.week),
                    y: volumeSummary.weeklyTotals.map((w) => w.count),
                    type: 'scatter' as const,
                    mode: 'lines+markers' as const,
                    name: 'Weekly volume',
                    yaxis: 'y2' as const,
                    line: { color: colors.warning, width: 2 },
                    marker: { size: 6 },
                  }]
                : []),
            ] as Data[]}
            layout={{
              height: isMobile ? 280 : 320,
              title: chartTitle('Volume & throughput'),
              xaxis: { title: '' },
              yaxis: { title: 'Requests', tickformat: ',' },
              yaxis2: volumeSummary?.weeklyTotals.length
                ? { title: 'Weekly', overlaying: 'y', side: 'right', showgrid: false }
                : undefined,
              margin: stackedBarMargin(isMobile),
              legend: legendBelow(isMobile),
            }}
          />
        </DeferredChart>
        {volumeSummary && volumeSummary.topServiceTypes.length > 0 && (
          <p className="text-caption text-text-muted mt-2 mb-0">
            Top service types:{' '}
            {volumeSummary.topServiceTypes
              .map((t) => `${t.type} (${t.total.toLocaleString()})`)
              .join(' · ')}
          </p>
        )}
        <p className="text-caption text-text-muted mt-1 mb-0">
          Net backlog change this month: {report.netBacklogChange >= 0 ? '+' : ''}
          {report.netBacklogChange.toLocaleString()} requests (filed minus resolved).
        </p>
      </SectionCard>

      <SectionCard title="Notable this month" subtitle="Auto-detected shifts vs prior month" defaultOpen>
        <NotablesList notables={notables} />
      </SectionCard>

      <SectionCard title="Ward breakdown" subtitle="Requests and resolution rate by ward" defaultOpen>
        <DeferredChart minHeight={300}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <PlotlyChart
              data={[
                {
                  x: wardBreakdown.map((w) => w.ward),
                  y: wardBreakdown.map((w) => w.filed - w.resolved),
                  name: 'Open / In-Progress',
                  type: 'bar' as const,
                  marker: { color: colors.danger },
                },
                {
                  x: wardBreakdown.map((w) => w.ward),
                  y: wardBreakdown.map((w) => w.resolved),
                  name: 'Resolved',
                  type: 'bar' as const,
                  marker: { color: colors.success },
                },
              ]}
              layout={{
                barmode: 'stack' as const,
                height: isMobile ? 300 : 340,
                title: chartTitle('Requests by ward'),
                xaxis: { title: 'Ward' },
                yaxis: { title: 'Requests' },
                legend: legendBelow(isMobile),
                margin: stackedBarMargin(isMobile),
              }}
            />
            <PlotlyChart
              data={[{
                x: wardBreakdown.map((w) => w.ward),
                y: wardBreakdown.map((w) => w.pctResolved),
                type: 'bar' as const,
                marker: {
                  color: wardBreakdown.map((w) => w.pctResolved),
                  colorscale: [[0, '#c0392b'], [0.5, '#f39c12'], [1, '#2ecc71']],
                  cmin: 0,
                  cmax: 100,
                },
                text: wardBreakdown.map((w) => `${w.pctResolved.toFixed(0)}%`),
                textposition: 'outside' as const,
              }]}
              layout={{
                height: isMobile ? 300 : 340,
                title: chartTitle('% resolved by ward'),
                xaxis: { title: 'Ward' },
                yaxis: { title: '% Resolved', range: [0, 110] },
                margin: { t: 56, b: 40, l: 50, r: 20 },
              }}
            />
          </div>
        </DeferredChart>
      </SectionCard>

      <SectionCard
        title="Aging backlog"
        subtitle="Currently open tickets by age (snapshot at data refresh)"
        defaultOpen
      >
        <DeferredChart minHeight={280}>
          <PlotlyChart
            data={[{
              x: backlog?.buckets.map((b) => b.label) ?? [],
              y: backlog?.buckets.map((b) => b.count) ?? [],
              type: 'bar' as const,
              marker: { color: colors.warning },
              text: backlog?.buckets.map((b) => b.count.toLocaleString()) ?? [],
              textposition: 'outside' as const,
            }]}
            layout={{
              height: isMobile ? 280 : 320,
              title: chartTitle('Open ticket age'),
              xaxis: { title: 'Age bucket' },
              yaxis: { title: 'Open tickets', tickformat: ',' },
              margin: stackedBarMargin(isMobile),
            }}
          />
        </DeferredChart>
        {backlog && (
          <p className="text-caption text-text-muted mt-2 mb-0">
            {backlog.total.toLocaleString()} open tickets total
            {backlog.delta !== null && (
              <> · {backlog.delta >= 0 ? '+' : ''}{backlog.delta.toLocaleString()} vs prior month rollup</>
            )}
          </p>
        )}
      </SectionCard>
    </div>
  );
}
