import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRollupTimeline } from '../../api/data';
import { useDashboard } from '../../context/DashboardContext';
import { useTrackArticleView } from '../../hooks/useTrackArticleView';
import { useIsDesktop, useIsMobile } from '../../hooks/useBreakpoint';
import {
  capChartHeight,
  chartTitle,
  hBarMargin,
  legendBelow,
} from '../../lib/responsiveChartLayout';
import { plotlyAxisTickFont, plotlyAxisTitleFont } from '../../lib/theme';
import { slaCategorySummary } from '../../lib/dataProcessing';
import {
  buildCategoryArticle,
  computeCategoryMonthlySlaFromRollups,
  computeCherryPickSensitivity,
  computeMonthlySlaSummary,
  computeMonthlyThroughput,
  computeOverviewHeadline,
  computeWardEquitySummary,
  findInvestigativeDeepDive,
  findSloPitfalls,
  orderCategoryMonthlySla,
  selectComplianceComparisonCases,
  selectPerceptibilityChartCategories,
} from '../../lib/overviewAnalytics';
import { mergeSlaRollups } from '../../lib/rollups';
import {
  complianceVsResolvedChart,
  monthlyThroughputChart,
  slaCategorySummaryChart,
  slaCategoryVolumeMarkerSize,
  sloPitfallScatter,
} from '../../lib/charts';
import CategorySlaTimelines from '../sla/CategorySlaTimelines';
import ChartPanel from '../shared/ChartPanel';
import DeferredChart from '../shared/DeferredChart';
import ArticleFigure from './ArticleFigure';
import CategoryArticleSection from './CategoryArticleSection';
import SlaComplianceSummary from './SlaComplianceSummary';

