import { DataDictionaries, DataShardMeta, RollupFile } from '../api/dataTypes';
import { ProcessedRequest } from './dataProcessing';
import { filingDayKey, cohortChartDays, filingMonthDays, filingMonthKey, parseUtcRowTimestamp, resolutionDayKey } from './filingDate';
import { formatPctSlaOutcomeKnown, isImmatureCohort, pctSlaOutcomeKnown, slaOutcomeKnownLabel, SLA_OUTCOME_KNOWN_THRESHOLD, slaTone, slaVerdictLabel } from './overviewAnalytics';
import { mergeSlaRollups } from './rollups';
import { CATEGORICAL_COLORS, colors } from './theme';

export interface DeltaValue {
  absolute: number;
  direction: 'up' | 'down' | 'flat';
  formatted: string;
}

export interface MonthlyScorecard {
  month: string;
  label: string;
  pctMetSla: number;
  pctMetSlaClosedOnly: number;
  totalFiled: number;
  totalResolved: number;
  medianResolutionDays: number;
  netBacklogChange: number;
  immatureCohort: boolean;
  deltas: {
    pctMetSla: DeltaValue | null;
    totalFiled: DeltaValue | null;
    totalResolved: DeltaValue | null;
    medianResolutionDays: DeltaValue | null;
  };
  yoyDeltas: {
    pctMetSla: DeltaValue | null;
    totalFiled: DeltaValue | null;
  } | null;
}

export interface CategorySlaMonth {
  category: string;
  pctMetSla: number;
  total: number;
  prevPctMetSla: number | null;
  delta: number | null;
  tone: 'success' | 'warning' | 'danger';
}

/** Green / orange / red band counts for mature categories; immature ones tracked separately. */
export interface CategorySlaBandCounts {
  success: number;
  warning: number;
  danger: number;
  /** Mature categories included in the bands above. */
  total: number;
  /** Categories still within the SLA window — excluded from band counts. */
  settling: number;
}

/** Per-category cohort reporting readiness for the filing month. */
export interface CategoryReportingReadiness {
  category: string;
  total: number;
  pctSlaOutcomeKnown: number;
  immatureCohort: boolean;
  /** Open tickets still within their SLA window — outcome not yet knowable. */
  openWithin: number;
}

export interface Notable {
  kind: 'sla_drop' | 'sla_crossed_threshold' | 'volume_spike' | 'backlog_growth';
  subject: string;
  sentence: string;
  severity: 'info' | 'warning' | 'danger';
}

export interface WardMonth {
  ward: string;
  filed: number;
  resolved: number;
  pctResolved: number;
}

export interface BacklogSnapshot {
  buckets: Array<{ label: string; count: number }>;
  total: number;
  prevTotal: number | null;
  delta: number | null;
}

export interface VolumeSummary {
  topServiceTypes: Array<{ type: string; total: number }>;
  weeklyTotals: Array<{ week: string; count: number }>;
}

export interface CohortDispositionBucket {
  key: 'met' | 'missed' | 'open_within' | 'open_overdue' | 'no_sla';
  label: string;
  count: number;
  color: string;
}

export interface CohortSettling {
  total: number;
  buckets: CohortDispositionBucket[];
  pctClosed: number;
  pctOpenWithin: number;
  pctSlaOutcomeKnown: number;
  pctMetSla: number;
  pctMetSlaClosedOnly: number;
  stableAfterLabel: string | null;
  summaryLine: string;
  slaComparisonLine: string;
  slaOutcomeKnownLine: string;
}

export interface CumulativeResolutionCurve {
  days: number[];
  pctClosed: number[];
}

export interface CohortFlowChart {
  dayLabels: string[];
  xTickVals: string[];
  xTickText: string[];
  traces: Array<{
    x: string[];
    y: number[];
    customdata: number[];
    name: string;
    type: 'bar';
    marker: { color: string; opacity?: number };
    hovertemplate: string | string[];
  }>;
  hasData: boolean;
}

