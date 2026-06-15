import { ProcessedRequest, SLACategorySummary, SLARow } from './dataProcessing';
import type { CategoryReportingReadiness } from './monthlyReport';
import { slaOutcomeKnownColor, slaScoreColor, formatPctSlaOutcomeKnown } from './overviewAnalytics';
import { WARD_ORDER } from './constants';
import { CATEGORICAL_COLORS, colors, fonts, plotlyLayoutDefaults } from './theme';

// Shared layout defaults
export const LAYOUT_DEFAULTS = plotlyLayoutDefaults;

export const MAP_LAYOUT_DEFAULTS = {
  paper_bgcolor: colors.surface,
  plot_bgcolor: colors.surfaceMuted,
  font: plotlyLayoutDefaults.font,
};

const CAT_PALETTE = [...CATEGORICAL_COLORS];

export const AGE_COLOR_MAP: Record<string, string> = {
  '< 1 week': colors.success,
  '1–4 weeks': '#f39c12',
  '1–2 months': colors.warning,
  '2–3 months': '#c0392b',
};

export const STATUS_COLOR_MAP: Record<string, string> = {
  'Open': colors.danger,
  'In-Progress': colors.warning,
  'In Progress': colors.warning,
  'Closed': colors.success,
  'Closed (Duplicate)': '#95a5a6',
  'Closed (Transferred)': '#95a5a6',
  'Canceled': '#bdc3c7',
};

function truncate(s: string, n: number = 32): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/** Stable subsample of up to n items; does not mutate arr. Uses a simple LCG seeded by arr.length. */
function sampleStable<T>(arr: T[], n: number, seed: number): T[] {
  if (arr.length <= n) return arr;
  const copy = arr.slice();
  let s = seed || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = copy.length - 1; i > copy.length - n - 1; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(copy.length - n);
}


export function getCategoryOrder(data: ProcessedRequest[]): string[] {
  const catCounts = new Map<string, number>();
  for (const r of data) {
    catCounts.set(r.category, (catCounts.get(r.category) || 0) + 1);
  }
  return Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0]);
}

export function explorerCategoryBreakdown(data: ProcessedRequest[]) {
  const catStats = new Map<string, { resolved: number; total: number }>();
  
  for (const r of data) {
    const stats = catStats.get(r.category) || { resolved: 0, total: 0 };
    stats.total++;
    if (r.is_closed) stats.resolved++;
    catStats.set(r.category, stats);
  }
  
  const result = Array.from(catStats.entries()).map(([cat, stats]) => ({
    category: cat,
    resolved: stats.resolved,
    open: stats.total - stats.resolved,
    total: stats.total,
  })).sort((a, b) => a.total - b.total);
  
  return result;
}

export function explorerDayOfWeek(data: ProcessedRequest[]) {
  const dowOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dowCatStats = new Map<string, Map<string, number>>();
  
  for (const r of data) {
    const date = new Date(r.ADDDATE);
    const dow = dowOrder[date.getDay()];
    const cat = r.category;
    
    if (!dowCatStats.has(dow)) {
      dowCatStats.set(dow, new Map());
    }
    const catStats = dowCatStats.get(dow)!;
    catStats.set(cat, (catStats.get(cat) || 0) + 1);
  }
  
  const result: Array<{ day: string; category: string; count: number }> = [];
  for (const [day, catStats] of dowCatStats.entries()) {
    for (const [cat, count] of catStats.entries()) {
      result.push({ day, category: cat, count });
    }
  }
  
  return result;
}

export function explorerAgeHistogram(data: ProcessedRequest[]) {
  const open = data.filter(r => r.is_open);
  if (open.length === 0) return { hasData: false };

  const p99 = Math.ceil(open.reduce((max, r) => Math.max(max, r.age_days), 0) * 0.99) + 1;
  const binSize = Math.max(1, Math.floor(p99 / 40));

  const categories = getCategoryOrder(data);
  const colorMap: Record<string, string> = {};
  categories.forEach((cat, i) => {
    colorMap[cat] = CAT_PALETTE[i % CAT_PALETTE.length];
  });

  const byCategory = new Map<string, number[]>();
  for (const r of open) {
    const vals = byCategory.get(r.category) || [];
    vals.push(r.age_days);
    byCategory.set(r.category, vals);
  }

  const traces = categories.map(cat => {
    const vals = byCategory.get(cat);
    if (!vals || vals.length === 0) return null;
    return {
      x: vals,
      name: cat,
      marker: { color: colorMap[cat] },
      opacity: 0.75,
      type: 'histogram' as const,
      xbins: { start: 0, end: p99, size: binSize },
      hovertemplate: `<b>${cat}</b><br>%{x} days open<br>Count: %{y}<extra></extra>`,
    };
  }).filter((t): t is NonNullable<typeof t> => t !== null);

  return { hasData: true, traces, p99, binSize };
}

