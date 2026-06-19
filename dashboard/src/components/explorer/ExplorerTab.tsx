import { useMemo, useState, useCallback } from 'react';
import type { Data } from 'plotly.js';
import { useDashboard } from '../../context/DashboardContext';
import { filterExplorerRows, EMPTY_EXPLORER_FILTERS, ExplorerFilterState, summarizeExplorerFilterDimensions } from '../../lib/filterTypes';
import { trackFilterChange } from '../../lib/analytics';
import { useTrackFilterTabPageView } from '../../hooks/useTrackFilterTabPageView';
import { useIsMobile, useIsDesktop } from '../../hooks/useBreakpoint';
import {
  capChartHeight,
  chartTitle,
  hBarMargin,
  legendBelow,
  mapLegend,
  mapMargin,
  mapSectionHeight,
  pieMargin,
  serviceTypeChartMargin,
  serviceTypeLegend,
  stackedBarMargin,
} from '../../lib/responsiveChartLayout';
import PlotlyChart from '../shared/PlotlyChart';
import DeferredChart from '../shared/DeferredChart';
import ChartPanel from '../shared/ChartPanel';
import StatRow from '../shared/StatRow';
import ExplorerFilterBar from '../shared/filters/ExplorerFilterBar';
import SectionCard from '../shared/SectionCard';
import { CATEGORICAL_COLORS } from '../../lib/theme';
import { hasExplorerFilters } from '../../lib/rollups';
import {
  getCategoryOrder,
  explorerCategoryBreakdown,
  explorerDayOfWeek,
  explorerAgeHistogram,
  explorerResolutionHistogram,
  explorerCountByType,
  explorerWardVolume,
  explorerWardResolution,
  explorerWardHeatmap,
  weeklyVolumeChartData,
  explorerMapChart,
} from '../../lib/charts';