interface MonthAgg {
  total: number;
  closed: number;
  met: number;
  missed: number;
  overdue: number;
  open: number;
  resolved: number;
  pctMetSla: number;
  pctMetSlaClosedOnly: number;
  medianResolution: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function aggregateMonth(file: RollupFile, _dicts: DataDictionaries): MonthAgg {
  let total = 0;
  let closed = 0;
  let met = 0;
  let missed = 0;
  let overdue = 0;
  let medSum = 0;

  for (const row of file.sla) {
    total += row.total;
    closed += row.closed;
    met += row.met_sla_count;
    missed += row.missed_sla_count;
    overdue += row.open_past_sla_count;
    medSum += row.median_resolution * row.closed;
  }

  let open = 0;
  let resolved = 0;
  for (const row of file.explorer.categoryBreakdown) {
    open += row.open;
    resolved += row.resolved;
  }

  const failures = missed + overdue;
  const pctMetSla = total > 0 ? round1(((total - failures) / total) * 100) : 0;
  const pctMetSlaClosedOnly = closed > 0 ? round1((met / closed) * 100) : 0;
  const medianResolution = closed > 0 ? round1(medSum / closed) : 0;

  return { total, closed, met, missed, overdue, open, resolved, pctMetSla, pctMetSlaClosedOnly, medianResolution };
}

function makeDelta(current: number, previous: number | null, opts?: { suffix?: string; isPercent?: boolean }): DeltaValue | null {
  if (previous === null) return null;
  const absolute = round1(current - previous);
  if (Math.abs(absolute) < 0.05) {
    return { absolute: 0, direction: 'flat', formatted: '0' };
  }
  const direction = absolute > 0 ? 'up' : 'down';
  const suffix = opts?.suffix ?? '';
  if (opts?.isPercent && previous !== 0) {
    const pct = round1((absolute / previous) * 100);
    return { absolute, direction, formatted: `${absolute > 0 ? '+' : ''}${pct}%` };
  }
  const sign = absolute > 0 ? '+' : '';
  return { absolute, direction, formatted: `${sign}${absolute}${suffix}` };
}

/** Sorted shard months available for the report picker. */
export function getAvailableMonths(shards: DataShardMeta[]): string[] {
  return [...shards].map((s) => s.id).sort((a, b) => b.localeCompare(a));
}

/** Latest month with a full filing window; skips the in-progress calendar month. */
export function getLatestCompleteMonth(shards: DataShardMeta[]): string {
  const months = getAvailableMonths(shards);
  if (months.length === 0) return '';
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (months[0] === current && months.length > 1) return months[1];
  return months[0];
}

export function findRollup(rollups: RollupFile[], month: string): RollupFile | null {
  return rollups.find((r) => r.month === month) ?? null;
}

export function findPrevMonth(rollups: RollupFile[], month: string): RollupFile | null {
  const sorted = [...rollups].sort((a, b) => a.month.localeCompare(b.month));
  const idx = sorted.findIndex((r) => r.month === month);
  return idx > 0 ? sorted[idx - 1] : null;
}

export function findYoyMonth(rollups: RollupFile[], month: string): RollupFile | null {
  const [year, mon] = month.split('-').map(Number);
  const yoyKey = `${year - 1}-${String(mon).padStart(2, '0')}`;
  return findRollup(rollups, yoyKey);
}

export function computeMonthlyScorecard(
  current: RollupFile,
  prev: RollupFile | null,
  yoy: RollupFile | null,
  dicts: DataDictionaries,
): MonthlyScorecard {
  const cur = aggregateMonth(current, dicts);
  const prevAgg = prev ? aggregateMonth(prev, dicts) : null;
  const yoyAgg = yoy ? aggregateMonth(yoy, dicts) : null;

  return {
    month: current.month,
    label: monthLabel(current.month),
    pctMetSla: cur.pctMetSla,
    pctMetSlaClosedOnly: cur.pctMetSlaClosedOnly,
    totalFiled: cur.total,
    totalResolved: cur.resolved,
    medianResolutionDays: cur.medianResolution,
    netBacklogChange: cur.total - cur.resolved,
    immatureCohort: isImmatureCohort(cur.total, cur.met, cur.missed, cur.overdue),
    deltas: {
      pctMetSla: prevAgg ? makeDelta(cur.pctMetSla, prevAgg.pctMetSla, { suffix: ' pts' }) : null,
      totalFiled: prevAgg ? makeDelta(cur.total, prevAgg.total) : null,
      totalResolved: prevAgg ? makeDelta(cur.resolved, prevAgg.resolved) : null,
      medianResolutionDays: prevAgg ? makeDelta(cur.medianResolution, prevAgg.medianResolution, { suffix: 'd' }) : null,
    },
    yoyDeltas: yoyAgg
      ? {
          pctMetSla: makeDelta(cur.pctMetSla, yoyAgg.pctMetSla, { suffix: ' pts' }),
          totalFiled: makeDelta(cur.total, yoyAgg.total),
        }
      : null,
  };
}

function categoryStatsFromRollup(
  file: RollupFile,
  dicts: DataDictionaries,
): Map<string, { total: number; pctMetSla: number; immatureCohort: boolean }> {
  const slaRows = mergeSlaRollups([file], dicts);
  const stats = new Map<string, { total: number; met: number; missed: number; overdue: number }>();

  for (const row of slaRows) {
    const existing = stats.get(row.category) ?? { total: 0, met: 0, missed: 0, overdue: 0 };
    existing.total += row.total;
    existing.met += row.met_sla_count;
    existing.missed += row.missed_sla_count;
    existing.overdue += row.open_past_sla_count;
    stats.set(row.category, existing);
  }

  const result = new Map<string, { total: number; pctMetSla: number; immatureCohort: boolean }>();
  for (const [category, s] of stats) {
    const good = s.total - s.missed - s.overdue;
    result.set(category, {
      total: s.total,
      pctMetSla: s.total > 0 ? round1((good / s.total) * 100) : 0,
      immatureCohort: isImmatureCohort(s.total, s.met, s.missed, s.overdue),
    });
  }
  return result;
}

function categoryVolumeFromRollup(file: RollupFile, dicts: DataDictionaries): Map<string, number> {
  const stats = new Map<string, number>();
  for (const row of file.explorer.categoryBreakdown) {
    const category = dicts.categories[row.c];
    stats.set(category, (stats.get(category) ?? 0) + row.open + row.resolved);
  }
  return stats;
}

export function computeCategorySlaForMonth(
  current: RollupFile,
  prev: RollupFile | null,
  dicts: DataDictionaries,
): CategorySlaMonth[] {
  const curStats = categoryStatsFromRollup(current, dicts);
  const prevStats = prev ? categoryStatsFromRollup(prev, dicts) : null;

  return Array.from(curStats.entries())
    .map(([category, s]) => {
      const prevPct = prevStats?.get(category)?.pctMetSla ?? null;
      const delta = prevPct !== null ? round1(s.pctMetSla - prevPct) : null;
      return {
        category,
        pctMetSla: s.pctMetSla,
        total: s.total,
        prevPctMetSla: prevPct,
        delta,
        tone: slaTone(s.pctMetSla),
      };
    })
    .sort((a, b) => a.pctMetSla - b.pctMetSla);
}

/** Counts mature filing-month categories by SLA band (≥99%, 95–98.9%, <95%). */
export function computeCategorySlaBandCounts(
  file: RollupFile,
  dicts: DataDictionaries,
): CategorySlaBandCounts {
  const stats = categoryStatsFromRollup(file, dicts);
  const counts: CategorySlaBandCounts = { success: 0, warning: 0, danger: 0, total: 0, settling: 0 };

  for (const { pctMetSla, immatureCohort } of stats.values()) {
    if (immatureCohort) {
      counts.settling += 1;
      continue;
    }
    counts.total += 1;
    const tone = slaTone(pctMetSla);
    counts[tone] += 1;
  }

  return counts;
}

/** Reporting readiness by category — share with closed or past-SLA outcome. */
export function computeCategoryReportingReadiness(
  file: RollupFile,
  dicts: DataDictionaries,
): CategoryReportingReadiness[] {
  const slaRows = mergeSlaRollups([file], dicts);
  const stats = new Map<string, { total: number; met: number; missed: number; overdue: number }>();

  for (const row of slaRows) {
    const existing = stats.get(row.category) ?? { total: 0, met: 0, missed: 0, overdue: 0 };
    existing.total += row.total;
    existing.met += row.met_sla_count;
    existing.missed += row.missed_sla_count;
    existing.overdue += row.open_past_sla_count;
    stats.set(row.category, existing);
  }

  return Array.from(stats.entries())
    .map(([category, s]) => {
      const openWithin = Math.max(0, s.total - s.met - s.missed - s.overdue);
      return {
        category,
        total: s.total,
        pctSlaOutcomeKnown: pctSlaOutcomeKnown(s.total, s.met, s.missed, s.overdue),
        immatureCohort: isImmatureCohort(s.total, s.met, s.missed, s.overdue),
        openWithin,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}

function openTotalFromRollup(file: RollupFile): number {
  return file.explorer.categoryBreakdown.reduce((sum, row) => sum + row.open, 0);
}

export function detectNotables(
  current: RollupFile,
  prev: RollupFile | null,
  dicts: DataDictionaries,
): Notable[] {
  if (!prev) return [];

  const curCats = computeCategorySlaForMonth(current, prev, dicts);
  const curVol = categoryVolumeFromRollup(current, dicts);
  const prevVol = categoryVolumeFromRollup(prev, dicts);
  const notables: Notable[] = [];

  for (const cat of curCats) {
    if (cat.prevPctMetSla === null) continue;
    if (cat.prevPctMetSla >= 99 && cat.pctMetSla < 99) {
      notables.push({
        kind: 'sla_crossed_threshold',
        subject: cat.category,
        sentence: `${cat.category} dropped ${Math.abs(cat.delta ?? 0).toFixed(1)} points to ${cat.pctMetSla}% compliance, crossing below 99%.`,
        severity: 'warning',
      });
    } else if (cat.prevPctMetSla >= 95 && cat.pctMetSla < 95) {
      notables.push({
        kind: 'sla_crossed_threshold',
        subject: cat.category,
        sentence: `${cat.category} dropped ${Math.abs(cat.delta ?? 0).toFixed(1)} points to ${cat.pctMetSla}% compliance, crossing below 95%.`,
        severity: 'danger',
      });
    }
  }

  const biggestDrop = curCats
    .filter((c) => c.delta !== null && c.delta <= -3)
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0];

  if (biggestDrop && !notables.some((n) => n.subject === biggestDrop.category && n.kind === 'sla_crossed_threshold')) {
    notables.push({
      kind: 'sla_drop',
      subject: biggestDrop.category,
      sentence: `${biggestDrop.category} compliance fell ${Math.abs(biggestDrop.delta ?? 0).toFixed(1)} points to ${biggestDrop.pctMetSla}% — the largest decline this month.`,
      severity: biggestDrop.pctMetSla < 95 ? 'danger' : 'warning',
    });
  }

  for (const [category, count] of curVol) {
    const prevCount = prevVol.get(category) ?? 0;
    if (prevCount < 100 || count < 100) continue;
    const pctChange = ((count - prevCount) / prevCount) * 100;
    if (pctChange > 30) {
      notables.push({
        kind: 'volume_spike',
        subject: category,
        sentence: `${category} volume up ${Math.round(pctChange)}% vs last month (${count.toLocaleString()} vs ${prevCount.toLocaleString()} requests).`,
        severity: 'info',
      });
    }
  }

  const curOpen = openTotalFromRollup(current);
  const prevOpen = openTotalFromRollup(prev);
  if (prevOpen > 0) {
    const growth = ((curOpen - prevOpen) / prevOpen) * 100;
    if (growth > 10) {
      notables.push({
        kind: 'backlog_growth',
        subject: 'Open backlog',
        sentence: `Open backlog grew ${Math.round(growth)}% (${curOpen.toLocaleString()} tickets) — ${(curOpen - prevOpen).toLocaleString()} more than last month.`,
        severity: 'warning',
      });
    }
  }

  const severityOrder = { danger: 0, warning: 1, info: 2 };
  return notables
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
    .slice(0, 4);
}

export function computeWardBreakdown(
  current: RollupFile,
  dicts: DataDictionaries,
): WardMonth[] {
  return dicts.wards.map((ward, i) => {
    const row = current.explorer.wardVolume.find((w) => w.w === i);
    const open = row?.open ?? 0;
    const resolved = row?.resolved ?? 0;
    const filed = open + resolved;
    return {
      ward,
      filed,
      resolved,
      pctResolved: filed > 0 ? round1((resolved / filed) * 100) : 0,
    };
  });
}

export function computeVolumeSummary(
  current: RollupFile,
  dicts: DataDictionaries,
): VolumeSummary {
  const typeCounts = new Map<number, number>();
  for (const row of current.explorer.typeCounts) {
    typeCounts.set(row.st, (typeCounts.get(row.st) ?? 0) + row.open + row.resolved);
  }

  const topServiceTypes = Array.from(typeCounts.entries())
    .map(([st, total]) => ({ type: dicts.serviceTypes[st], total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  const weekMap = new Map<number, number>();
  for (const row of current.explorer.weeklyVolume) {
    weekMap.set(row.wk, (weekMap.get(row.wk) ?? 0) + row.n);
  }

  const weeklyTotals = Array.from(weekMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([wk, count]) => {
      const d = new Date(wk);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { week: label, count };
    });

  return { topServiceTypes, weeklyTotals };
}

export interface DailyVolumeByCategory {
  dayLabels: string[];
  xTickVals: string[];
  xTickText: string[];
  traces: Array<{
    x: string[];
    y: number[];
    name: string;
    type: 'bar';
    marker: { color: string };
    hovertemplate: string[];
  }>;
}

/** Sparse x-axis ticks for a month of daily bars — day numbers only. */
function dailyVolumeAxisTicks(dayLabels: string[]): { xTickVals: string[]; xTickText: string[] } {
  const step = dayLabels.length <= 14 ? 2 : dayLabels.length <= 21 ? 3 : 5;
  const xTickVals: string[] = [];
  const xTickText: string[] = [];

  for (let i = 0; i < dayLabels.length; i += 1) {
    const isFirst = i === 0;
    const isLast = i === dayLabels.length - 1;
    const isInterval = i % step === 0;
    if (isFirst || isLast || isInterval) {
      xTickVals.push(dayLabels[i]);
      xTickText.push(String(i + 1));
    }
  }

  return { xTickVals, xTickText };
}

/** Sparse x-axis ticks for cohort flow — day numbers in-month, dates in follow-up. */
function cohortFlowAxisTicks(
  dayLabels: string[],
  filingMonthDayCount: number,
): { xTickVals: string[]; xTickText: string[] } {
  const step = dayLabels.length <= 31 ? 5 : dayLabels.length <= 62 ? 7 : 14;
  const xTickVals: string[] = [];
  const xTickText: string[] = [];

  for (let i = 0; i < dayLabels.length; i += 1) {
    const isFirst = i === 0;
    const isMonthEnd = i === filingMonthDayCount - 1;
    const isLast = i === dayLabels.length - 1;
    const isInterval = i % step === 0;
    if (isFirst || isMonthEnd || isLast || isInterval) {
      xTickVals.push(dayLabels[i]);
      xTickText.push(i < filingMonthDayCount ? String(i + 1) : dayLabels[i]);
    }
  }

  return { xTickVals, xTickText };
}

/** Stacked daily filing volume by category for one report month. */
export function computeDailyVolumeByCategory(
  rows: ProcessedRequest[],
  month: string,
): DailyVolumeByCategory {
  const monthDays = filingMonthDays(month);
  const dayKeys = monthDays.map((day) => day.key);
  const dayLabels = monthDays.map((day) => day.label);
  const { xTickVals, xTickText } = dailyVolumeAxisTicks(dayLabels);

  const dayCat = new Map<string, Map<string, number>>();
  for (const key of dayKeys) {
    dayCat.set(key, new Map());
  }

  for (const row of rows) {
    if (filingMonthKey(row.date) !== month) continue;
    const key = filingDayKey(row.date);
    const catMap = dayCat.get(key);
    if (!catMap) continue;
    catMap.set(row.category, (catMap.get(row.category) ?? 0) + 1);
  }

  const categoryTotals = new Map<string, number>();
  for (const catMap of dayCat.values()) {
    for (const [category, count] of catMap.entries()) {
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + count);
    }
  }

  const categories = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category]) => category);

  const traces = categories.map((category, index) => {
    const y = dayKeys.map((key) => dayCat.get(key)?.get(category) ?? 0);
    return {
      x: dayLabels,
      y,
      name: category,
      type: 'bar' as const,
      marker: { color: CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length] },
      hovertemplate: y.map((count) => (
        count > 0
          ? '<b>%{fullData.name}</b>: %{y:,}<extra></extra>'
          : '<extra></extra>'
      )),
    };
  });

  return { dayLabels, xTickVals, xTickText, traces };
}

/** SLA status colors aligned with the SLA status map. */
const DISPOSITION_COLORS: Record<CohortDispositionBucket['key'], string> = {
  met: '#2ecc71',
  missed: '#e74c3c',
  open_within: '#f39c12',
  open_overdue: '#c0392b',
  no_sla: '#95a5a6',
};

const DISPOSITION_LABELS: Record<CohortDispositionBucket['key'], string> = {
  met: 'Resolved in SLA',
  missed: 'Resolved out of SLA',
  open_within: 'Open within SLA',
  open_overdue: 'Open out of SLA',
  no_sla: 'No SLA defined',
};

export const COHORT_DISPOSITION_STACK_ORDER: CohortDispositionBucket['key'][] = [
  'met',
  'missed',
  'open_overdue',
  'open_within',
  'no_sla',
];

/** Weighted percentile of SLA deadlines across service types in a filing month. */
function weightedSlaPercentile(rollup: RollupFile, pct: number): number {
  const eligible = rollup.sla.filter((r) => r.sla_days > 0 && r.total > 0);
  if (eligible.length === 0) return 0;

  const totalWeight = eligible.reduce((s, r) => s + r.total, 0);
  const sorted = [...eligible].sort((a, b) => a.sla_days - b.sla_days);
  const target = totalWeight * (pct / 100);
  let cum = 0;
  for (const row of sorted) {
    cum += row.total;
    if (cum >= target) return row.sla_days;
  }
  return sorted[sorted.length - 1].sla_days;
}

/** When most open tickets should have cleared their SLA window. */
function computeStableAfterLabel(month: string, rollup: RollupFile): string | null {
  const p90Sla = weightedSlaPercentile(rollup, 90);
  if (p90Sla <= 0) return null;

  const [year, mon] = month.split('-').map(Number);
  const stableDate = new Date(year, mon, 0);
  stableDate.setDate(stableDate.getDate() + Math.ceil(p90Sla));
  return stableDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Four-bucket disposition of a filing-month cohort (100% stacked bar). */
export function computeCohortDisposition(rollup: RollupFile): CohortDispositionBucket[] {
  let met = 0;
  let missed = 0;
  let overdue = 0;
  let total = 0;

  for (const row of rollup.sla) {
    met += row.met_sla_count;
    missed += row.missed_sla_count;
    overdue += row.open_past_sla_count;
    total += row.total;
  }

  let open = 0;
  for (const row of rollup.explorer.categoryBreakdown) {
    open += row.open;
  }

  const openWithin = Math.max(0, open - overdue);
  const noSla = Math.max(0, total - met - missed - openWithin - overdue);

  const counts: Record<CohortDispositionBucket['key'], number> = {
    met,
    missed,
    open_within: openWithin,
    open_overdue: overdue,
    no_sla: noSla,
  };

  const order = COHORT_DISPOSITION_STACK_ORDER;

  return order
    .map((key) => ({
      key,
      label: DISPOSITION_LABELS[key],
      count: counts[key],
      color: DISPOSITION_COLORS[key],
    }))
    .filter((b) => b.count > 0);
}

/** Headline vs closed-only SLA, stability date, and summary copy for the cohort. */
export function computeCohortSettling(rollup: RollupFile, dicts: DataDictionaries): CohortSettling {
  const agg = aggregateMonth(rollup, dicts);
  const buckets = computeCohortDisposition(rollup);
  const closed = agg.met + agg.missed;
  const openWithin = Math.max(0, agg.open - agg.overdue);

  const pctClosed = agg.total > 0 ? round1((closed / agg.total) * 100) : 0;
  const pctOpenWithin = agg.total > 0 ? round1((openWithin / agg.total) * 100) : 0;
  const pctSlaOutcomeKnownPct = pctSlaOutcomeKnown(agg.total, agg.met, agg.missed, agg.overdue);
  const stableAfterLabel = agg.open > 0 && pctSlaOutcomeKnownPct < SLA_OUTCOME_KNOWN_THRESHOLD
    ? computeStableAfterLabel(rollup.month, rollup)
    : null;

  const summaryParts = [`${pctClosed}% closed`, `${pctOpenWithin}% still within SLA`];
  if (stableAfterLabel) {
    summaryParts.push(`SLA% may shift until ${stableAfterLabel}`);
  }

  return {
    total: agg.total,
    buckets,
    pctClosed,
    pctOpenWithin,
    pctSlaOutcomeKnown: pctSlaOutcomeKnownPct,
    pctMetSla: agg.pctMetSla,
    pctMetSlaClosedOnly: agg.pctMetSlaClosedOnly,
    stableAfterLabel,
    summaryLine: summaryParts.join(' · '),
    slaComparisonLine: `Headline ${agg.pctMetSla}% met SLA · Closed-only ${agg.pctMetSlaClosedOnly}%`,
    slaOutcomeKnownLine: slaOutcomeKnownLabel(pctSlaOutcomeKnownPct),
  };
}

/** Max day axis for a filing cohort's completion curve. */
function cohortCurveMax(rows: ProcessedRequest[]): number {
  const closedDays = rows
    .filter((r) => r.is_closed && r.resolution_days !== null && r.resolution_days >= 0)
    .map((r) => r.resolution_days!);
  const maxOpenAge = rows
    .filter((r) => r.is_open)
    .reduce((max, r) => Math.max(max, r.age_days), 0);

  return Math.min(
    120,
    Math.max(
      closedDays.length > 0 ? Math.ceil(Math.max(...closedDays)) : 0,
      Math.ceil(maxOpenAge),
    ),
  );
}

/** Share of a filing-month cohort closed by days since filing. */
export function computeCumulativeResolutionCurve(
  rows: ProcessedRequest[],
  month: string,
): CumulativeResolutionCurve {
  const cohort = rows.filter((r) => filingMonthKey(r.date) === month);
  const total = cohort.length;
  if (total === 0) return { days: [], pctClosed: [] };

  const closedDays = cohort
    .filter((r) => r.is_closed && r.resolution_days !== null && r.resolution_days >= 0)
    .map((r) => r.resolution_days!);

  const curveMax = cohortCurveMax(cohort);
  const days: number[] = [];
  const pctClosed: number[] = [];
  for (let d = 0; d <= curveMax; d++) {
    const closedByDay = closedDays.filter((rd) => rd <= d).length;
    days.push(d);
    pctClosed.push(round1((closedByDay / total) * 100));
  }

  return { days, pctClosed };
}

/** SLA window in days from filing to due date; null when no due date. */
function slaWindowDays(row: ProcessedRequest): number | null {
  if (!row.SERVICEDUEDATE) return null;
  const due = parseUtcRowTimestamp(row.SERVICEDUEDATE);
  const windowMs = due.getTime() - row.date.getTime();
  if (windowMs < 0) return null;
  return windowMs / 86400000;
}

/** Age in whole days at end of a UTC calendar day. */
function ageDaysOnDay(filedDate: Date, dayKey: string): number {
  const [year, mon, day] = dayKey.split('-').map(Number);
  const endOfDay = Date.UTC(year, mon - 1, day, 23, 59, 59, 999);
  return Math.floor((endOfDay - filedDate.getTime()) / 86400000);
}

/** Whether an open request is past its SLA deadline on a calendar day. */
function isPastSlaOnDay(row: ProcessedRequest, dayKey: string): boolean {
  const slaDays = slaWindowDays(row);
  if (slaDays === null) return false;
  return ageDaysOnDay(row.date, dayKey) > slaDays;
}

/** Whether a request is closed by end of a calendar day. */
function isResolvedByDay(row: ProcessedRequest, dayKey: string, asOfKey: string): boolean {
  const resolvedKey = resolutionDayKey(row);
  return resolvedKey !== null && resolvedKey <= dayKey && resolvedKey <= asOfKey;
}

/** Cumulative resolved and open totals for a filing-month cohort on calendar days. */
export function computeCohortFlow(
  rows: ProcessedRequest[],
  month: string,
  asOf: Date = new Date(),
): CohortFlowChart {
  const monthDays = filingMonthDays(month);
  const chartDays = cohortChartDays(month);
  const asOfKey = filingDayKey(asOf);
  const visibleDays = chartDays.filter((day) => day.key <= asOfKey);

  if (visibleDays.length === 0) {
    return { dayLabels: [], xTickVals: [], xTickText: [], traces: [], hasData: false };
  }

  const dayLabels = visibleDays.map((day) => day.label);
  const visibleMonthDayCount = monthDays.filter((day) => day.key <= asOfKey).length;
  const { xTickVals, xTickText } = cohortFlowAxisTicks(dayLabels, visibleMonthDayCount);
  const visibleCount = visibleDays.length;

  const cohort = rows.filter((r) => filingMonthKey(r.date) === month);
  if (cohort.length === 0) {
    return { dayLabels, xTickVals, xTickText, traces: [], hasData: false };
  }

  const cumulativeResolved: number[] = [];
  const cumulativeOpenWithin: number[] = [];
  const cumulativeOpenPast: number[] = [];

  for (let dayIdx = 0; dayIdx < visibleCount; dayIdx += 1) {
    const dayKey = visibleDays[dayIdx].key;
    let resolved = 0;
    let openWithin = 0;
    let openPast = 0;

    for (const row of cohort) {
      if (filingDayKey(row.date) > dayKey) continue;
      if (isResolvedByDay(row, dayKey, asOfKey)) {
        resolved++;
      } else if (isPastSlaOnDay(row, dayKey)) {
        openPast++;
      } else {
        openWithin++;
      }
    }

    cumulativeResolved.push(resolved);
    cumulativeOpenWithin.push(openWithin);
    cumulativeOpenPast.push(openPast);
  }

  const cumulativeFiled = cumulativeResolved.map(
    (resolved, idx) => resolved + cumulativeOpenWithin[idx] + cumulativeOpenPast[idx],
  );
  const pctOfFiled = (count: number, idx: number) => (
    cumulativeFiled[idx] > 0 ? round1((count / cumulativeFiled[idx]) * 100) : 0
  );

  const traces = [
    {
      x: dayLabels,
      y: cumulativeResolved,
      customdata: cumulativeResolved.map((count, idx) => pctOfFiled(count, idx)),
      name: 'Resolved',
      type: 'bar' as const,
      marker: { color: colors.success },
      hovertemplate: cumulativeResolved.map((count) => (
        count > 0
          ? 'Resolved: %{y:,} (%{customdata:.1f}%)<extra></extra>'
          : '<extra></extra>'
      )),
    },
    {
      x: dayLabels,
      y: cumulativeOpenWithin,
      customdata: cumulativeOpenWithin.map((count, idx) => pctOfFiled(count, idx)),
      name: 'Open within SLA',
      type: 'bar' as const,
      marker: { color: DISPOSITION_COLORS.open_within, opacity: 0.85 },
      hovertemplate: cumulativeOpenWithin.map((count) => (
        count > 0
          ? 'Open within SLA: %{y:,} (%{customdata:.1f}%)<extra></extra>'
          : '<extra></extra>'
      )),
    },
    {
      x: dayLabels,
      y: cumulativeOpenPast,
      customdata: cumulativeOpenPast.map((count, idx) => pctOfFiled(count, idx)),
      name: 'Open past SLA',
      type: 'bar' as const,
      marker: { color: DISPOSITION_COLORS.open_overdue },
      hovertemplate: cumulativeOpenPast.map((count) => (
        count > 0
          ? 'Open past SLA: %{y:,} (%{customdata:.1f}%)<extra></extra>'
          : '<extra></extra>'
      )),
    },
  ];

  return { dayLabels, xTickVals, xTickText, traces, hasData: true };
}

/** Open-request age distribution at month end. */
export function computeBacklogSnapshot(
  rows: ProcessedRequest[],
  prevOpenTotal: number | null,
): BacklogSnapshot {
  const openRows = rows.filter((r) => r.is_open);
  if (openRows.length === 0) {
    return {
      buckets: [],
      total: 0,
      prevTotal: prevOpenTotal,
      delta: prevOpenTotal !== null ? -prevOpenTotal : null,
    };
  }

  const maxAge = openRows.reduce((max, r) => Math.max(max, r.age_days), 0);
  const p99End = Math.ceil(maxAge * 0.99) + 1;
  const counts = new Array(p99End + 1).fill(0) as number[];

  for (const r of openRows) {
    const day = Math.max(0, Math.floor(r.age_days));
    counts[Math.min(day, p99End)]++;
  }

  const buckets: BacklogSnapshot['buckets'] = [];
  for (let day = 0; day < p99End; day++) {
    buckets.push({ label: String(day), count: counts[day] });
  }
  if (counts[p99End] > 0) {
    buckets.push({ label: `${p99End}+`, count: counts[p99End] });
  }

  const total = openRows.length;
  const delta = prevOpenTotal !== null ? total - prevOpenTotal : null;

  return { buckets, total, prevTotal: prevOpenTotal, delta };
}

/** Formats cohort outcome-known stability for the scorecard. */
export function formatOutcomeKnownScorecardKpi(
  pctSlaOutcomeKnown: number,
  immatureCohort: boolean,
): ScorecardKpiDisplay {
  const tone = immatureCohort ? 'warning' : 'success';
  const detail = immatureCohort ? SCORECARD_SETTLING_DETAIL : 'Stable for reporting';

  return {
    value: formatPctSlaOutcomeKnown(pctSlaOutcomeKnown),
    detail,
    tone,
  };
}

/** Formats resolution rate as a share of this month's filings. */
export function formatResolvedScorecardKpi(
  resolved: number,
  filed: number,
  immatureCohort = false,
): ScorecardKpiDisplay {
  const pct = filed > 0 ? round1((resolved / filed) * 100) : 0;

  if (filed === 0) {
    return { value: '0%', detail: 'No filings this month', tone: 'default' };
  }

  let detail = `${resolved.toLocaleString('en-US')} closed`;
  if (immatureCohort) {
    detail += ' · within SLA window';
  }

  return { value: `${pct}%`, detail, tone: immatureCohort ? 'warning' : 'default' };
}

export type ScorecardKpiKind = 'filed' | 'median';

export interface ScorecardKpiDisplay {
  value: string;
  detail: string | null;
  tone: 'default' | 'success' | 'warning' | 'danger';
}

/** Short scorecard KPI definitions for the label (i) tooltips. */
export const SCORECARD_KPI_INFO = {
  pctMetSla:
    'This month\u2019s SLA compliance: share resolved on time and verdict vs the 99% target. Below 95%, misses become noticeable.',
  requestsFiled:
    'This month\u2019s volume and resolution progress \u2014 how many requests opened and how much of the cohort has closed.',
  categoriesBySla:
    'How mature categories split across the 99% target, slipping (95\u201399%), and below 95%, plus any still within the SLA window.',
  reportingReadiness:
    `Whether this month\u2019s cohort has settled enough to trust compliance. Expect \u2265${SLA_OUTCOME_KNOWN_THRESHOLD}% with a final SLA outcome; the bar shows where the rest stand.`,
} as const;

const SCORECARD_SETTLING_DETAIL = 'Data still settling';

/** Formats % Met SLA with a this-month performance verdict, not MoM. */
export function formatSlaScorecardKpi(pctMetSla: number, immatureCohort = false): ScorecardKpiDisplay {
  const verdict = slaVerdictLabel(pctMetSla);
  return {
    value: `${pctMetSla}%`,
    detail: immatureCohort ? SCORECARD_SETTLING_DETAIL : verdict.label,
    tone: immatureCohort ? 'warning' : verdict.tone,
  };
}

/** Net MoM score: gains in meeting bands minus losses to slipping/below. */
export function computeCategorySlaBandMoMScore(
  current: CategorySlaBandCounts,
  prev: CategorySlaBandCounts,
): number {
  const successDelta = current.success - prev.success;
  const warningDelta = current.warning - prev.warning;
  const dangerDelta = current.danger - prev.danger;
  return successDelta - warningDelta - dangerDelta;
}

type CategorySlaBandMoMVerdict = 'much_better' | 'better' | 'same' | 'worse' | 'much_worse';

/** Maps a band-change score to a short scorecard verdict. */
export function categorySlaBandMoMVerdict(score: number): {
  key: CategorySlaBandMoMVerdict;
  label: string;
  tone: ScorecardKpiDisplay['tone'];
} {
  if (score >= 2) {
    return { key: 'much_better', label: 'Clear improvement', tone: 'success' };
  }
  if (score === 1) {
    return { key: 'better', label: 'Gaining ground', tone: 'success' };
  }
  if (score === 0) {
    return { key: 'same', label: 'Holding steady', tone: 'default' };
  }
  if (score === -1) {
    return { key: 'worse', label: 'Losing ground', tone: 'warning' };
  }
  return { key: 'much_worse', label: 'Clear setback', tone: 'danger' };
}

function categorySettlingDetail(count: number): string {
  return count === 1 ? '1 settling' : `${count} settling`;
}

/** Formats category SLA band counts with a MoM mix judgment. */
export function formatCategorySlaBandsScorecardKpi(
  current: CategorySlaBandCounts,
  prev: CategorySlaBandCounts | null,
): ScorecardKpiDisplay {
  const value = `${current.success} · ${current.warning} · ${current.danger}`;
  const settlingNote = current.settling > 0 ? categorySettlingDetail(current.settling) : null;

  if (!prev) {
    return {
      value,
      detail: settlingNote ?? `${current.total} with SLA data`,
      tone: settlingNote ? 'warning' : 'default',
    };
  }

  const verdict = categorySlaBandMoMVerdict(computeCategorySlaBandMoMScore(current, prev));
  const momDetail = `${verdict.label} vs last month`;

  return {
    value,
    detail: settlingNote ? `${settlingNote} · ${momDetail}` : momDetail,
    tone: settlingNote ? 'warning' : verdict.tone,
  };
}

/** Plain-language summary of category SLA band counts for display and assistive tech. */
export function formatCategorySlaBandAccessibleSummary(
  counts: CategorySlaBandCounts,
  prev: CategorySlaBandCounts | null = null,
): string {
  if (counts.total === 0 && counts.settling === 0) return 'No categories with SLA data';

  const parts: string[] = [];
  if (counts.success > 0) {
    parts.push(`${counts.success} meeting expectations`);
  }
  if (counts.warning > 0) {
    parts.push(`${counts.warning} slipping`);
  }
  if (counts.danger > 0) {
    parts.push(`${counts.danger} below expectations`);
  }
  if (counts.settling > 0) {
    parts.push(`${counts.settling} still within SLA window`);
  }

  const mix = parts.join(', ');
  if (!prev) return mix;

  const verdict = categorySlaBandMoMVerdict(computeCategorySlaBandMoMScore(counts, prev));
  return `${mix}. ${verdict.label} vs last month.`;
}

/** Plain-language summary of a cohort disposition bar for assistive tech. */
export function formatCohortDispositionAccessibleSummary(
  buckets: CohortDispositionBucket[],
  total: number,
  pctSlaOutcomeKnown: number,
): string {
  if (total === 0) return 'No requests in cohort';

  const mix = buckets
    .map((b) => {
      const pct = round1((b.count / total) * 100);
      return `${b.label} ${pct}%`;
    })
    .join(', ');

  return `${mix}. ${formatPctSlaOutcomeKnown(pctSlaOutcomeKnown)} outcomes known.`;
}

/** Formats filing volume with cohort resolution progress. */
export function formatFiledScorecardKpi(totalFiled: number, totalResolved: number): ScorecardKpiDisplay {
  if (totalFiled === 0) {
    return { value: '0', detail: 'No filings this month', tone: 'default' };
  }

  const pctResolved = round1((totalResolved / totalFiled) * 100);
  const remaining = Math.max(0, totalFiled - totalResolved);

  return {
    value: totalFiled.toLocaleString('en-US'),
    detail: `${pctResolved}% resolved, ${remaining.toLocaleString('en-US')} left to go`,
    tone: 'default',
  };
}

function scorecardComparisonSentence(delta: DeltaValue | null, kind: ScorecardKpiKind): string | null {
  if (!delta) return null;
  if (delta.direction === 'flat') return 'Unchanged from last month';

  const n = Math.abs(delta.absolute);
  const count = n.toLocaleString('en-US');

  switch (kind) {
    case 'filed':
      return delta.direction === 'up'
        ? `${count} more filed than last month`
        : `${count} fewer filed than last month`;
    case 'median':
      return delta.direction === 'down'
        ? `${n} day${n === 1 ? '' : 's'} faster than last month`
        : `${n} day${n === 1 ? '' : 's'} slower than last month`;
  }
}

/** Formats a scorecard KPI with a plain-language MoM comparison line. */
export function formatScorecardKpi(
  value: string,
  delta: DeltaValue | null,
  kind: ScorecardKpiKind,
): ScorecardKpiDisplay {
  const detail = scorecardComparisonSentence(delta, kind);
  if (!delta || delta.direction === 'flat') {
    return { value, detail, tone: 'default' };
  }

  const improvesWhen = kind === 'median' ? 'down' : null;

  const tone = improvesWhen === null
    ? 'default'
    : delta.direction === improvesWhen
      ? 'success'
      : 'danger';

  return { value, detail, tone };
}