export function explorerResolutionHistogram(data: ProcessedRequest[]) {
  const closed = data.filter(r => r.is_closed && r.resolution_days !== null && r.resolution_days >= 0);
  if (closed.length === 0) return { hasData: false };

  const MAX_DAYS = 90;
  const categories = getCategoryOrder(data);
  const colorMap: Record<string, string> = {};
  categories.forEach((cat, i) => {
    colorMap[cat] = CAT_PALETTE[i % CAT_PALETTE.length];
  });

  const byCategory = new Map<string, number[]>();
  for (const r of closed) {
    const vals = byCategory.get(r.category) || [];
    vals.push(r.resolution_days!);
    byCategory.set(r.category, vals);
  }

  const traces = categories.map(cat => {
    const vals = byCategory.get(cat);
    if (!vals || vals.length === 0) return null;
    return {
      x: vals,
      name: cat,
      marker: { color: colorMap[cat] },
      opacity: 0.75,
      type: 'histogram' as const,
      xbins: { start: 0, end: MAX_DAYS, size: 1 },
      hovertemplate: `<b>${cat}</b><br>Day %{x:.0f}<br>Count: %{y}<extra></extra>`,
    };
  }).filter((t): t is NonNullable<typeof t> => t !== null);

  return { hasData: true, traces, maxDays: MAX_DAYS };
}

export function explorerCountByType(data: ProcessedRequest[]) {
  const typeStats = new Map<string, { resolved: number; total: number }>();
  
  for (const r of data) {
    const stats = typeStats.get(r.SERVICECODEDESCRIPTION) || { resolved: 0, total: 0 };
    stats.total++;
    if (r.is_closed) stats.resolved++;
    typeStats.set(r.SERVICECODEDESCRIPTION, stats);
  }
  
  const result = Array.from(typeStats.entries()).map(([type, stats]) => ({
    type,
    label: truncate(type),
    resolved: stats.resolved,
    open: stats.total - stats.resolved,
    total: stats.total,
  })).sort((a, b) => a.total - b.total);
  
  return result;
}

export function explorerWardVolume(data: ProcessedRequest[]) {
  const wardStats = new Map<string, { open: number; resolved: number }>();
  
  for (const r of data) {
    const stats = wardStats.get(r.WARD) || { open: 0, resolved: 0 };
    if (r.is_open) stats.open++;
    else stats.resolved++;
    wardStats.set(r.WARD, stats);
  }
  
  const result = WARD_ORDER.map(ward => {
    const stats = wardStats.get(ward) || { open: 0, resolved: 0 };
    return {
      ward,
      open: stats.open,
      resolved: stats.resolved,
      total: stats.open + stats.resolved,
    };
  });
  
  return result;
}

export function explorerWardResolution(data: ProcessedRequest[]) {
  const wardStats = new Map<string, { total: number; resolved: number }>();
  
  for (const r of data) {
    const stats = wardStats.get(r.WARD) || { total: 0, resolved: 0 };
    stats.total++;
    if (r.is_closed) stats.resolved++;
    wardStats.set(r.WARD, stats);
  }
  
  const result = WARD_ORDER.map(ward => {
    const stats = wardStats.get(ward) || { total: 0, resolved: 0 };
    return {
      ward,
      total: stats.total,
      resolved: stats.resolved,
      pct: stats.total > 0 ? (stats.resolved / stats.total) * 100 : 0,
    };
  }).filter(w => w.total > 0);
  
  return result;
}

export function explorerWardHeatmap(data: ProcessedRequest[]) {
  const wardCatStats = new Map<string, Map<string, { total: number; resolved: number }>>();
  const categories = new Set<string>();
  
  for (const r of data) {
    const ward = r.WARD;
    const cat = r.category;
    categories.add(cat);
    
    if (!wardCatStats.has(ward)) {
      wardCatStats.set(ward, new Map());
    }
    const catStats = wardCatStats.get(ward)!;
    const stats = catStats.get(cat) || { total: 0, resolved: 0 };
    stats.total++;
    if (r.is_closed) stats.resolved++;
    catStats.set(cat, stats);
  }
  
  // Keep only wards that appear in the data, in WARD_ORDER position.
  const wardsWithData = Array.from(wardCatStats.keys()).filter(w => WARD_ORDER.includes(w));
  const sortedWards = wardsWithData.sort((a, b) => WARD_ORDER.indexOf(a) - WARD_ORDER.indexOf(b));
  
  // Sort categories by overall resolution rate (ascending = worst first)
  const catRates = new Map<string, { total: number; resolved: number }>();
  for (const [, catStats] of wardCatStats.entries()) {
    for (const [cat, stats] of catStats.entries()) {
      const rates = catRates.get(cat) || { total: 0, resolved: 0 };
      rates.total += stats.total;
      rates.resolved += stats.resolved;
      catRates.set(cat, rates);
    }
  }
  const sortedCats = Array.from(catRates.entries())
    .sort((a, b) => (a[1].resolved / a[1].total) - (b[1].resolved / b[1].total))
    .map(e => e[0]);
  
  // Build z matrix (2D array) matching Python's pivot table
  const zMatrix: number[][] = [];
  for (const ward of sortedWards) {
    const catStats = wardCatStats.get(ward)!;
    const row: number[] = [];
    for (const cat of sortedCats) {
      const stats = catStats.get(cat);
      if (stats && stats.total > 0) {
        row.push((stats.resolved / stats.total) * 100);
      } else {
        row.push(NaN);
      }
    }
    zMatrix.push(row);
  }
  
  return { 
    z: zMatrix, 
    categories: sortedCats, 
    wards: sortedWards 
  };
}