const CAT_PALETTE = [...CATEGORICAL_COLORS];
const DOW_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function ExplorerTab() {
  const { data: dashboardData } = useDashboard();
  const [filters, setFilters] = useState<ExplorerFilterState>(EMPTY_EXPLORER_FILTERS);
  const processed = dashboardData?.rows;
  const isMobile = useIsMobile();
  const isBentoWide = useIsDesktop();

  const handleFilterChange = useCallback((next: ExplorerFilterState) => {
    setFilters((prev) => {
      trackFilterChange(
        'explorer',
        summarizeExplorerFilterDimensions(prev),
        summarizeExplorerFilterDimensions(next),
      );
      return next;
    });
  }, []);

  const filterSummary = summarizeExplorerFilterDimensions(filters);
  useTrackFilterTabPageView('explorer', filterSummary);

  const filtered = useMemo(() => {
    if (!processed) return [];
    return filterExplorerRows(processed, filters);
  }, [processed, filters]);

  const useRollups = dashboardData?.rollups && !hasExplorerFilters(
    filters.categories, filters.serviceTypes, filters.wards, filters.status,
  );
  const rollups = dashboardData?.rollups;

  const rollupKpis = useMemo(() => {
    if (!rollups) return null;
    const total = rollups.totalRows;
    const openCount = rollups.categoryBreakdown.reduce((s, c) => s + c.open, 0);
    const resolved = rollups.categoryBreakdown.reduce((s, c) => s + c.resolved, 0);
    const pctResolved = total > 0 ? Math.round((resolved / total) * 100 * 10) / 10 : 0;
    const closedWithResolution = filtered.filter((r) => r.is_closed && r.resolution_days !== null);
    const medianRes = closedWithResolution.length > 0
      ? Math.round(closedWithResolution.map((r) => r.resolution_days!).sort((a, b) => a - b)[Math.floor(closedWithResolution.length / 2)] * 10) / 10
      : 0;
    return { total, openCount, pctResolved, medianRes };
  }, [rollups, filtered]);

  const kpis = useMemo(() => {
    if (useRollups && rollupKpis) return rollupKpis;
    const total = filtered.length;
    const openCount = filtered.filter((r) => r.is_open).length;
    const pctResolved = total > 0 ? Math.round((filtered.filter((r) => r.is_closed).length / total) * 100 * 10) / 10 : 0;
    const closedWithResolution = filtered.filter((r) => r.is_closed && r.resolution_days !== null);
    const medianRes = closedWithResolution.length > 0
      ? Math.round(closedWithResolution.map((r) => r.resolution_days!).sort((a, b) => a - b)[Math.floor(closedWithResolution.length / 2)] * 10) / 10
      : 0;
    return { total, openCount, pctResolved, medianRes };
  }, [useRollups, rollupKpis, filtered]);

  const catOrder = useMemo(() => {
    if (useRollups && rollups) return rollups.categoryBreakdown.map((c) => c.category);
    return getCategoryOrder(filtered);
  }, [useRollups, rollups, filtered]);

  const catBreakdown = useMemo(() => {
    if (useRollups && rollups) return rollups.categoryBreakdown;
    return explorerCategoryBreakdown(filtered);
  }, [useRollups, rollups, filtered]);

  const dowData = useMemo(() => {
    if (useRollups && rollups) return rollups.dayOfWeek;
    return explorerDayOfWeek(filtered);
  }, [useRollups, rollups, filtered]);

  const ageHist = useMemo(() => explorerAgeHistogram(filtered), [filtered]);
  const resHist = useMemo(() => explorerResolutionHistogram(filtered), [filtered]);

  const countByType = useMemo(() => {
    if (useRollups && rollups) return rollups.countByType;
    return explorerCountByType(filtered);
  }, [useRollups, rollups, filtered]);

  const wardVol = useMemo(() => {
    if (useRollups && rollups) return rollups.wardVolume;
    return explorerWardVolume(filtered);
  }, [useRollups, rollups, filtered]);

  const wardRes = useMemo(() => {
    if (useRollups && rollups) return rollups.wardResolution;
    return explorerWardResolution(filtered);
  }, [useRollups, rollups, filtered]);

  const wardHeat = useMemo(() => explorerWardHeatmap(filtered), [filtered]);
  const weeklyVol = useMemo(() => {
    if (useRollups && rollups) return rollups.weeklyVolume;
    return weeklyVolumeChartData(filtered);
  }, [useRollups, rollups, filtered]);

  const explorerMap = useMemo(() => explorerMapChart(filtered), [filtered]);

  const catColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    catOrder.forEach((cat, i) => { map[cat] = CAT_PALETTE[i % CAT_PALETTE.length]; });
    return map;
  }, [catOrder]);

  const categoryBarData = useMemo(() => [
    { x: catBreakdown.map((c) => c.resolved), y: catBreakdown.map((c) => c.category), name: 'Resolved', type: 'bar' as const, orientation: 'h' as const, marker: { color: '#2ecc71' }, customdata: catBreakdown.map((c) => c.category), hovertemplate: '<b>%{customdata}</b><br>Resolved: %{x:,}<extra></extra>' },
    { x: catBreakdown.map((c) => c.open), y: catBreakdown.map((c) => c.category), name: 'Open / In-Progress', type: 'bar' as const, orientation: 'h' as const, marker: { color: '#e74c3c' }, customdata: catBreakdown.map((c) => c.category), hovertemplate: '<b>%{customdata}</b><br>Open: %{x:,}<extra></extra>' },
  ], [catBreakdown]);

  const categoryPieData = useMemo(() => [
    { labels: catBreakdown.map((c) => c.category), values: catBreakdown.map((c) => c.resolved + c.open), type: 'pie' as const, textinfo: isMobile ? 'percent' as const : 'label+percent' as const, textposition: 'inside' as const, hole: 0.3, name: 'Share', hovertemplate: '<b>%{label}</b><br>%{value:,} requests<br>%{percent}<extra></extra>', showlegend: false, marker: { colors: catBreakdown.map((_, i) => CAT_PALETTE[i % CAT_PALETTE.length]) } },
  ], [catBreakdown, isMobile]);

  const categoryChartHeight = capChartHeight(Math.max(400, catBreakdown.length * 28 + 120), !isBentoWide);
  const barMargin = hBarMargin(isMobile);
  const histHeight = isMobile ? 300 : 380;
  const dowHeight = capChartHeight(760, isMobile, 420);

  const dowChartData = useMemo(() => catOrder.map((cat) => ({
    x: DOW_ORDER.map((dow) => dowData.find((d) => d.day === dow && d.category === cat)?.count || 0),
    y: DOW_ORDER,
    name: cat,
    type: 'bar' as const,
    orientation: 'h' as const,
    marker: { color: catColorMap[cat] },
  })), [catOrder, dowData, catColorMap]);

  if (!processed || processed.length === 0) {
    return <div className="p-4">No data available</div>;
  }

  const { total, openCount, pctResolved, medianRes } = kpis;

  return (
    <div>
      <p className="prose-paragraph mb-2">
        Filter by category, ward, service type, or status. Every chart and map below updates with your selection.
      </p>

      <ExplorerFilterBar
        rows={processed}
        filters={filters}
        onChange={handleFilterChange}
      />

      <SectionCard
        title="Overview"
        subtitle={`${total.toLocaleString()} matching requests`}
        defaultOpen
        analyticsTab="explorer"
        sectionId="overview"
      >
        <StatRow
          stats={[
            { label: 'Total Requests', value: total.toLocaleString() },
            { label: 'Open', value: openCount.toLocaleString(), tone: 'danger' },
            { label: '% Resolved', value: `${pctResolved}%`, tone: 'success' },
            { label: 'Median Resolve', value: `${medianRes} days` },
          ]}
        />

        <div className="grid lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-8 order-2 lg:order-1 min-w-0">
            <ChartPanel>
              <PlotlyChart
                data={categoryBarData}
                layout={{
                  barmode: 'stack' as const,
                  height: categoryChartHeight,
                  margin: barMargin,
                  title: chartTitle('Resolved vs open by category'),
                  xaxis: { title: 'Requests' },
                  yaxis: { title: '', automargin: true },
                  showlegend: true,
                  legend: legendBelow(!isBentoWide || isMobile),
                }}
              />
            </ChartPanel>
          </div>
          <div className="lg:col-span-4 order-1 lg:order-2 min-w-0">
            <ChartPanel>
              <PlotlyChart
                data={categoryPieData}
                layout={{
                  height: isMobile ? 280 : 360,
                  margin: pieMargin(),
                  title: chartTitle('Share of total'),
                }}
              />
            </ChartPanel>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Volume & timing"
        subtitle="Day-of-week patterns, ticket age, resolution time, weekly trends"
        analyticsTab="explorer"
        sectionId="volume_timing"
      >
        <DeferredChart minHeight={400}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <PlotlyChart
              data={dowChartData}
              layout={{
                barmode: 'stack' as const,
                height: dowHeight,
                title: chartTitle('Day of week by category'),
                xaxis: { title: 'Requests' },
                yaxis: { title: '', categoryorder: 'array' as const, categoryarray: DOW_ORDER, automargin: true },
                legend: legendBelow(isMobile, -0.2),
                margin: stackedBarMargin(isMobile),
              }}
            />
            <div className="space-y-3">
              {ageHist.hasData ? (
                <PlotlyChart
                  data={ageHist.traces || []}
                  layout={{
                    barmode: 'stack',
                    height: histHeight,
                    title: chartTitle('Open ticket age by category'),
                    xaxis: { title: 'Days since filed', range: [0, ageHist.p99] },
                    yaxis: { title: '# Open Tickets' },
                    legend: legendBelow(isMobile, -0.2),
                    margin: stackedBarMargin(isMobile),
                  }}
                />
              ) : (
                <p className="text-caption text-text-muted">No open requests in selection</p>
              )}
              {resHist.hasData ? (
                <PlotlyChart
                  data={resHist.traces || []}
                  layout={{
                    barmode: 'stack',
                    height: histHeight,
                    title: chartTitle('Resolution time by category (closed)'),
                    xaxis: { title: 'Days from filing to resolution', range: [0, resHist.maxDays] },
                    yaxis: { title: '# Closed Tickets' },
                    legend: legendBelow(isMobile, -0.2),
                    margin: stackedBarMargin(isMobile),
                  }}
                />
              ) : (
                <p className="text-caption text-text-muted">No resolved requests in selection</p>
              )}
            </div>
          </div>
        </DeferredChart>
        <DeferredChart minHeight={300}>
          <PlotlyChart
            data={weeklyVol.traces}
            layout={{
              barmode: 'stack' as const,
              height: histHeight,
              title: chartTitle('Weekly volume by category'),
              xaxis: { title: '' },
              yaxis: { title: 'Requests' },
              legend: { ...legendBelow(isMobile, -0.2), font: { size: 11 } },
              margin: stackedBarMargin(isMobile),
            }}
          />
        </DeferredChart>
      </SectionCard>

      <SectionCard
        title="Geography"
        subtitle={`${filtered.length.toLocaleString()} requests · map, wards, heatmap`}
        analyticsTab="explorer"
        sectionId="geography"
      >
        <DeferredChart minHeight={mapSectionHeight(isMobile)}>
          {explorerMap.hasData ? (
            <div className="-mx-4">
              <PlotlyChart
                data={explorerMap.traces || []}
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
            <p className="text-caption text-text-muted">No data matches current filters</p>
          )}
        </DeferredChart>
        <DeferredChart minHeight={300}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <PlotlyChart
              data={[
                { x: wardVol.map((w) => w.ward), y: wardVol.map((w) => w.open), name: 'Open / In-Progress', type: 'bar' as const, marker: { color: '#e74c3c' } },
                { x: wardVol.map((w) => w.ward), y: wardVol.map((w) => w.resolved), name: 'Resolved', type: 'bar' as const, marker: { color: '#2ecc71' } },
              ]}
              layout={{
                barmode: 'stack' as const,
                height: isMobile ? 300 : 340,
                title: chartTitle('Requests by ward'),
                xaxis: { title: 'Ward' },
                yaxis: { title: 'Requests' },
                legend: { ...legendBelow(isMobile, -0.2), font: { size: 11 } },
                margin: stackedBarMargin(isMobile),
              }}
            />
            <PlotlyChart
              data={[{
                x: wardRes.map((w) => w.ward),
                y: wardRes.map((w) => w.pct),
                type: 'bar' as const,
                marker: { color: wardRes.map((w) => w.pct), colorscale: [[0, '#c0392b'], [0.5, '#f39c12'], [1, '#2ecc71']], cmin: 0, cmax: 100 },
                text: wardRes.map((w) => `${w.pct.toFixed(0)}%`),
                textposition: 'outside' as const,
              }]}
              layout={{
                height: isMobile ? 300 : 340,
                title: chartTitle('% resolved by ward'),
                xaxis: { title: 'Ward' },
                yaxis: { title: '% Resolved', range: [0, 110] },
                coloraxis: { showscale: false },
                margin: { t: 56, b: 40, l: 50, r: 20 },
              }}
            />
          </div>
        </DeferredChart>
        <DeferredChart minHeight={300}>
          <PlotlyChart
            data={[{
              z: wardHeat.z,
              x: wardHeat.categories,
              y: wardHeat.wards,
              type: 'heatmap' as const,
              colorscale: [[0, '#c0392b'], [0.5, '#f39c12'], [1, '#2ecc71']],
              zmin: 0,
              zmax: 100,
              text: wardHeat.z.map((row) => row.map((val) => val ? `${val.toFixed(0)}%` : '-')),
              texttemplate: '%{text}',
              textfont: { size: isMobile ? 10 : 12 },
              colorbar: { title: { text: '% Resolved' }, ticksuffix: '%' },
            }] as unknown as Data[]}
            layout={{
              height: capChartHeight(Math.max(420, wardHeat.wards.length * 44 + 140), isMobile),
              title: chartTitle('Resolution rate: ward × category'),
              xaxis: { side: 'bottom', tickangle: isMobile ? -55 : -35 },
              yaxis: { autorange: 'reversed' },
              margin: { t: 56, b: isMobile ? 150 : 120, l: 80, r: 56 },
            }}
          />
        </DeferredChart>
      </SectionCard>

      <SectionCard
        title="Service types"
        subtitle="Resolved vs open by service type"
        analyticsTab="explorer"
        sectionId="service_types"
      >
        <DeferredChart minHeight={300}>
          <PlotlyChart
            data={[
              { x: countByType.map((t) => t.resolved), y: countByType.map((t) => t.label), name: 'Resolved', type: 'bar' as const, orientation: 'h' as const, marker: { color: '#2ecc71' } },
              { x: countByType.map((t) => t.open), y: countByType.map((t) => t.label), name: 'Open / In-Progress', type: 'bar' as const, orientation: 'h' as const, marker: { color: '#e74c3c' } },
            ]}
            layout={{
              barmode: 'stack' as const,
              height: capChartHeight(Math.max(400, countByType.length * 24 + 100), isMobile),
              title: chartTitle(`By service type (${total.toLocaleString()} total)`),
              xaxis: { title: 'Requests' },
              yaxis: { title: '', automargin: true },
              margin: serviceTypeChartMargin(isMobile),
              legend: serviceTypeLegend(isMobile),
            }}
          />
        </DeferredChart>
      </SectionCard>
    </div>
  );
}
