import { DataDictionaries, DataShardMeta, RollupFile } from '../api/dataTypes';
import { ProcessedRequest } from './dataProcessing';
import { isImmatureCohort, pctSlaOutcomeKnown, slaOutcomeKnownLabel, SLA_OUTCOME_KNOWN_THRESHOLD, slaTone, slaVerdictLabel } from './overviewAnalytics';
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

/** SLA status colors aligned with the SLA status map. */
const DISPOSITION_COLORS: Record<CohortDispositionBucket['key'], string> = {
  met: '#2ecc71',
  missed: '#e74c3c',
  open_within: '#f39c12',
  open_overdue: '#c0392b',
  no_sla: '#95a5a6',
};

const DISPOSITION_LABELS: Record<CohortDispositionBucket['key'], string> = {
  met: 'Resolved on time',
  missed: 'Resolved late',
  open_within: 'Open within SLA',
  open_overdue: 'Open overdue',
  no_sla: 'No SLA defined',
};

function filingMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

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

  const order: CohortDispositionBucket['key'][] = [
    'met',
    'open_within',
    'missed',
    'open_overdue',
    'no_sla',
  ];

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

  const maxOpenAge = cohort
    .filter((r) => r.is_open)
    .reduce((max, r) => Math.max(max, r.age_days), 0);

  const curveMax = Math.min(
    120,
    Math.max(
      closedDays.length > 0 ? Math.ceil(Math.max(...closedDays)) : 0,
      Math.ceil(maxOpenAge),
    ),
  );

  const days: number[] = [];
  const pctClosed: number[] = [];
  for (let d = 0; d <= curveMax; d++) {
    const closedByDay = closedDays.filter((rd) => rd <= d).length;
    days.push(d);
    pctClosed.push(round1((closedByDay / total) * 100));
  }

  return { days, pctClosed };
}

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

/** Formats % Met SLA with a this-month performance verdict, not MoM. */
export function formatSlaScorecardKpi(pctMetSla: number): ScorecardKpiDisplay {
  const verdict = slaVerdictLabel(pctMetSla);
  return {
    value: `${pctMetSla}%`,
    detail: verdict.label,
    tone: verdict.tone,
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