export function weeklyVolumeChartData(data: ProcessedRequest[]) {
  const weekCatStats = new Map<string, Map<string, number>>();
  
  for (const r of data) {
    // Use the pre-computed week Date from ProcessedRequest (local-time week start)
    const w = r.week as Date;
    const weekKey = `${w.getFullYear()}-${String(w.getMonth()+1).padStart(2,'0')}-${String(w.getDate()).padStart(2,'0')}`;
    const cat = r.category;
    
    if (!weekCatStats.has(weekKey)) {
      weekCatStats.set(weekKey, new Map());
    }
    const catStats = weekCatStats.get(weekKey)!;
    catStats.set(cat, (catStats.get(cat) || 0) + 1);
  }
  
  const weeks = Array.from(weekCatStats.keys()).sort();
  const categories = getCategoryOrder(data);
  
  // Include all weeks for each category (with 0 counts) so Plotly can stack properly
  const traces = categories.map(cat => ({
    x: weeks,
    y: weeks.map(week => weekCatStats.get(week)?.get(cat) || 0),
    name: cat,
    type: 'bar' as const,
    marker: { color: CAT_PALETTE[categories.indexOf(cat) % CAT_PALETTE.length] },
    opacity: 0.85,
  }));
  
  return { traces, weeks };
}

export function slaCategoryVolumeMarkerSize(
  categoryCount: number,
  chartHeight: number,
  marginTop: number,
  marginBottom: number,
): number {
  const rowHeight = (chartHeight - marginTop - marginBottom) / Math.max(categoryCount, 1);
  return Math.max(3, Math.min(9, Math.round(rowHeight * 0.4)));
}

/** Y-axis label with a settling marker suffix when reporting is still immature. */
function categoryDisplayLabel(
  category: string,
  readinessByCategory?: Map<string, CategoryReportingReadiness>,
): string {
  if (!readinessByCategory?.get(category)?.immatureCohort) return category;
  return `${category} ○`;
}

function categoryReadinessHoverLine(readiness: CategoryReportingReadiness): string {
  if (!readiness.immatureCohort) return '';
  return `<br>Reporting readiness: ${formatPctSlaOutcomeKnown(readiness.pctSlaOutcomeKnown)}`;
}

function categorySlaHoverHtml(
  row: SLACategorySummary,
  readiness?: CategoryReportingReadiness,
): string {
  const readinessLine = readiness ? categoryReadinessHoverLine(readiness) : '';
  return [
    `<b>${row.category}</b>`,
    `% Met SLA: ${row.pct_met_sla}%`,
    `Total requests: ${row.total.toLocaleString()}`,
    `Resolved on time: ${row.met.toLocaleString()}`,
    `Resolved past due: ${row.missed.toLocaleString()}`,
    `Open within window: ${row.openWithin.toLocaleString()}`,
    `Open past due: ${row.overdue.toLocaleString()}`,
  ].join('<br>') + readinessLine;
}

export function slaCategorySummaryChart(
  data: SLACategorySummary[],
  options?: { markerSize?: number; readinessByCategory?: Map<string, CategoryReportingReadiness> },
) {
  const sorted = [...data].sort((a, b) => a.total - b.total);
  const readinessByCategory = options?.readinessByCategory;
  const yLabels = sorted.map((row) => categoryDisplayLabel(row.category, readinessByCategory));

  const barColors = sorted.map((v) => slaScoreColor(v.pct_met_sla));

  const hover = sorted.map((row) => categorySlaHoverHtml(row, readinessByCategory?.get(row.category)));
  
  const maxTotal = sorted.length > 0 ? Math.max(...sorted.map((d) => d.total)) : 0;
  const volumeAxisMin = -maxTotal * 0.06;
  const markerSize = options?.markerSize ?? 9;
  const maxPct = sorted.length > 0 ? Math.max(...sorted.map((d) => d.pct_met_sla)) : 100;
  const slaXMax = Math.min(115, Math.max(102, Math.ceil(maxPct) + 5));

  return {
    bars: [{
      x: sorted.map(d => d.pct_met_sla),
      y: yLabels,
      orientation: 'h' as const,
      type: 'bar' as const,
      marker: { color: barColors },
      text: sorted.map(d => `${d.pct_met_sla}%`),
      textposition: 'outside' as const,
      customdata: hover,
      hovertemplate: '%{customdata}<extra></extra>',
      name: '% Met SLA',
      xaxis: 'x',
    }],
    volumeLines: [{
      x: sorted.flatMap((d) => [volumeAxisMin, d.total, null]),
      y: sorted.flatMap((d) => {
        const label = categoryDisplayLabel(d.category, readinessByCategory);
        return [label, label, null];
      }),
      mode: 'lines' as const,
      type: 'scatter' as const,
      line: { color: 'rgba(0, 0, 0, 0.25)', width: 1 },
      xaxis: 'x2',
      showlegend: false,
      hoverinfo: 'skip' as const,
    }],
    scatter: [{
      x: sorted.map(d => d.total),
      y: yLabels,
      mode: 'markers' as const,
      type: 'scatter' as const,
      marker: { symbol: 'diamond', size: markerSize, color: 'rgba(0, 0, 0, 0.9)' },
      name: 'Total Requests',
      customdata: sorted.map((d) => categorySlaHoverHtml(d, readinessByCategory?.get(d.category))),
      hovertemplate: '%{customdata}<extra></extra>',
      xaxis: 'x2',
    }],
    categories: yLabels,
    volumeAxisRange: [volumeAxisMin, maxTotal * 1.02] as [number, number],
    slaXRange: [0, slaXMax] as [number, number],
  };
}

