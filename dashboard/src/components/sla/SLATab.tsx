import { useState, useMemo, ReactNode } from 'react';
import type { Data } from 'plotly.js';
import { useDashboard } from '../../context/DashboardContext';
import { slaTableData, slaCategorySummary } from '../../lib/dataProcessing';
import { hasSlaFilters } from '../../lib/rollups';
import { EMPTY_SLA_FILTERS, filterSlaRows } from '../../lib/filterTypes';
import { useIsMobile, useIsDesktop } from '../../hooks/useBreakpoint';
import {
  capChartHeight,
  chartTitle,
  hBarMargin,
  legendBelow,
  legendAbovePlot,
  mapLegend,
  mapMargin,
  mapSectionHeight,
} from '../../lib/responsiveChartLayout';
import PlotlyChart from '../shared/PlotlyChart';
import DeferredChart from '../shared/DeferredChart';
import ChartPanel from '../shared/ChartPanel';
import MetricStack from '../shared/MetricStack';
import ScrollHint from '../shared/ScrollHint';
import SectionCard from '../shared/SectionCard';
import SlaFilterBar from '../shared/filters/SlaFilterBar';
import StatusBadge, { slaMetBadge } from '../shared/StatusBadge';
import { slaCategorySummaryChart, slaCategoryVolumeMarkerSize, slaFailuresChart, slaResolutionByTypeChart, slaStatusMapChart } from '../../lib/charts';
import { computeCategoryMonthlySlaSummary, computeCategoryMonthlySlaFromRollups, slaScoreColor } from '../../lib/overviewAnalytics';
import CategorySlaTimelines from './CategorySlaTimelines';

type SlaRow = ReturnType<typeof slaTableData>[number];

interface SlaColumn {
  header: string;
  className?: string;
  title?: string;
  cell: (row: SlaRow) => ReactNode;
}

