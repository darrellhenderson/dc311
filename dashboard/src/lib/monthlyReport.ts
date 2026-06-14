import { DataDictionaries, DataShardMeta, RollupFile } from '../api/dataTypes';
import { ProcessedRequest } from './dataProcessing';
import { slaTone } from './overviewAnalytics';
import { mergeSlaRollups } from './rollups';

export interface DeltaValue {
  absolute: number;
  direction: 'up' | 'down' | 'flat';
  formatted: string;
}

export interface MonthlyScorecard {
  month: string;
  label: string;
  pctMetSla: number;
  totalFiled: number;
  totalResolved: number;
  medianResolutionDays: number;
  netBacklogChange: number;
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

interface MonthAgg {
  total: number;
  closed: number;
  missed: number;
  overdue: number;
  open: number;
  resolved: number;
  pctMetSla: number;
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
  let missed = 0;
  let overdue = 0;
  let medSum = 0;

  for (const row of file.sla) {
    total += row.total;
    closed += row.closed;
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
  const medianResolution = closed > 0 ? round1(medSum / closed) : 0;

  return { total, closed, missed, overdue, open, resolved, pctMetSla, medianResolution };
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
    totalFiled: cur.total,
    totalResolved: cur.resolved,
    medianResolutionDays: cur.medianResolution,
    netBacklogChange: cur.total - cur.resolved,
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

function categoryStatsFromRollup(file: RollupFile, dicts: DataDictionaries): Map<string, { total: number; pctMetSla: number }> {
  const slaRows = mergeSlaRollups([file], dicts);
  const stats = new Map<string, { total: number; missed: number; overdue: number }>();

  for (const row of slaRows) {
    const existing = stats.get(row.category) ?? { total: 0, missed: 0, overdue: 0 };
    existing.total += row.total;
    existing.missed += row.missed_sla_count;
    existing.overdue += row.open_past_sla_count;
    stats.set(row.category, existing);
  }

  const result = new Map<string, { total: number; pctMetSla: number }>();
  for (const [category, s] of stats) {
    const good = s.total - s.missed - s.overdue;
    result.set(category, {
      total: s.total,
      pctMetSla: s.total > 0 ? round1((good / s.total) * 100) : 0,
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

export function computeBacklogSnapshot(
  rows: ProcessedRequest[],
  prevOpenTotal: number | null,
  ageBucketLabels: string[],
): BacklogSnapshot {
  const openRows = rows.filter((r) => r.is_open);
  const bucketCounts = new Map<string, number>();
  for (const label of ageBucketLabels) {
    bucketCounts.set(label, 0);
  }
  for (const r of openRows) {
    const count = bucketCounts.get(r.age_bucket) ?? 0;
    bucketCounts.set(r.age_bucket, count + 1);
  }

  const buckets = ageBucketLabels.map((label) => ({
    label,
    count: bucketCounts.get(label) ?? 0,
  }));

  const total = openRows.length;
  const delta = prevOpenTotal !== null ? total - prevOpenTotal : null;

  return { buckets, total, prevTotal: prevOpenTotal, delta };
}

export function formatKpiWithDelta(
  value: string,
  delta: DeltaValue | null,
  goodDirection: 'up' | 'down',
): { value: string; tone: 'success' | 'warning' | 'danger' | 'default' } {
  if (!delta || delta.direction === 'flat') {
    return { value, tone: 'default' };
  }
  const arrow = delta.direction === 'up' ? '▲' : '▼';
  const isGood = delta.direction === goodDirection;
  const tone = isGood ? 'success' : 'danger';
  return { value: `${value} ${arrow} ${delta.formatted}`, tone };
}