export function slaFailuresChart(data: SLARow[]) {
  const sorted = [...data].sort(
    (a, b) => (a.missed_sla_count + a.open_past_sla_count) - (b.missed_sla_count + b.open_past_sla_count),
  );
  
  return {
    missed: [{
      x: sorted.map(d => d.missed_sla_count),
      y: sorted.map(d => truncate(d.SERVICECODEDESCRIPTION)),
      name: 'Resolved Late',
      orientation: 'h' as const,
      type: 'bar' as const,
      marker: { color: '#e67e22' },
    }],
    overdue: [{
      x: sorted.map(d => d.open_past_sla_count),
      y: sorted.map(d => truncate(d.SERVICECODEDESCRIPTION)),
      name: 'Open & Overdue',
      orientation: 'h' as const,
      type: 'bar' as const,
      marker: { color: '#e74c3c' },
    }],
    labels: sorted.map(d => truncate(d.SERVICECODEDESCRIPTION)),
  };
}

export function slaResolutionByTypeChart(processed: ProcessedRequest[], slaData: SLARow[]) {
  const closed = processed.filter(r => r.is_closed && r.resolution_days !== null);
  
  if (closed.length === 0) {
    return { hasData: false };
  }
  
  // Build SLA lookup
  const slaLookup = new Map<string, number>();
  const pctLookup = new Map<string, number>();
  for (const row of slaData) {
    slaLookup.set(row.SERVICECODEDESCRIPTION, row.sla_days);
    pctLookup.set(row.SERVICECODEDESCRIPTION, row.pct_met_sla);
  }
  
  // Get service types with at least 3 closed tickets
  const typeCounts = new Map<string, number>();
  for (const r of closed) {
    typeCounts.set(r.SERVICECODEDESCRIPTION, (typeCounts.get(r.SERVICECODEDESCRIPTION) || 0) + 1);
  }
  
  const typesInData = Array.from(typeCounts.entries())
    .filter(([_, count]) => count >= 3)
    .map(([type, _]) => type);
  
  // Sort by SLA (no SLA first, then by SLA value)
  const order = typesInData.sort((a, b) => {
    const slaA = slaLookup.get(a) ?? -1;
    const slaB = slaLookup.get(b) ?? -1;
    if (slaA < 0 && slaB < 0) return a.localeCompare(b);
    if (slaA < 0) return -1;
    if (slaB < 0) return 1;
    return slaA - slaB;
  });
  
  if (order.length === 0) {
    return { hasData: false };
  }
  
  const maxDays = 365;
  const binSize = 7;
  const bins: number[] = [];
  for (let i = 0; i <= maxDays; i += binSize) {
    bins.push(i);
  }
  const binLabels = bins.slice(0, -1).map(b => `${b}–${b + binSize}`);

  const closedByType = new Map<string, number[]>();
  for (const r of closed) {
    if (r.resolution_days === null || r.resolution_days > maxDays) continue;
    const vals = closedByType.get(r.SERVICECODEDESCRIPTION) || [];
    vals.push(r.resolution_days);
    closedByType.set(r.SERVICECODEDESCRIPTION, vals);
  }

  const metData: number[][] = [];
  const missedData: number[][] = [];
  const yLabels: string[] = [];
  const pctMetList: number[] = [];
  const pctMetHasSla: boolean[] = [];
  const slaPositions: Array<{ rowIdx: number; slaVal: number }> = [];

  for (let rowIdx = 0; rowIdx < order.length; rowIdx++) {
    const stype = order[rowIdx];
    const typeData = closedByType.get(stype) || [];
    const slaVal = slaLookup.get(stype);
    const hasSla = slaVal !== undefined && slaVal > 0;

    if (hasSla) slaPositions.push({ rowIdx, slaVal: slaVal! });
    const met = hasSla ? typeData.filter(r => r <= slaVal!) : typeData;
    const missed = hasSla ? typeData.filter(r => r > slaVal!) : [];
    
    // Histogram
    const metHist = new Array(binLabels.length).fill(0);
    const missedHist = new Array(binLabels.length).fill(0);
    
    for (const val of met) {
      const binIdx = Math.min(Math.floor(val / binSize), binLabels.length - 1);
      metHist[binIdx]++;
    }
    for (const val of missed) {
      const binIdx = Math.min(Math.floor(val / binSize), binLabels.length - 1);
      missedHist[binIdx]++;
    }
    
    metData.push(metHist);
    missedData.push(missedHist);
    yLabels.push(truncate(stype));
    pctMetHasSla.push(hasSla);
    pctMetList.push(hasSla ? (pctLookup.get(stype) ?? 0) : 0);
  }
  
  // Total and log transform
  const totalData = metData.map((row, i) => row.map((val, j) => val + missedData[i][j]));
  const totalLog = totalData.map(row => row.map(val => Math.log1p(val)));
  
  // Customdata for hover (met, missed)
  const customdata = metData.map((row, i) => 
    row.map((val, j) => [val, missedData[i][j]])
  );
  
  // SLA line shapes: in-range lines at the SLA day; overflow lines pinned to the right edge.
  const rightEdgeX = binLabels.length - 0.5;
  const shapes = slaPositions.map(({ rowIdx, slaVal }) => {
    const binIdx = Math.floor(slaVal / binSize);
    const inRange = slaVal <= maxDays && binIdx < binLabels.length;
    const x = inRange ? binIdx + 0.5 : rightEdgeX;
    return {
      type: 'line' as const,
      x0: x,
      x1: x,
      y0: rowIdx - 0.4,
      y1: rowIdx + 0.4,
      line: {
        color: '#ff6f00',
        width: 2,
        dash: inRange ? ('dash' as const) : ('dot' as const),
      },
    };
  });

  // SLA annotations: offset right of the line; overflow shows value with →.
  const annotations = slaPositions.map(({ rowIdx, slaVal }) => {
    const binIdx = Math.floor(slaVal / binSize);
    const inRange = slaVal <= maxDays && binIdx < binLabels.length;
    if (inRange) {
      return {
        x: binIdx + 0.5,
        y: rowIdx,
        text: `${Math.round(slaVal)}d`,
        showarrow: false,
        font: { size: 9, color: '#ff6f00' },
        xanchor: 'left' as const,
        yanchor: 'middle' as const,
        xshift: 5,
        yshift: -4,
      };
    }
    return {
      x: rightEdgeX,
      y: rowIdx,
      text: `${Math.round(slaVal)}d →`,
      showarrow: false,
      font: { size: 9, color: '#ff6f00' },
      xanchor: 'right' as const,
      yanchor: 'middle' as const,
      xshift: -5,
      yshift: -4,
    };
  });
  
  let zmax = 0;
  for (const row of totalLog) {
    for (const v of row) {
      if (v > zmax) zmax = v;
    }
  }

  return {
    hasData: true,
    heatmap: [{
      z: totalLog,
      x: binLabels,
      y: yLabels,
      type: 'heatmap' as const,
      colorscale: 'Plasma' as const,
      showscale: false,
      zmin: 0,
      zmax,
      customdata,
      hovertemplate: '<b>%{y}</b><br>%{x} days<br>Met SLA: %{customdata[0]} tickets<br>Missed SLA: %{customdata[1]} tickets<extra></extra>',
    }],
    sidebar: [{
      x: pctMetList,
      y: yLabels,
      type: 'bar' as const,
      orientation: 'h' as const,
      marker: {
        color: pctMetList.map((p, i) => {
          if (!pctMetHasSla[i]) return '#d1d5db';
          return p >= 99 ? '#00c853' : p >= 95 ? '#ff9800' : '#d32f2f';
        }),
      },
      text: pctMetList.map((p, i) => {
        if (!pctMetHasSla[i]) return 'N/A';
        return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
      }),
      textposition: 'outside' as const,
      textfont: { size: 9, color: '#374151' },
      cliponaxis: false,
      customdata: pctMetList.map((p, i) => (pctMetHasSla[i] ? `${Number.isInteger(p) ? p : p.toFixed(1)}%` : 'N/A')),
      xaxis: 'x2',
      showlegend: false,
      hovertemplate: '<b>%{y}</b><br>% Met SLA: %{customdata}<extra></extra>',
    }],
    shapes,
    annotations,
    height: Math.max(450, order.length * 22 + 100),
  };
}

