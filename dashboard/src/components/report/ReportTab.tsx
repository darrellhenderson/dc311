import { useMemo, useCallback } from 'react';
import type { Data } from 'plotly.js';
import { useDashboard } from '../../context/DashboardContext';
import { trackEvent } from '../../lib/analytics';
import { slaCategorySummary } from '../../lib/dataProcessing';
import { mergeSlaRollups } from '../../lib/rollups';
import {
  computeMonthlyScorecard,
  computeCategorySlaBandCounts,
  computeCategoryReportingReadiness,
  detectNotables,
  computeWardBreakdown,
  computeCohortSettling,
  computeDailyVolumeByCategory,
  computeCohortFlow,
  getAvailableMonths,
  getLatestCompleteMonth,
  findRollup,
  findPrevMonth,
  findYoyMonth,
  formatCategorySlaBandsScorecardKpi,
  formatFiledScorecardKpi,
  formatCategorySlaBandAccessibleSummary,
  formatCohortDispositionAccessibleSummary,
  formatOutcomeKnownScorecardKpi,
  formatSlaScorecardKpi,
  SCORECARD_KPI_INFO,
  Notable,
  CategorySlaBandCounts,
  CategoryReportingReadiness,
} from '../../lib/monthlyReport';
import { slaCategorySummaryChart, slaCategoryVolumeMarkerSize, explorerResolutionHistogram } from '../../lib/charts';
import { COHORT_FOLLOW_UP_DAYS, filingMonthKey } from '../../lib/filingDate';
import { useIsMobile, useIsDesktop } from '../../hooks/useBreakpoint';
import {
  capChartHeight,
  chartTitle,
  hBarMargin,
  legendBelow,
  pieMargin,
  stackedBarMargin,
  unifiedStackHover,
} from '../../lib/responsiveChartLayout';
import PlotlyChart from '../shared/PlotlyChart';
import DeferredChart from '../shared/DeferredChart';
import ChartPanel from '../shared/ChartPanel';
import SectionCard from '../shared/SectionCard';
import StatRow, { StatItem } from '../shared/StatRow';
import SingleSelect from '../shared/filters/SingleSelect';
import CohortDispositionChart, { MiniOutcomeMarker } from './CohortDispositionChart';
import { slaOutcomeKnownColor } from '../../lib/overviewAnalytics';
import { colors, CATEGORICAL_COLORS, plotlyAxisTitleFont } from '../../lib/theme';

interface ReportTabProps {
  month: string | null;
  onMonthChange: (month: string) => void;
}