export default function OverviewTab() {
  const {
    data: dashboardData,
    setDatePreset,
    setActiveTab,
    isLoading,
  } = useDashboard();
  const isBentoWide = useIsDesktop();
  const isMobile = useIsMobile();
  const throughputSectionRef = useTrackArticleView('throughput');
  const readingMetricsSectionRef = useTrackArticleView('reading_metrics');

  // Overview always uses the full-year timeline regardless of the active preset.
  // Use already-loaded rollups when all shards are present; otherwise fetch the full set.
  const allShardCount = dashboardData?.manifest.shards.length ?? 0;
  const hasFullTimeline = (dashboardData?.monthlyRollups.length ?? 0) >= allShardCount;

  const { data: fetchedTimeline, isLoading: timelineLoading } = useQuery({
    queryKey: ['rollupTimeline'],
    queryFn: fetchRollupTimeline,
    enabled: !hasFullTimeline,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const timelineRollups = hasFullTimeline
    ? dashboardData?.monthlyRollups
    : fetchedTimeline;

  const dicts = dashboardData?.manifest.dictionaries;

  const monthly = useMemo(
    () => (timelineRollups ? computeMonthlySlaSummary(timelineRollups) : []),
    [timelineRollups],
  );

  const headline = useMemo(
    () => (timelineRollups ? computeOverviewHeadline(timelineRollups) : null),
    [timelineRollups],
  );

  const throughput = useMemo(
    () => (timelineRollups ? computeMonthlyThroughput(timelineRollups) : []),
    [timelineRollups],
  );

  const slaRows = useMemo(
    () => (timelineRollups && dicts ? mergeSlaRollups(timelineRollups, dicts) : []),
    [timelineRollups, dicts],
  );

  const catSummary = useMemo(() => slaCategorySummary(slaRows), [slaRows]);

  const categoryMonthly = useMemo(() => {
    if (!timelineRollups || slaRows.length === 0 || !dicts) return [];
    const eligibleTypes = new Set(slaRows.map((row) => row.SERVICECODEDESCRIPTION));
    return computeCategoryMonthlySlaFromRollups(timelineRollups, dicts, eligibleTypes);
  }, [timelineRollups, slaRows, dicts]);

  const perceptibilityChartCategories = useMemo(
    () => selectPerceptibilityChartCategories(catSummary),
    [catSummary],
  );

  const perceptibilityMonthly = useMemo(
    () => orderCategoryMonthlySla(categoryMonthly, perceptibilityChartCategories),
    [categoryMonthly, perceptibilityChartCategories],
  );

  const categoriesBelow95Count = useMemo(
    () => catSummary.filter((c) => c.pct_met_sla < 95).length,
    [catSummary],
  );

  const wardEquity = useMemo(
    () => (timelineRollups && dicts ? computeWardEquitySummary(timelineRollups, dicts) : null),
    [timelineRollups, dicts],
  );

  const categoryArticle = useMemo(
    () => buildCategoryArticle(catSummary, slaRows, wardEquity),
    [catSummary, slaRows, wardEquity],
  );

  const pitfalls = useMemo(() => findSloPitfalls(slaRows), [slaRows]);
  const cherryPick = useMemo(() => computeCherryPickSensitivity(slaRows), [slaRows]);
  const deepDive = useMemo(
    () => (timelineRollups && dicts ? findInvestigativeDeepDive(timelineRollups, dicts) : null),
    [timelineRollups, dicts],
  );

  const throughputChart = useMemo(() => monthlyThroughputChart(throughput), [throughput]);

  const catChartHeight = useMemo(
    () => capChartHeight(
      Math.max(320, catSummary.length * 28 + 80),
      isMobile,
      Math.max(360, catSummary.length * 26 + 80),
    ),
    [catSummary.length, isMobile],
  );

  const categoryChartMargin = useMemo(
    () => (isBentoWide
      ? { t: 56, b: 56, l: 200, r: 48 }
      : { ...hBarMargin(isMobile), t: 40, b: 56, r: 24 }),
    [isBentoWide, isMobile],
  );

  const catMarkerSize = useMemo(
    () => slaCategoryVolumeMarkerSize(
      catSummary.length,
      catChartHeight,
      categoryChartMargin.t,
      categoryChartMargin.b,
    ),
    [catSummary.length, catChartHeight, categoryChartMargin],
  );

  const catChart = useMemo(
    () => slaCategorySummaryChart(catSummary, { markerSize: catMarkerSize }),
    [catSummary, catMarkerSize],
  );

  const slaCategoryArticleData = useMemo(() => {
    const traces = isBentoWide
      ? [...catChart.bars, ...catChart.volumeLines, ...catChart.scatter]
      : [...catChart.bars];
    return traces.map((trace) => {
      if (trace.type !== 'bar') return trace;
      return { ...trace, textposition: 'none' as const, text: undefined };
    });
  }, [catChart, isBentoWide]);

  const pitfallScatterData = useMemo(
    () => slaRows
      .filter((r) => r.total >= 50)
      .map((r) => ({
        serviceType: r.SERVICECODEDESCRIPTION,
        slaDays: r.sla_days,
        pctMetSla: r.pct_met_sla,
        pctResolved: r.pct_resolved,
        total: r.total,
      })),
    [slaRows],
  );

  const pitfallScatter = useMemo(
    () => sloPitfallScatter(pitfallScatterData),
    [pitfallScatterData],
  );

  const complianceComparisonCases = useMemo(
    () => selectComplianceComparisonCases(slaRows),
    [slaRows],
  );

  const divergenceChart = useMemo(
    () => complianceVsResolvedChart(complianceComparisonCases),
    [complianceComparisonCases],
  );

  const handleTabNavigate = (tab: 'sla' | 'explorer') => {
    setDatePreset('full');
    setActiveTab(tab);
  };

  if (isLoading || timelineLoading || !timelineRollups || !headline) {
    return (
      <div className="p-4 flex items-center space-x-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
        <span className="text-sm text-text-muted">Loading overview…</span>
      </div>
    );
  }

  const throughputHeight = capChartHeight(360, !isBentoWide);

  const slaCategoryChartLayout: Record<string, unknown> = {
    height: catChartHeight,
    margin: categoryChartMargin,
    title: chartTitle('% met SLA by category'),
    xaxis: {
      title: { text: '% Met SLA', font: plotlyAxisTitleFont, standoff: 14 },
      range: [0, 115],
      tickfont: plotlyAxisTickFont,
    },
    yaxis: {
      title: '',
      automargin: true,
      tickfont: { ...plotlyAxisTickFont, size: 10 },
      categoryorder: 'array' as const,
      categoryarray: catChart.categories,
    },
    legend: { ...legendBelow(!isBentoWide, -0.12), tracegroupgap: 4 },
    shapes: [
      { type: 'line' as const, x0: 99, x1: 99, y0: 0, y1: 1, yref: 'paper' as const, line: { color: '#2ecc71', width: 1, dash: 'dot' as const }, opacity: 0.6 },
      { type: 'line' as const, x0: 95, x1: 95, y0: 0, y1: 1, yref: 'paper' as const, line: { color: '#e67e22', width: 1, dash: 'dot' as const }, opacity: 0.6 },
    ],
    ...(isBentoWide
      ? {
          xaxis2: {
            title: { text: 'Total Requests', font: plotlyAxisTitleFont, standoff: 10 },
            range: catChart.volumeAxisRange,
            overlaying: 'x',
            side: 'top',
            showgrid: false,
            tickformat: ',',
            tick0: 0,
            tickfont: plotlyAxisTickFont,
          },
        }
      : {}),
  };

  const throughputLayout: Record<string, unknown> = {
    height: throughputHeight,
    margin: { t: 56, b: 80, l: 56, r: 24 },
    title: chartTitle('Requests filed and resolved by month'),
    barmode: 'overlay',
    xaxis: { title: '', tickangle: -45 },
    yaxis: { title: 'Requests', tickformat: ',' },
    legend: legendBelow(true),
  };

  return (
    <div className="w-full">
      <SlaComplianceSummary
        pctMetSla={headline.pctMetSla}
        failures={headline.failures}
        errorBudgetAt99={headline.errorBudgetAt99}
        months={monthly}
        categoriesBelow95Count={categoriesBelow95Count}
        totalCategoryCount={catSummary.length}
      />

      <section ref={throughputSectionRef} className="article-section article-prose">
        <h2 className="article-headline">The weight of half a million requests</h2>
        <p className="article-dek">
          {headline.total.toLocaleString()} requests filed in twelve months. {headline.open.toLocaleString()} still open.
        </p>

        <DeferredChart minHeight={300}>
          <ArticleFigure
            caption="Requests filed (bars) and resolved (line) per month. The gap between them is the backlog accumulating or clearing."
            data={throughputChart.traces}
            layout={throughputLayout}
          />
        </DeferredChart>

        <p>
          DC residents filed {headline.total.toLocaleString()} 311 requests over the past year: broken sidewalks,
          missed collections, bus stops, bike infrastructure, and more. {headline.open.toLocaleString()} of them
          remain unresolved. The city closed {headline.pctResolved}% within the window. The rest are still waiting.
        </p>
        <p>
          At this volume, failures are inevitable. Where they concentrate and who bears them is the more useful question.
        </p>
      </section>

      <DeferredChart minHeight={catChartHeight}>
        <div className="article-section !py-0">
          <CategoryArticleSection
            article={categoryArticle}
            chartData={slaCategoryArticleData}
            chartLayout={slaCategoryChartLayout}
            chartRemountKey={isBentoWide ? 'wide' : 'stacked'}
            onNavigate={handleTabNavigate}
            embedded
            trackId="category_breakdown"
          />
        </div>
      </DeferredChart>

      <section ref={readingMetricsSectionRef} className="article-section article-prose">
        <h2 className="article-headline">Reading the metrics</h2>
        <p className="article-dek">
          What gets measured, what doesn&apos;t, and where the numbers mislead.
        </p>

        <p>
          This project measures deadline compliance: whether DC resolved a 311 request by its promised{' '}
          <code className="font-mono text-sm bg-surface-muted px-1 rounded">SERVICEDUEDATE</code>.
          A failure means the city missed its own deadline, resolved late or still open past the due date.
          Across {headline.total.toLocaleString()} requests over twelve months, the data shows{' '}
          {headline.failures.toLocaleString()} known failures. This does not measure response time, fix quality,
          or resident satisfaction.
        </p>

        <h3 className="font-semibold text-gray-900 mt-5 mb-2">Why 99% and 95%?</h3>

        <div className="article-body">
          <p>
            These bands measure whether people can tell that something is wrong.
          </p>
          <p>
            At 99% compliance, one request in a hundred misses its deadline. Failures happen, but they are diffuse.
            No single resident sees a pattern, and the system does not feel broken.
          </p>
          <p>
            The line at 95% is where failure becomes perceptible. One in twenty requests misses its promised{' '}
            <code className="font-mono text-sm bg-surface-muted px-1 rounded">SERVICEDUEDATE</code>.
            Among ten people on the same block who filed this year, there is a real chance one of them is still waiting
            past the city&apos;s own deadline. That is enough for people to start comparing experiences.
          </p>

          {perceptibilityMonthly.length > 0 && (
            <figure className="article-figure article-figure-float article-figure-float-mid">
              <ChartPanel className="article-figure-panel !p-3 sm:!p-4">
                <CategorySlaTimelines categories={perceptibilityMonthly} detailMode="compact" />
              </ChartPanel>
              <figcaption>
                % met SLA by month for select categories. Green, orange, and red track the 99% and 95% thresholds;
                high performers alongside everyday resident priorities where failures are perceptible.
              </figcaption>
            </figure>
          )}

          <p>
            Below 95%, trust erodes. Residents doubt that reporting a problem leads to a fix. Filing slows, duplicates
            increase, and council offices field calls the system should have handled. The compliance number may still look
            passable, but residents experience something worse.
          </p>
          <p>
            The green, orange, and red on the timeline track that progression: whether failure is invisible, perceptible,
            or undermining the people who depend on the system.
          </p>
        </div>

        <p>
          Tickets without a due date are excluded from failure counts. Each month measures requests filed that month,
          not resolution throughput. Seasonal spikes in storms and leaf collection move both volume and compliance at
          the same time.
        </p>

        <h3 className="font-semibold text-gray-900 mt-5 mb-2">When metrics mislead</h3>

        <p>
          Headline compliance is {cherryPick.headlinePct}%. Remove the three highest-volume service types and it
          shifts to {cherryPick.withoutTop3Pct}%, a {cherryPick.delta >= 0 ? '+' : ''}{cherryPick.delta} point
          swing driven by {cherryPick.top3Types.join(', ')}. Citywide averages can mask category-level strain and
          ward-level spread.
        </p>

        {deepDive && (
          <blockquote className="article-pullquote">{deepDive.narrative}</blockquote>
        )}

        <DeferredChart minHeight={320}>
          <div className="grid md:grid-cols-2 gap-3 my-3">
            <ArticleFigure
              caption="SLA days vs. % met SLA. Bubble size is volume, color is % resolved. The top-right cluster shows long deadlines with high compliance, often masking open backlog."
              data={pitfallScatter.traces}
              layout={{
                height: 340,
                margin: { t: 56, b: 56, l: 56, r: 80 },
                title: chartTitle('SLA days vs. % met SLA'),
                xaxis: { title: 'SLA days', type: 'log' },
                yaxis: { title: '% Met SLA', range: [0, 105] },
              }}
            />
            {complianceComparisonCases.length > 0 && (
              <ArticleFigure
                caption="Service types where headline compliance, resolution rate, and closed-only compliance diverge. Top rows show the illusion; bottom rows show types where all three track together."
                data={divergenceChart.traces}
                layout={{
                  barmode: 'group',
                  height: Math.max(300, complianceComparisonCases.length * 42 + 88),
                  margin: { t: 56, b: 40, l: 200, r: 24 },
                  title: chartTitle('Compliance vs. resolution'),
                  xaxis: { title: '%', range: [0, 110] },
                  yaxis: { title: '', automargin: true },
                  legend: legendBelow(true),
                }}
              />
            )}
          </div>
        </DeferredChart>

        {pitfalls.length > 0 && (
          <p>
            {pitfalls.slice(0, 3).map((p) => `${p.serviceType}: ${p.commentary}`).join(' ')}
          </p>
        )}
      </section>
    </div>
  );
}