export function slaStatusMapChart(processed: ProcessedRequest[], slaData: SLARow[]) {
  const withCoords = processed.filter(r => r.LATITUDE !== null && r.LONGITUDE !== null);
  
  if (withCoords.length === 0) {
    return { hasData: false };
  }
  
  // Build SLA lookup
  const slaLookup = new Map<string, number>();
  for (const row of slaData) {
    slaLookup.set(row.SERVICECODEDESCRIPTION, row.sla_days);
  }
  
  // Determine SLA status for each request
  const colorMap: Record<string, string> = {
    'Resolved on time': '#2ecc71',
    'Resolved late': '#e74c3c',
    'Open & overdue': '#c0392b',
    'Open & within SLA': '#f39c12',
    'No SLA defined': '#95a5a6',
    'Resolved (no date)': '#bdc3c7',
  };
  
  const statusGroups: Record<string, { lat: number[]; lon: number[]; customdata: (string | number | null)[][] }> = {
    'Resolved on time': { lat: [], lon: [], customdata: [] },
    'Resolved late': { lat: [], lon: [], customdata: [] },
    'Open & overdue': { lat: [], lon: [], customdata: [] },
    'Open & within SLA': { lat: [], lon: [], customdata: [] },
    'No SLA defined': { lat: [], lon: [], customdata: [] },
    'Resolved (no date)': { lat: [], lon: [], customdata: [] },
  };
  
  // Sample if too many points
  const sampleSize = 20000;
  const dataToUse = sampleStable(withCoords, sampleSize, withCoords.length);

  for (const r of dataToUse) {
    const sla = slaLookup.get(r.SERVICECODEDESCRIPTION);
    let status: string;
    
    if (sla === undefined || sla <= 0) {
      status = 'No SLA defined';
    } else if (r.is_closed) {
      if (r.resolution_days !== null) {
        status = r.resolution_days <= sla ? 'Resolved on time' : 'Resolved late';
      } else {
        status = 'Resolved (no date)';
      }
    } else {
      status = r.age_days > sla ? 'Open & overdue' : 'Open & within SLA';
    }
    
    const group = statusGroups[status];
    group.lat.push(r.LATITUDE!);
    group.lon.push(r.LONGITUDE!);
    group.customdata.push([
      r.SERVICECODEDESCRIPTION,
      r.WARD,
      r.SERVICEORDERSTATUS,
      r.ADDDATE,
      r.resolution_days,
    ]);
  }
  
  // Statuses where resolution_days (customdata[4]) is always populated.
  const resolvedWithDays = new Set(['Resolved on time', 'Resolved late']);

  const order = ['Resolved on time', 'Open & within SLA', 'Resolved late', 'Open & overdue', 'No SLA defined', 'Resolved (no date)'];
  const traces = order.map(status => {
    const group = statusGroups[status];
    if (group.lat.length === 0) return null;
    const resolutionLine = resolvedWithDays.has(status)
      ? 'Resolved in: %{customdata[4]:.1f} days<extra></extra>'
      : '<extra></extra>';
    return {
      lat: group.lat,
      lon: group.lon,
      mode: 'markers' as const,
      type: 'scattermap' as const,
      marker: { size: 6, color: colorMap[status], opacity: 0.75 },
      name: status,
      customdata: group.customdata,
      hovertemplate: (
        '<b>%{customdata[0]}</b><br>' +
        'Ward: %{customdata[1]}<br>' +
        'Status: %{customdata[2]}<br>' +
        'Started: %{customdata[3]}<br>' +
        resolutionLine
      ),
    };
  }).filter((t): t is NonNullable<typeof t> => t !== null);
  
  const sampled = withCoords.length > sampleSize;
  const note = sampled ? ' (sampled to 20k)' : '';
  
  return {
    hasData: true,
    traces,
    title: `SLA Status Map: ${dataToUse.length.toLocaleString()} requests${note}`,
    height: 520,
  };
}