function CategorySlaBandValue({ counts }: { counts: CategorySlaBandCounts }) {
  return (
    <p className="text-base font-semibold mb-0 tabular-nums leading-tight whitespace-nowrap">
      <span className="text-success">{counts.success}</span>
      <span className="text-caption font-normal text-text-muted"> meet</span>
      <span className="text-text-muted font-normal"> · </span>
      <span className="text-warning">{counts.warning}</span>
      <span className="text-caption font-normal text-text-muted"> slip</span>
      <span className="text-text-muted font-normal"> · </span>
      <span className="text-danger">{counts.danger}</span>
      <span className="text-caption font-normal text-text-muted"> below</span>
      {counts.settling > 0 && (
        <>
          <span className="text-text-muted font-normal"> · </span>
          <span
            className="inline-block w-1.5 h-1.5 rounded-full border border-gray-600 bg-white align-middle mx-px"
            aria-hidden="true"
          />
          <span className="text-text-muted font-normal">{counts.settling}</span>
        </>
      )}
    </p>
  );
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

  const notables = useMemo(() => {
    if (!currentRollup || !dicts) return [];
    return detectNotables(currentRollup, prevRollup, dicts);
  }, [currentRollup, prevRollup, dicts]);

  const wardBreakdown = useMemo(() => {
    if (!currentRollup || !dicts) return [];
    return computeWardBreakdown(currentRollup, dicts);
  }, [currentRollup, dicts]);

  const dailyVolumeByCategory = useMemo(() => {
    if (!selectedMonth || !dashboardData?.rows) {
      return { dayLabels: [], xTickVals: [], xTickText: [], traces: [] };
    }
    return computeDailyVolumeByCategory(dashboardData.rows, selectedMonth);
  }, [dashboardData?.rows, selectedMonth]);

  const resolutionByCategory = useMemo(() => {
    if (!selectedMonth || !dashboardData?.rows) return { hasData: false as const };
    const monthRows = dashboardData.rows.filter((row) => filingMonthKey(row.date) === selectedMonth);
    return explorerResolutionHistogram(monthRows);
  }, [dashboardData?.rows, selectedMonth]);

  const cohortFlow = useMemo(() => {
    if (!selectedMonth || !dashboardData?.rows) {
      return {
        hasData: false as const,
        dayLabels: [] as string[],
        xTickVals: [] as string[],
        xTickText: [] as string[],
        traces: [],
      };
    }
    return computeCohortFlow(dashboardData.rows, selectedMonth);
  }, [dashboardData?.rows, selectedMonth]);

  const categoryBandCounts = useMemo(() => {
    if (!currentRollup || !dicts) return null;
    return computeCategorySlaBandCounts(currentRollup, dicts);
  }, [currentRollup, dicts]);

  const prevCategoryBandCounts = useMemo(() => {
    if (!prevRollup || !dicts) return null;
    return computeCategorySlaBandCounts(prevRollup, dicts);
  }, [prevRollup, dicts]);

  const cohortSettling = useMemo(() => {
    if (!currentRollup || !dicts) return null;
    return computeCohortSettling(currentRollup, dicts);
  }, [currentRollup, dicts]);

  const categoryVolumeBreakdown = useMemo(() => {
    if (!currentRollup || !dicts) return [];
    return currentRollup.explorer.categoryBreakdown
      .map((row) => ({
        category: dicts.categories[row.c],
        total: row.open + row.resolved,
      }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [currentRollup, dicts]);

  const categoryReadiness = useMemo(() => {
    if (!currentRollup || !dicts) return new Map<string, CategoryReportingReadiness>();
    return new Map(
      computeCategoryReportingReadiness(currentRollup, dicts).map((row) => [row.category, row]),
    );
  }, [currentRollup, dicts]);

  const hasImmatureCategories = useMemo(
    () => Array.from(categoryReadiness.values()).some((row) => row.immatureCohort),
    [categoryReadiness],
  );

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
    return {
      ...slaCategorySummaryChart(summary, { markerSize, readinessByCategory: categoryReadiness }),
      height,
    };
  }, [currentRollup, dicts, isMobile, categoryReadiness]);

  const scorecardStats = useMemo((): StatItem[] => {
    if (!report || !cohortSettling || !categoryBandCounts) return [];
    const sla = formatSlaScorecardKpi(report.pctMetSla, report.immatureCohort);
    const filed = formatFiledScorecardKpi(report.totalFiled, report.totalResolved);
    const categoryBands = formatCategorySlaBandsScorecardKpi(
      categoryBandCounts,
      prevCategoryBandCounts,
    );
    const outcome = formatOutcomeKnownScorecardKpi(
      cohortSettling.pctSlaOutcomeKnown,
      report.immatureCohort,
    );
    return [
      { label: '% Met SLA', value: sla.value, detail: sla.detail ?? undefined, tone: sla.tone, info: SCORECARD_KPI_INFO.pctMetSla },
      { label: 'Requests filed', value: filed.value, detail: filed.detail ?? undefined, tone: filed.tone, info: SCORECARD_KPI_INFO.requestsFiled },
      {
        label: 'Categories by SLA',
        content: <CategorySlaBandValue counts={categoryBandCounts} />,
        valueAriaLabel: formatCategorySlaBandAccessibleSummary(categoryBandCounts, prevCategoryBandCounts),
        detail: categoryBands.detail ?? undefined,
        tone: categoryBands.tone,
        info: SCORECARD_KPI_INFO.categoriesBySla,
      },
      {
        label: 'Reporting readiness',
        value: cohortSettling.buckets.length === 0 ? outcome.value : undefined,
        detail: outcome.detail ?? undefined,
        tone: outcome.tone,
        info: SCORECARD_KPI_INFO.reportingReadiness,
        valueAriaLabel: cohortSettling.buckets.length > 0
          ? formatCohortDispositionAccessibleSummary(
            cohortSettling.buckets,
            cohortSettling.total,
            cohortSettling.pctSlaOutcomeKnown,
          )
          : `Reporting readiness: ${outcome.value}. ${outcome.detail ?? ''}`,
        content: cohortSettling.buckets.length > 0 ? (
          <CohortDispositionChart
            cohortLabel=""
            buckets={cohortSettling.buckets}
            total={cohortSettling.total}
            pctSlaOutcomeKnown={cohortSettling.pctSlaOutcomeKnown}
            variant="mini"
          />
        ) : undefined,
        contentFooter: cohortSettling.buckets.length > 0 ? (
          <MiniOutcomeMarker
            pct={cohortSettling.pctSlaOutcomeKnown}
            color={slaOutcomeKnownColor(cohortSettling.pctSlaOutcomeKnown)}
          />
        ) : undefined,
      },
    ];
  }, [report, cohortSettling, categoryBandCounts, prevCategoryBandCounts]);

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
  const categoryDonutHeight = isMobile ? 280 : 320;
  const dailyVolumeHeight = capChartHeight(isMobile ? 300 : 360, isMobile);
  const resolutionHistHeight = capChartHeight(isMobile ? 300 : 360, isMobile);
  const cohortFlowHeight = capChartHeight(isMobile ? 300 : 360, isMobile);

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
        title="At a glance"
        subtitle={`${report.label} · compliance by category, notables, and volume mix`}
        defaultOpen
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-9 min-w-0">
            <ChartPanel>
              <DeferredChart minHeight={catChartHeight}>
                {catChart && (
                  <PlotlyChart
                    data={[
                      catChart.bars[0],
                      ...catChart.volumeLines,
                      catChart.scatter[0],
                    ] as Data[]}
                    layout={{
                      barmode: 'overlay' as const,
                      height: catChartHeight,
                      title: chartTitle('SLA compliance by category'),
                      xaxis: { title: '% Met SLA', range: catChart.slaXRange },
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
              {hasImmatureCategories && (
                <p className="text-caption text-text-muted mb-0 mt-2 flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full border border-gray-600 bg-white shrink-0" aria-hidden="true" />
                  Within SLA window — reporting readiness still settling
                </p>
              )}
            </ChartPanel>
          </div>

          <div className="lg:col-span-3 min-w-0 flex flex-col gap-4">
            <ChartPanel>
              <h3 className="text-caption font-semibold text-gray-900 mb-2">Notable this month</h3>
              <NotablesList notables={notables} />
            </ChartPanel>

            {categoryVolumeBreakdown.length > 0 && (
              <ChartPanel>
                <DeferredChart minHeight={categoryDonutHeight}>
                  <PlotlyChart
                    data={[{
                      labels: categoryVolumeBreakdown.map((row) => row.category),
                      values: categoryVolumeBreakdown.map((row) => row.total),
                      type: 'pie' as const,
                      hole: 0.3,
                      textinfo: isMobile ? 'percent' as const : 'label+percent' as const,
                      textposition: 'inside' as const,
                      hovertemplate: '<b>%{label}</b><br>%{value:,} requests · %{percent}<extra></extra>',
                      showlegend: false,
                      marker: {
                        colors: categoryVolumeBreakdown.map((_, index) => (
                          CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length]
                        )),
                      },
                    }]}
                    layout={{
                      height: categoryDonutHeight,
                      title: chartTitle('Volume by category'),
                      margin: pieMargin(),
                    }}
                  />
                </DeferredChart>
              </ChartPanel>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Volume & throughput"
        subtitle={`${report.label} · daily volume, resolution time, and completion curves`}
        defaultOpen
      >
        <div className="space-y-4">
          <ChartPanel>
            {dailyVolumeByCategory.traces.length > 0 ? (
              <DeferredChart minHeight={dailyVolumeHeight}>
                <PlotlyChart
                  data={dailyVolumeByCategory.traces as Data[]}
                  layout={{
                    barmode: 'stack' as const,
                    height: dailyVolumeHeight,
                    title: chartTitle('Daily requests by category'),
                    xaxis: {
                      title: report.label,
                      tickmode: 'array',
                      tickvals: dailyVolumeByCategory.xTickVals,
                      ticktext: dailyVolumeByCategory.xTickText,
                    },
                    yaxis: { title: 'Requests', tickformat: ',' },
                    legend: { ...legendBelow(isMobile, -0.2), font: { size: 11 } },
                    margin: stackedBarMargin(isMobile),
                    ...unifiedStackHover(),
                  }}
                />
              </DeferredChart>
            ) : (
              <p className="text-caption text-text-muted mb-0">No requests filed this month.</p>
            )}
          </ChartPanel>

          <ChartPanel>
            {resolutionByCategory.hasData ? (
              <DeferredChart minHeight={resolutionHistHeight}>
                <PlotlyChart
                  data={resolutionByCategory.traces as Data[]}
                  layout={{
                    barmode: 'overlay' as const,
                    height: resolutionHistHeight,
                    title: chartTitle('Resolution time by category'),
                    xaxis: { title: 'Days from filing to resolution', range: [0, resolutionByCategory.maxDays] },
                    yaxis: { title: 'Closed requests' },
                    legend: { ...legendBelow(isMobile, -0.2), font: { size: 11 } },
                    margin: stackedBarMargin(isMobile),
                  }}
                />
              </DeferredChart>
            ) : (
              <p className="text-caption text-text-muted mb-0">No closed requests this month.</p>
            )}
          </ChartPanel>

          <ChartPanel>
            {cohortFlow.hasData ? (
              <>
                <PlotlyChart
                  data={cohortFlow.traces as Data[]}
                  layout={{
                    barmode: 'stack' as const,
                    height: cohortFlowHeight,
                    title: chartTitle('Cohort backlog and resolution'),
                    xaxis: {
                      title: `${report.label} + ${COHORT_FOLLOW_UP_DAYS} days`,
                      tickmode: 'array',
                      tickvals: cohortFlow.xTickVals,
                      ticktext: cohortFlow.xTickText,
                    },
                    yaxis: { title: 'Requests (cumulative)', tickformat: ',' },
                    legend: legendBelow(isMobile),
                    margin: stackedBarMargin(isMobile),
                    ...unifiedStackHover(),
                  }}
                />
                <p className="text-caption text-text-muted mb-0 mt-2">
                  Filed during {report.label} · {COHORT_FOLLOW_UP_DAYS}-day follow-up · bar height = total filed · hover for %
                </p>
              </>
            ) : (
              <p className="text-caption text-text-muted mb-0">No requests filed this month.</p>
            )}
          </ChartPanel>
        </div>
      </SectionCard>

      <SectionCard title="Ward breakdown" subtitle="Requests and resolution rate by ward" defaultOpen>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ChartPanel>
            <DeferredChart minHeight={300}>
              <PlotlyChart
                data={[
                  {
                    x: wardBreakdown.map((w) => w.ward),
                    y: wardBreakdown.map((w) => w.filed - w.resolved),
                    name: 'Open / In-Progress',
                    type: 'bar' as const,
                    marker: { color: colors.danger },
                    hovertemplate: '%{y:,}<extra></extra>',
                  },
                  {
                    x: wardBreakdown.map((w) => w.ward),
                    y: wardBreakdown.map((w) => w.resolved),
                    name: 'Resolved',
                    type: 'bar' as const,
                    marker: { color: colors.success },
                    hovertemplate: '%{y:,}<extra></extra>',
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
                  ...unifiedStackHover(),
                }}
              />
            </DeferredChart>
          </ChartPanel>
          <ChartPanel>
            <DeferredChart minHeight={300}>
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
                  hovertemplate: '<b>%{x}</b><br>%{y:.1f}% resolved<extra></extra>',
                }]}
                layout={{
                  height: isMobile ? 300 : 340,
                  title: chartTitle('% resolved by ward'),
                  xaxis: { title: 'Ward' },
                  yaxis: { title: '% Resolved', range: [0, 110] },
                  margin: { t: 56, b: 40, l: 50, r: 20 },
                }}
              />
            </DeferredChart>
          </ChartPanel>
        </div>
      </SectionCard>
    </div>
  );
}