export default function SLATab() {
  const { data: dashboardData } = useDashboard();
  const processed = dashboardData?.rows;
  const isMobile = useIsMobile();
  const isBentoWide = useIsDesktop();

  const [filters, setFilters] = useState(EMPTY_SLA_FILTERS);
  const [slaPage, setSlaPage] = useState(0);
  const slaPageSize = 25;

  const filteredProcessed = useMemo(() => {
    if (!processed || processed.length === 0) return [];
    return filterSlaRows(processed, filters);
  }, [processed, filters]);

  const useRollups = dashboardData?.rollups && !hasSlaFilters(
    filters.categories, filters.serviceTypes, filters.agencies, filters.wards,
  );

  const slaData = useMemo(() => {
    if (useRollups && dashboardData?.rollups) return dashboardData.rollups.sla;
    return slaTableData(filteredProcessed);
  }, [useRollups, dashboardData?.rollups, filteredProcessed]);
  const catSummary = useMemo(() => slaCategorySummary(slaData), [slaData]);

  const categoryMonthly = useMemo(() => {
    const eligibleTypes = new Set(slaData.map((row) => row.SERVICECODEDESCRIPTION));
    const dicts = dashboardData?.manifest.dictionaries;
    const byCategory = useRollups && dashboardData?.monthlyRollups && dicts
      ? computeCategoryMonthlySlaFromRollups(dashboardData.monthlyRollups, dicts, eligibleTypes)
      : computeCategoryMonthlySlaSummary(
          filteredProcessed.filter((row) => eligibleTypes.has(row.SERVICECODEDESCRIPTION)),
        );
    const order = new Map(catSummary.map((c, i) => [c.category, i]));
    return byCategory
      .filter((row) => order.has(row.category))
      .sort((a, b) => (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0));
  }, [filteredProcessed, slaData, catSummary, useRollups, dashboardData?.monthlyRollups, dashboardData?.manifest.dictionaries]);

  const kpis = useMemo(() => {
    const totalReqs = slaData.reduce((sum, row) => sum + row.total, 0);
    const totalFailures = slaData.reduce((sum, row) => sum + row.missed_sla_count + row.open_past_sla_count, 0);
    const overallPct = totalReqs > 0 ? Math.round(((totalReqs - totalFailures) / totalReqs) * 100 * 10) / 10 : 0;
    const medianRes = slaData.length > 0 ? Math.round(slaData.reduce((sum, row) => sum + row.median_resolution, 0) / slaData.length * 10) / 10 : 0;
    return { totalReqs, totalFailures, overallPct, medianRes };
  }, [slaData]);

  const catChartHeight = useMemo(
    () => capChartHeight(Math.max(320, catSummary.length * 40 + 80), !isBentoWide),
    [catSummary.length, isBentoWide],
  );

  const catMarkerSize = useMemo(
    () => slaCategoryVolumeMarkerSize(
      catSummary.length,
      catChartHeight,
      isBentoWide ? 72 : 56,
      isBentoWide ? 68 : 68,
    ),
    [catSummary.length, catChartHeight, isBentoWide],
  );

  const catChart = useMemo(
    () => slaCategorySummaryChart(catSummary, { markerSize: catMarkerSize }),
    [catSummary, catMarkerSize],
  );
  const failuresChart = useMemo(() => slaFailuresChart(slaData), [slaData]);
  const resolutionChart = useMemo(
    () => slaResolutionByTypeChart(filteredProcessed, slaData),
    [filteredProcessed, slaData],
  );
  const slaMap = useMemo(
    () => slaStatusMapChart(filteredProcessed, slaData),
    [filteredProcessed, slaData],
  );

  const slaColumns: SlaColumn[] = useMemo(() => [
    { header: 'Service Type', cell: (row) => row.SERVICECODEDESCRIPTION },
    {
      header: '% Met SLA',
      title: 'Share of requests resolved on time or still within their deadline. (total − resolved late − open & overdue) ÷ total.',
      cell: (row) => {
        const badge = slaMetBadge(row.pct_met_sla);
        return <StatusBadge label={badge.label} tone={badge.tone} />;
      },
    },
    { header: 'Total Requests', cell: (row) => row.total },
    { header: 'Category', className: 'hidden md:table-cell', cell: (row) => row.category },
    { header: 'Agency', className: 'hidden lg:table-cell', cell: (row) => row.agency || '—' },
    { header: 'SLA (days)', className: 'hidden lg:table-cell', cell: (row) => row.sla_days },
    { header: 'Closed', className: 'hidden lg:table-cell', cell: (row) => row.closed },
    { header: 'Resolved Within SLA', className: 'hidden xl:table-cell', cell: (row) => row.met_sla_count },
    { header: 'Resolved Late', className: 'hidden xl:table-cell', cell: (row) => row.missed_sla_count },
    {
      header: 'Open & Overdue',
      className: 'hidden xl:table-cell',
      title: 'Requests still open past their promised deadline. These count as failures.',
      cell: (row) => row.open_past_sla_count,
    },
    { header: '% Resolved', className: 'hidden md:table-cell', cell: (row) => `${row.pct_resolved}%` },
    {
      header: 'Median Resolution (days)',
      className: 'hidden lg:table-cell',
      title: 'The middle resolution time across closed tickets for a service type. Half resolved faster, half slower.',
      cell: (row) => row.median_resolution,
    },
    {
      header: 'P99 Resolution (days)',
      className: 'hidden xl:table-cell',
      title: 'The resolution time at the 99th percentile. Only 1% of tickets took longer. Useful for spotting outliers.',
      cell: (row) => row.p99_resolution,
    },
  ], []);

  if (!processed || processed.length === 0) {
    return (
      <div className="p-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
          <h3 className="font-semibold text-yellow-800 mb-2">No data available</h3>
          <p className="text-yellow-600 text-sm">No records in the selected date range.</p>
        </div>
      </div>
    );
  }

  const { totalReqs, totalFailures, overallPct, medianRes } = kpis;
  const overallScoreColor = slaScoreColor(overallPct);
  const failuresHeight = capChartHeight(
    Math.max(200, failuresChart.labels.length * 28 + 72),
    isMobile,
  );
  const barMargin = hBarMargin(isMobile);
  const failuresMargin = isMobile
    ? { t: 72, b: 28, l: 100, r: 20 }
    : { t: 72, b: 28, l: 280, r: 24 };

  const resolutionChartData = (resolutionChart.hasData
    ? isMobile
      ? (resolutionChart.heatmap ?? [])
      : (resolutionChart.heatmap && resolutionChart.sidebar
        ? [...resolutionChart.heatmap, ...resolutionChart.sidebar]
        : (resolutionChart.heatmap ?? []))
    : []) as unknown as Data[];

  const resolutionChartLayout: Record<string, unknown> = {
    height: capChartHeight(resolutionChart.height ?? 450, isMobile),
    margin: isMobile ? barMargin : { t: 56, b: 68, l: 220, r: 48 },
    title: chartTitle(isMobile ? 'Time to resolve heatmap' : 'Time to resolve heatmap · right bar = % met SLA'),
    xaxis: { title: 'Days to resolve', domain: isMobile ? [0, 1] : [0, 0.82] },
    yaxis: { title: '', automargin: true },
    barmode: 'overlay',
    shapes: resolutionChart.shapes,
    annotations: resolutionChart.annotations,
    ...(isMobile
      ? {}
      : {
          xaxis2: { title: '% Met SLA', range: [0, 110], domain: [0.84, 1], showgrid: false },
        }),
  };

  const slaCategoryChartData = isBentoWide
    ? [...catChart.bars, ...catChart.volumeLines, ...catChart.scatter]
    : [...catChart.bars];

  const slaCategoryChartLayout: Record<string, unknown> = {
    height: catChartHeight,
    autosize: true,
    margin: isBentoWide
      ? { t: 72, b: 68, l: 220, r: 48 }
      : { ...barMargin, r: 48 },
    title: chartTitle('% met SLA by category'),
    xaxis: { title: '% Met SLA', range: [0, 115] },
    yaxis: { title: '', automargin: true, categoryorder: 'array' as const, categoryarray: catChart.categories },
    legend: legendBelow(!isBentoWide),
    shapes: [
      { type: 'line' as const, x0: 99, x1: 99, y0: 0, y1: 1, yref: 'paper' as const, line: { color: '#2ecc71', width: 1, dash: 'dot' as const }, opacity: 0.6 },
      { type: 'line' as const, x0: 95, x1: 95, y0: 0, y1: 1, yref: 'paper' as const, line: { color: '#e67e22', width: 1, dash: 'dot' as const }, opacity: 0.6 },
    ],
    ...(isBentoWide
      ? { xaxis2: { title: 'Total Requests', range: catChart.volumeAxisRange, overlaying: 'x', side: 'top', showgrid: false, tickformat: ',', tick0: 0 } }
      : {}),
  };

  return (
    <div>
      <p className="prose-paragraph mb-1">
        How often does DC meet its promised 311 deadlines? Compliance, resolution time, and failures by category and service type.
      </p>
      <p className="font-mono text-caption text-text-muted mb-2">
        % Met SLA = (total − resolved late − open & overdue) ÷ total
      </p>

      <SlaFilterBar rows={processed} filters={filters} onChange={setFilters} />

      <SectionCard
        title="Overview"
        subtitle={`${overallPct}% met SLA · ${totalReqs.toLocaleString()} requests`}
        defaultOpen
      >
        <div className="grid lg:grid-cols-12 gap-3 items-start mb-3">
          <div className="lg:col-span-9 min-w-0">
            <CategorySlaTimelines categories={categoryMonthly} />
          </div>
          <div className="lg:col-span-3 min-w-0">
            <MetricStack
              items={[
                {
                  label: 'Overall % Met SLA',
                  value: `${overallPct}%`,
                  color: overallScoreColor,
                  title: 'Share of requests resolved on time or still within their deadline. (total − resolved late − open & overdue) ÷ total.',
                },
                {
                  label: 'Known SLA Failures',
                  value: totalFailures.toLocaleString(),
                  tone: 'danger',
                  title: 'Requests resolved after their deadline plus requests still open past their deadline.',
                },
                { label: 'Total Requests', value: totalReqs.toLocaleString() },
                {
                  label: 'Median Resolution',
                  value: `${medianRes} days`,
                  title: 'The middle resolution time across closed tickets for a service type. Half resolved faster, half slower.',
                },
              ]}
            />
          </div>
        </div>
        <div className="-mx-4">
          <ChartPanel className="rounded-none border-x-0 shadow-none">
            <PlotlyChart
              data={slaCategoryChartData}
              layout={slaCategoryChartLayout}
              remountKey={isBentoWide ? 'wide' : 'stacked'}
            />
          </ChartPanel>
        </div>
      </SectionCard>

      <SectionCard title="Resolution by service type" subtitle="Time to resolve vs % met SLA" defaultOpen>
        <DeferredChart minHeight={300}>
          {resolutionChart.hasData ? (
            <ChartPanel>
              <PlotlyChart
                data={resolutionChartData}
                layout={resolutionChartLayout}
                remountKey={isMobile ? 'stacked' : 'wide'}
              />
            </ChartPanel>
          ) : (
            <p className="text-xs text-text-muted">Insufficient data for chart</p>
          )}
        </DeferredChart>
      </SectionCard>

      <SectionCard
        title="SLA status map"
        subtitle={`${filteredProcessed.length.toLocaleString()} requests · geographic SLA outcomes`}
        defaultOpen
      >
        <DeferredChart minHeight={mapSectionHeight(isMobile)}>
          {slaMap.hasData ? (
            <div className="-mx-4 -mt-3 -mb-4">
              <PlotlyChart
                data={slaMap.traces || []}
                layout={{
                  autosize: true,
                  height: mapSectionHeight(isMobile),
                  margin: mapMargin(isMobile),
                  map: { style: 'carto-positron', center: { lat: 38.907, lon: -77.037 }, zoom: 11 },
                  legend: mapLegend(isMobile),
                }}
                config={{}}
              />
            </div>
          ) : (
            <p className="text-xs text-text-muted">No data matches current filters</p>
          )}
        </DeferredChart>
      </SectionCard>

      <SectionCard title="SLA by service type" subtitle={`${slaData.length} service types`} defaultOpen variant="mono">
        <ScrollHint />
        <div className="overflow-x-auto max-h-[480px] scrollbar-thin">
          <table className="w-full text-sm font-mono">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-muted">
                {slaColumns.map((col) => (
                  <th
                    key={col.header}
                    className={`px-3 py-2 text-left font-semibold whitespace-nowrap ${col.className ?? ''}`}
                    title={col.title}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slaData.slice(slaPage * slaPageSize, (slaPage + 1) * slaPageSize).map((row, idx) => (
                <tr key={row.SERVICECODEDESCRIPTION} className={idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/50'}>
                  {slaColumns.map((col) => (
                    <td key={col.header} className={`px-3 py-2 whitespace-nowrap ${col.className ?? ''}`}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {slaData.length > slaPageSize && (
          <div className="flex justify-between items-center mt-3 px-2">
            <button onClick={() => setSlaPage(Math.max(0, slaPage - 1))} disabled={slaPage === 0} className="min-h-[44px] px-3 py-2 text-sm border rounded disabled:opacity-50">Previous</button>
            <span className="text-sm text-gray-600">Page {slaPage + 1} of {Math.ceil(slaData.length / slaPageSize)}</span>
            <button onClick={() => setSlaPage(Math.min(Math.ceil(slaData.length / slaPageSize) - 1, slaPage + 1))} disabled={slaPage >= Math.ceil(slaData.length / slaPageSize) - 1} className="min-h-[44px] px-3 py-2 text-sm border rounded disabled:opacity-50">Next</button>
          </div>
        )}
      </SectionCard>

      <SectionCard title="SLA failures" subtitle="Resolved late and open & overdue by service type" defaultOpen>
        <DeferredChart minHeight={failuresHeight}>
          <ChartPanel>
            <PlotlyChart
              data={[...failuresChart.missed, ...failuresChart.overdue]}
              layout={{
                barmode: 'stack' as const,
                height: failuresHeight,
                title: chartTitle('Resolved late + open & overdue'),
                xaxis: { title: 'Failures' },
                yaxis: { title: '', automargin: true },
                margin: failuresMargin,
                legend: legendAbovePlot(),
              }}
            />
          </ChartPanel>
        </DeferredChart>
      </SectionCard>
    </div>
  );
}