export function explorerMapChart(data: ProcessedRequest[]) {
  const withCoords = data.filter(r => r.LATITUDE !== null && r.LONGITUDE !== null);
  
  if (withCoords.length === 0) {
    return { hasData: false };
  }
  
  // Sample if too many points
  const sampleSize = 20000;
  const dataToUse = sampleStable(withCoords, sampleSize, withCoords.length);

  // Limit to top 15 service types, group rest as "Other"
  const typeCounts = new Map<string, number>();
  for (const r of dataToUse) {
    typeCounts.set(r.SERVICECODEDESCRIPTION, (typeCounts.get(r.SERVICECODEDESCRIPTION) || 0) + 1);
  }
  
  const sortedTypes = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);
  const topTypes = sortedTypes.slice(0, 15).map(([type]) => type);
  
  const typeGroups: Record<string, { lat: number[]; lon: number[]; customdata: (string | number | null)[][] }> = {};
  
  for (const r of dataToUse) {
    const mapType = topTypes.includes(r.SERVICECODEDESCRIPTION) ? r.SERVICECODEDESCRIPTION : 'Other';
    if (!typeGroups[mapType]) {
      typeGroups[mapType] = { lat: [], lon: [], customdata: [] };
    }
    const group = typeGroups[mapType];
    group.lat.push(r.LATITUDE!);
    group.lon.push(r.LONGITUDE!);
    group.customdata.push([
      r.STREETADDRESS || 'Unknown',
      r.SERVICECODEDESCRIPTION,
      r.WARD,
      r.SERVICEORDERSTATUS,
      r.is_open ? 'Open' : 'Resolved',
      r.age_days,
    ]);
  }
  
  const traces = Object.entries(typeGroups).map(([type, group]) => ({
    lat: group.lat,
    lon: group.lon,
    mode: 'markers' as const,
    type: 'scattermap' as const,
    marker: { size: 6, opacity: 0.7 },
    name: type,
    customdata: group.customdata,
    hovertemplate: (
      '<b>%{customdata[0]}</b><br>' +
      'Service: %{customdata[1]}<br>' +
      'Ward: %{customdata[2]}<br>' +
      'Status: %{customdata[3]}<br>' +
      'State: %{customdata[4]}<br>' +
      'Days since filed: %{customdata[5]}<extra></extra>'
    ),
  }));
  
  const sampled = withCoords.length > sampleSize;
  const note = sampled ? ' (sampled to 20k)' : '';
  
  return {
    hasData: true,
    traces,
    title: `Map: ${dataToUse.length.toLocaleString()} requests${note}, colored by service type`,
    height: 500,
  };
}

export function monthlyThroughputChart(
  data: Array<{ label: string; filed: number; resolved: number }>,
) {
  return {
    traces: [
      {
        x: data.map((d) => d.label),
        y: data.map((d) => d.filed),
        name: 'Filed',
        type: 'bar' as const,
        marker: { color: '#3b6ea5' },
        hovertemplate: '<b>%{x}</b><br>Filed: %{y:,}<extra></extra>',
      },
      {
        x: data.map((d) => d.label),
        y: data.map((d) => d.resolved),
        name: 'Resolved',
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        line: { color: '#2ecc71', width: 2 },
        marker: { size: 6 },
        yaxis: 'y',
        hovertemplate: '<b>%{x}</b><br>Resolved: %{y:,}<extra></extra>',
      },
    ],
  };
}

export function urbanistCategoryComplianceChart(
  data: Array<{ category: string; pct_met_sla: number; total: number }>,
) {
  const colors = data.map((v) =>
    v.pct_met_sla >= 99 ? '#2ecc71' : v.pct_met_sla >= 95 ? '#e67e22' : '#e74c3c',
  );

  return {
    traces: [{
      x: data.map((d) => d.pct_met_sla),
      y: data.map((d) => d.category),
      orientation: 'h' as const,
      type: 'bar' as const,
      marker: { color: colors },
      text: data.map((d) => `${d.pct_met_sla}%`),
      textposition: 'outside' as const,
      hovertemplate: '<b>%{y}</b><br>% Met SLA: %{x}%<br>Volume: %{customdata:,}<extra></extra>',
      customdata: data.map((d) => d.total),
    }],
    categories: data.map((d) => d.category),
  };
}

export function sloPitfallScatter(
  data: Array<{
    serviceType: string;
    slaDays: number;
    pctMetSla: number;
    pctResolved: number;
    total: number;
  }>,
) {
  return {
    traces: [{
      x: data.map((d) => d.slaDays),
      y: data.map((d) => d.pctMetSla),
      mode: 'markers' as const,
      type: 'scatter' as const,
      marker: {
        size: data.map((d) => Math.min(40, Math.max(8, Math.sqrt(d.total) * 1.5))),
        color: data.map((d) => d.pctResolved),
        colorscale: [[0, '#e74c3c'], [0.5, '#e67e22'], [1, '#2ecc71']],
        showscale: true,
        colorbar: { title: '% Resolved', thickness: 12 },
        line: { width: 1, color: '#374151' },
      },
      text: data.map((d) => truncate(d.serviceType, 24)),
      hovertemplate: (
        '<b>%{text}</b><br>SLA: %{x} days<br>% Met SLA: %{y}%<br>' +
        '% Resolved: %{marker.color:.1f}%<br>Volume: %{customdata:,}<extra></extra>'
      ),
      customdata: data.map((d) => d.total),
    }],
  };
}

export function complianceVsResolvedChart(
  data: Array<{
    serviceType: string;
    pctMetSla: number;
    pctResolved: number;
    pctMetSlaClosedOnly: number;
  }>,
) {
  const labels = data.map((d) => truncate(d.serviceType, 28));

  return {
    traces: [
      {
        x: data.map((d) => d.pctMetSla),
        y: labels,
        name: '% Met SLA',
        orientation: 'h' as const,
        type: 'bar' as const,
        marker: { color: '#2ecc71' },
        hovertemplate: '<b>%{y}</b><br>% Met SLA: %{x}%<extra></extra>',
      },
      {
        x: data.map((d) => d.pctResolved),
        y: labels,
        name: '% Resolved',
        orientation: 'h' as const,
        type: 'bar' as const,
        marker: { color: '#3b6ea5' },
        hovertemplate: '<b>%{y}</b><br>% Resolved: %{x}%<extra></extra>',
      },
      {
        x: data.map((d) => d.pctMetSlaClosedOnly),
        y: labels,
        name: '% Met SLA (closed)',
        orientation: 'h' as const,
        type: 'bar' as const,
        marker: { color: '#e67e22' },
        hovertemplate: '<b>%{y}</b><br>% Met SLA (closed only): %{x}%<extra></extra>',
      },
    ],
    labels,
  };
}

export interface CohortDispositionSegment {
  key: CohortDispositionStackKey;
  label: string;
  count: number;
  color: string;
}

export type CohortDispositionStackKey = 'met' | 'missed' | 'open_overdue' | 'open_within' | 'no_sla';

const DISPOSITION_STACK_ORDER: CohortDispositionStackKey[] = [
  'met',
  'missed',
  'open_overdue',
  'open_within',
  'no_sla',
];

/** Shared paper-y layout for the bar row and outcome marker callout below it. */
export const COHORT_DISPOSITION_LAYOUT = {
  full: {
    barDomain: [0.40, 0.86] as [number, number],
    labelBaselineY: 0.17,
    labelXGap: 0.35,
    height: { mobile: 132, desktop: 148 },
    segmentMinPct: 5,
    segmentFontSize: 10,
    markerFontSize: 12,
    markerLineWidth: 2,
  },
  mini: {
    barDomain: [0, 1] as [number, number],
    labelBaselineY: 0.18,
    labelXGap: 0.45,
    height: { mobile: 18, desktop: 18 },
    segmentMinPct: 7,
    segmentFontSize: 10,
    markerFontSize: 9,
    markerLineWidth: 1,
  },
} as const;

/** Horizontal 100% stacked disposition bar with an SLA-colored outcome marker. */
export function cohortDispositionChart(options: {
  cohortLabel: string;
  buckets: CohortDispositionSegment[];
  total: number;
  pctSlaOutcomeKnown: number;
  isMobile?: boolean;
  variant?: keyof typeof COHORT_DISPOSITION_LAYOUT;
}) {
  const {
    cohortLabel,
    buckets,
    total,
    pctSlaOutcomeKnown,
    isMobile = false,
    variant = 'full',
  } = options;
  const layout = COHORT_DISPOSITION_LAYOUT[variant];
  const outcomeColor = slaOutcomeKnownColor(pctSlaOutcomeKnown);
  const bucketByKey = new Map(buckets.map((b) => [b.key, b]));

  const orderedBuckets = DISPOSITION_STACK_ORDER
    .map((key) => bucketByKey.get(key))
    .filter((b): b is CohortDispositionSegment => !!b && b.count > 0);

  const traces = orderedBuckets.map((b) => {
    const pct = total > 0 ? (b.count / total) * 100 : 0;
    return {
      name: b.label,
      y: [cohortLabel],
      x: [pct],
      customdata: [[b.count]],
      type: 'bar' as const,
      orientation: 'h' as const,
      marker: { color: b.color, line: { width: 0 } },
      text: pct >= layout.segmentMinPct ? [`${pct.toFixed(1)}%`] : undefined,
      textposition: 'inside' as const,
      insidetextanchor: 'middle' as const,
      insidetextfont: { color: '#ffffff', size: layout.segmentFontSize, family: fonts.mono },
      hovertemplate: `${b.label}: %{x:.1f}% (%{customdata[0]:,})<extra></extra>`,
      showlegend: false,
    };
  });

  const { barDomain, labelBaselineY } = layout;
  const barTop = barDomain[1];
  const labelText = formatPctSlaOutcomeKnown(pctSlaOutcomeKnown);

  const shapes: Array<Record<string, unknown>> = variant === 'mini' ? [] : [{
    type: 'line',
    xref: 'x',
    yref: 'paper',
    x0: pctSlaOutcomeKnown,
    x1: pctSlaOutcomeKnown,
    y0: barTop,
    y1: labelBaselineY,
    line: { color: outcomeColor, width: layout.markerLineWidth },
  }];

  const annotations: Array<Record<string, unknown>> = variant === 'mini' ? [] : [{
    x: pctSlaOutcomeKnown,
    y: labelBaselineY,
    xref: 'x',
    yref: 'paper',
    text: labelText,
    showarrow: false,
    xanchor: 'right',
    xshift: -3,
    yanchor: 'bottom',
    borderpad: 0,
    borderwidth: 0,
    font: { family: fonts.mono, size: layout.markerFontSize, color: outcomeColor },
  }];

  return {
    traces,
    shapes,
    annotations,
    outcomeColor,
    barDomain,
    height: isMobile ? layout.height.mobile : layout.height.desktop,
  };
}
