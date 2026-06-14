import { DataDictionaries, RollupFile } from '../api/dataTypes';
import { SLARow, slaCategorySummary, ProcessedRequest } from './dataProcessing';
import { mergeSlaRollups } from './rollups';
import { colors } from './theme';

// Service type targeted by the city's traffic-calming deep-dive program.
const DEEP_DIVE_TARGET_TYPE = 'Traffic Safety Input';

export interface CategoryMonthlySla {
  category: string;
  months: MonthlySlaSummary[];
}

const BELOW_TARGET_FLOOR = 30; // At or below 30% saturates to near-black.

function mixHex(light: string, dark: string, amount: number): string {
  const parse = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  const [lr, lg, lb] = parse(light);
  const [dr, dg, db] = parse(dark);
  const t = Math.max(0, Math.min(1, amount));
  const ch = (a: number, b: number) => Math.round(a + (b - a) * t);
  const r = ch(lr, dr);
  const g = ch(lg, dg);
  const b = ch(lb, db);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** Fill color for an SLA score; below 95% darkens from danger red toward near-black at 30%. */
export function slaScoreColor(pctMetSla: number): string {
  if (pctMetSla >= 99) return colors.success;
  if (pctMetSla >= 95) return colors.warning;
  const severity = Math.max(0, Math.min(1, (95 - pctMetSla) / (95 - BELOW_TARGET_FLOOR)));
  return mixHex(colors.danger, colors.primaryDeep, severity);
}

/** Solid fill per month; below 95% darkens as compliance falls. */
export function slaMonthBarColor(month: MonthlySlaSummary): string {
  if (month.total === 0) return '#e5e7eb';
  return slaScoreColor(month.pctMetSla);
}

export type SlaTone = 'success' | 'warning' | 'danger';

export interface MonthlySlaSummary {
  month: string;
  label: string;
  pctMetSla: number;
  pctMetSlaClosedOnly: number;
  total: number;
  failures: number;
  open: number;
  resolved: number;
  pctResolved: number;
  immatureCohort: boolean;
  tone: SlaTone;
}

export interface OverviewHeadline {
  total: number;
  resolved: number;
  open: number;
  pctResolved: number;
  pctMetSla: number;
  failures: number;
  errorBudgetAt99: number;
  errorBudgetConsumed: number;
  tone: SlaTone;
}

export interface WardEquitySummary {
  minWard: string;
  maxWard: string;
  minPct: number;
  maxPct: number;
  spread: number;
}

export type PitfallReason =
  | 'lax_sla'
  | 'open_masking'
  | 'low_volume'
  | 'cherry_pick';

export interface PitfallCase {
  serviceType: string;
  category: string;
  reason: PitfallReason;
  total: number;
  slaDays: number;
  pctMetSla: number;
  pctResolved: number;
  commentary: string;
}

export interface CherryPickSensitivity {
  headlinePct: number;
  withoutTop3Pct: number;
  top3Types: string[];
  delta: number;
}

export interface InvestigativeDeepDive {
  serviceType: string;
  monthA: string;
  monthB: string;
  pctA: number;
  pctB: number;
  volumeA: number;
  volumeB: number;
  narrative: string;
}

/** Urbanist categories highlighted on the overview front page. */
export const URBANIST_PRIORITY_CATEGORIES = [
  'Pedestrian Infrastructure',
  'Cycling & Micromobility',
  'Transit',
  'Traffic Safety',
  'Roads & Vehicle Infrastructure',
] as const;

/** Resident-facing categories for the perceptibility essay chart. Transit is excluded (incomplete SLA data); roads are omitted by design. */
export const PERCEPTIBILITY_RESIDENT_CATEGORIES = [
  'Pedestrian Infrastructure',
  'Cycling & Micromobility',
  'Traffic Safety',
  'Public Space & Parks',
  'Trees & Canopy',
  'Sanitation & Dumping',
  'Waste & Recycling',
  'Rodent Control',
] as const;

// Months whose >30% of cohort is still open are flagged as immature (insufficient time elapsed for SLA evaluation).
const IMMATURE_OPEN_RATIO = 0.3;

/** Service types omitted from the compliance-vs-resolution chart. */
const COMPLIANCE_COMPARISON_EXCLUDED_TYPES = new Set([
  'Roadway Repair',
]);

const COMPLIANCE_COMPARISON_MAX_CASES = 6;

export function slaTone(pctMetSla: number): SlaTone {
  if (pctMetSla >= 99) return 'success';
  if (pctMetSla >= 95) return 'warning';
  return 'danger';
}

/** Headline verdict for the overview hero; bands at 99%, 95%, and 80%. */
export function slaVerdictLabel(pctMetSla: number): { label: string; tone: SlaTone } {
  if (pctMetSla >= 99) return { label: 'Meeting expectations', tone: 'success' };
  if (pctMetSla >= 95) return { label: 'Slipping below expectations', tone: 'warning' };
  if (pctMetSla >= 80) return { label: 'Well below expectations', tone: 'danger' };
  return { label: 'Critically below expectations', tone: 'danger' };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function monthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function aggregateSlaFromRollup(file: RollupFile) {
  let total = 0;
  let closed = 0;
  let met = 0;
  let missed = 0;
  let overdue = 0;

  for (const row of file.sla) {
    total += row.total;
    closed += row.closed;
    met += row.met_sla_count;
    missed += row.missed_sla_count;
    overdue += row.open_past_sla_count;
  }

  const failures = missed + overdue;
  const good = total - failures;
  // pct_met_sla denominator is the full request count, not just rows with a due date.
  // Requests without SERVICEDUEDATE are neither missed nor overdue, so they count as met.
  // This intentionally matches the city's published methodology.
  const pctMetSla = total > 0 ? (good / total) * 100 : 0;
  const pctMetSlaClosedOnly = closed > 0 ? (met / closed) * 100 : 0;

  let open = 0;
  let resolved = 0;
  for (const row of file.explorer.categoryBreakdown) {
    open += row.open;
    resolved += row.resolved;
  }

  return { total, closed, met, missed, overdue, failures, good, pctMetSla, pctMetSlaClosedOnly, open, resolved };
}

/** Per filing-month SLA compliance for the status-page timeline. */
export function computeMonthlySlaSummary(rollups: RollupFile[]): MonthlySlaSummary[] {
  return [...rollups]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((file) => {
      const agg = aggregateSlaFromRollup(file);
      const pctResolved = agg.total > 0 ? (agg.resolved / agg.total) * 100 : 0;
      const immatureCohort = agg.total > 0 && agg.open / agg.total > IMMATURE_OPEN_RATIO;
      const pctMetSla = round1(agg.pctMetSla);

      return {
        month: file.month,
        label: monthLabel(file.month),
        pctMetSla,
        pctMetSlaClosedOnly: round1(agg.pctMetSlaClosedOnly),
        total: agg.total,
        failures: agg.failures,
        open: agg.open,
        resolved: agg.resolved,
        pctResolved: round1(pctResolved),
        immatureCohort,
        tone: slaTone(pctMetSla),
      };
    });
}

interface MonthCategoryBucket {
  total: number;
  closed: number;
  met: number;
  missed: number;
  overdue: number;
  open: number;
  resolved: number;
}

const EMPTY_MONTH_BUCKET: MonthCategoryBucket = {
  total: 0,
  closed: 0,
  met: 0,
  missed: 0,
  overdue: 0,
  open: 0,
  resolved: 0,
};

function filingMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseDueDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(dateStr);
}

function bucketFromAgg(month: string, agg: MonthCategoryBucket): MonthlySlaSummary {
  const failures = agg.missed + agg.overdue;
  // pct_met_sla denominator is the full request count, not just rows with a due date.
  // Requests without SERVICEDUEDATE are neither missed nor overdue, so they count as met.
  // This intentionally matches the city's published methodology.
  const pctMetSla = agg.total > 0 ? round1(((agg.total - failures) / agg.total) * 100) : 0;
  const pctMetSlaClosedOnly = agg.closed > 0 ? round1((agg.met / agg.closed) * 100) : 0;
  const pctResolved = agg.total > 0 ? round1((agg.resolved / agg.total) * 100) : 0;
  const immatureCohort = agg.total > 0 && agg.open / agg.total > IMMATURE_OPEN_RATIO;

  return {
    month,
    label: monthLabel(month),
    pctMetSla,
    pctMetSlaClosedOnly,
    total: agg.total,
    failures,
    open: agg.open,
    resolved: agg.resolved,
    pctResolved,
    immatureCohort,
    tone: slaTone(pctMetSla),
  };
}

/** Per filing-month SLA compliance by category for the performance sidebar. */
export function computeCategoryMonthlySlaSummary(requests: ProcessedRequest[]): CategoryMonthlySla[] {
  const buckets = new Map<string, MonthCategoryBucket>();
  const monthSet = new Set<string>();

  for (const r of requests) {
    const month = filingMonthKey(r.date);
    monthSet.add(month);
    const key = `${month}|${r.category}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        total: 0,
        closed: 0,
        met: 0,
        missed: 0,
        overdue: 0,
        open: 0,
        resolved: 0,
      });
    }
    const bucket = buckets.get(key)!;
    bucket.total++;
    if (r.is_open) bucket.open++;
    if (r.is_closed) {
      bucket.closed++;
      bucket.resolved++;
    }

    const dueDate = parseDueDate(r.SERVICEDUEDATE);
    if (dueDate) {
      const slaDays = (dueDate.getTime() - r.date.getTime()) / (1000 * 60 * 60 * 24);
      if (r.is_closed && r.resolution_days !== null) {
        if (r.resolution_days <= slaDays) bucket.met++;
        else bucket.missed++;
      }
      if (r.is_open && r.age_days > slaDays) bucket.overdue++;
    }
  }

  const allMonths = [...monthSet].sort((a, b) => a.localeCompare(b));
  const categories = [...new Set(requests.map((r) => r.category))].sort((a, b) => a.localeCompare(b));

  return categories.map((category) => ({
    category,
    months: allMonths.map((month) => {
      const agg = buckets.get(`${month}|${category}`);
      return bucketFromAgg(month, agg ?? EMPTY_MONTH_BUCKET);
    }),
  }));
}

/** Per filing-month SLA by category from monthly rollups (matches the timeline data source). */
export function computeCategoryMonthlySlaFromRollups(
  rollups: RollupFile[],
  dicts: DataDictionaries,
  eligibleServiceTypes?: Set<string>,
): CategoryMonthlySla[] {
  const buckets = new Map<string, MonthCategoryBucket>();
  const categorySet = new Set<string>();

  for (const file of rollups) {
    const month = file.month;

    for (const row of file.sla) {
      const serviceType = dicts.serviceTypes[row.serviceType];
      if (eligibleServiceTypes && !eligibleServiceTypes.has(serviceType)) continue;

      const category = dicts.categories[row.category];
      categorySet.add(category);
      const key = `${month}|${category}`;
      if (!buckets.has(key)) {
        buckets.set(key, { ...EMPTY_MONTH_BUCKET });
      }
      const bucket = buckets.get(key)!;
      bucket.total += row.total;
      bucket.closed += row.closed;
      bucket.met += row.met_sla_count;
      bucket.missed += row.missed_sla_count;
      bucket.overdue += row.open_past_sla_count;
    }

    for (const row of file.explorer.categoryBreakdown) {
      const category = dicts.categories[row.c];
      const bucket = buckets.get(`${month}|${category}`);
      if (!bucket) continue;
      bucket.open = row.open;
      bucket.resolved = row.resolved;
    }
  }

  const allMonths = [...rollups].map((file) => file.month).sort((a, b) => a.localeCompare(b));
  const categories = [...categorySet].sort((a, b) => a.localeCompare(b));

  return categories.map((category) => ({
    category,
    months: allMonths.map((month) => bucketFromAgg(month, buckets.get(`${month}|${category}`) ?? EMPTY_MONTH_BUCKET)),
  }));
}

/** Full-year headline KPIs for the overview hero. */
export function computeOverviewHeadline(rollups: RollupFile[]): OverviewHeadline {
  let total = 0;
  let resolved = 0;
  let open = 0;
  let failures = 0;

  for (const file of rollups) {
    const agg = aggregateSlaFromRollup(file);
    total += agg.total;
    resolved += agg.resolved;
    open += agg.open;
    failures += agg.failures;
  }

  const pctResolved = total > 0 ? (resolved / total) * 100 : 0;
  const pctMetSla = total > 0 ? ((total - failures) / total) * 100 : 0;
  const errorBudgetAt99 = Math.round(total * 0.01);

  return {
    total,
    resolved,
    open,
    pctResolved: round1(pctResolved),
    pctMetSla: round1(pctMetSla),
    failures,
    errorBudgetAt99,
    errorBudgetConsumed: failures,
    tone: slaTone(pctMetSla),
  };
}

/** Monthly filed volume and resolution throughput for the burden narrative chart. */
export function computeMonthlyThroughput(rollups: RollupFile[]) {
  return [...rollups]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((file) => {
      let filed = 0;
      let resolved = 0;
      for (const row of file.explorer.categoryBreakdown) {
        filed += row.open + row.resolved;
      }
      for (const row of file.explorer.typeCounts) {
        resolved += row.resolved;
      }
      return {
        month: file.month,
        label: monthLabel(file.month),
        filed,
        resolved,
      };
    });
}

/** SLA compliance for priority urbanist categories. */
export function computeUrbanistCategoryCompliance(
  rollups: RollupFile[],
  dicts: DataDictionaries,
) {
  const slaRows = mergeSlaRollups(rollups, dicts);
  const summary = slaCategorySummary(slaRows);
  const priority = new Set<string>(URBANIST_PRIORITY_CATEGORIES);

  return summary
    .filter((row) => priority.has(row.category))
    .sort((a, b) => {
      const ai = URBANIST_PRIORITY_CATEGORIES.indexOf(a.category as typeof URBANIST_PRIORITY_CATEGORIES[number]);
      const bi = URBANIST_PRIORITY_CATEGORIES.indexOf(b.category as typeof URBANIST_PRIORITY_CATEGORIES[number]);
      return ai - bi;
    });
}

/** Ward resolution spread; surfaces geographic equity on the front page. */
export function computeWardEquitySummary(
  rollups: RollupFile[],
  dicts: DataDictionaries,
): WardEquitySummary | null {
  const stats = new Map<number, { open: number; resolved: number }>();

  for (const file of rollups) {
    for (const row of file.explorer.wardVolume) {
      const existing = stats.get(row.w) ?? { open: 0, resolved: 0 };
      existing.open += row.open;
      existing.resolved += row.resolved;
      stats.set(row.w, existing);
    }
  }

  const wards: Array<{ ward: string; pct: number }> = [];
  for (const [w, s] of stats) {
    const total = s.open + s.resolved;
    if (total === 0) continue;
    wards.push({ ward: dicts.wards[w], pct: round1((s.resolved / total) * 100) });
  }

  if (wards.length < 2) return null;

  const sorted = [...wards].sort((a, b) => a.pct - b.pct);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return {
    minWard: min.ward,
    maxWard: max.ward,
    minPct: min.pct,
    maxPct: max.pct,
    spread: round1(max.pct - min.pct),
  };
}

/** Detects service types that illustrate common SLA measurement pitfalls. */
export function findSloPitfalls(slaRows: SLARow[]): PitfallCase[] {
  const cases: PitfallCase[] = [];

  for (const row of slaRows) {
    if (row.sla_days > 60 && row.pct_met_sla >= 99 && row.pct_resolved < 30) {
      cases.push({
        serviceType: row.SERVICECODEDESCRIPTION,
        category: row.category,
        reason: 'lax_sla',
        total: row.total,
        slaDays: row.sla_days,
        pctMetSla: row.pct_met_sla,
        pctResolved: row.pct_resolved,
        commentary: `A ${row.sla_days}-day SLA keeps most open tickets "compliant" while only ${row.pct_resolved}% have closed.`,
      });
    } else if (row.pct_met_sla - row.pct_resolved > 40 && row.total >= 50) {
      cases.push({
        serviceType: row.SERVICECODEDESCRIPTION,
        category: row.category,
        reason: 'open_masking',
        total: row.total,
        slaDays: row.sla_days,
        pctMetSla: row.pct_met_sla,
        pctResolved: row.pct_resolved,
        commentary: `${row.pct_met_sla}% met SLA versus ${row.pct_resolved}% resolved. Open tickets inflate the compliance rate.`,
      });
    } else if (row.total < 100 && (row.pct_met_sla === 0 || row.pct_met_sla === 100)) {
      cases.push({
        serviceType: row.SERVICECODEDESCRIPTION,
        category: row.category,
        reason: 'low_volume',
        total: row.total,
        slaDays: row.sla_days,
        pctMetSla: row.pct_met_sla,
        pctResolved: row.pct_resolved,
        commentary: `Only ${row.total} requests. ${row.pct_met_sla}% is not statistically meaningful at this volume.`,
      });
    }
  }

  return cases
    .sort((a, b) => {
      const priority: Record<PitfallReason, number> = { lax_sla: 0, open_masking: 1, low_volume: 2, cherry_pick: 3 };
      return priority[a.reason] - priority[b.reason] || b.total - a.total;
    })
    .slice(0, 8);
}

export interface ComplianceComparisonCase {
  serviceType: string;
  pctMetSla: number;
  pctResolved: number;
  pctMetSlaClosedOnly: number;
  /** Misleading = large compliance vs resolution gap; aligned = both track together. */
  kind: 'misleading' | 'aligned';
}

/** Service types for the compliance-vs-resolution chart: divergent examples plus aligned comparators. */
export function selectComplianceComparisonCases(slaRows: SLARow[]): ComplianceComparisonCase[] {
  const toCase = (row: SLARow, kind: ComplianceComparisonCase['kind']): ComplianceComparisonCase => ({
    serviceType: row.SERVICECODEDESCRIPTION,
    pctMetSla: row.pct_met_sla,
    pctResolved: row.pct_resolved,
    pctMetSlaClosedOnly: row.closed > 0 ? round1((row.met_sla_count / row.closed) * 100) : 0,
    kind,
  });

  const eligible = slaRows.filter(
    (row) => row.total >= 50 && !COMPLIANCE_COMPARISON_EXCLUDED_TYPES.has(row.SERVICECODEDESCRIPTION),
  );

  const misleading = eligible
    .filter((row) => row.pct_met_sla - row.pct_resolved >= 20)
    .sort(
      (a, b) =>
        (b.pct_met_sla - b.pct_resolved) - (a.pct_met_sla - a.pct_resolved) || b.total - a.total,
    )
    .slice(0, COMPLIANCE_COMPARISON_MAX_CASES)
    .map((row) => toCase(row, 'misleading'));

  const selected = new Set(misleading.map((row) => row.serviceType));
  const remaining = COMPLIANCE_COMPARISON_MAX_CASES - misleading.length;

  const aligned = remaining > 0
    ? eligible
      .filter((row) => !selected.has(row.SERVICECODEDESCRIPTION))
      .filter((row) => Math.abs(row.pct_met_sla - row.pct_resolved) <= 8 && row.pct_resolved >= 60)
      .sort((a, b) => b.total - a.total)
      .slice(0, remaining)
      .map((row) => toCase(row, 'aligned'))
    : [];

  return [...misleading, ...aligned];
}

/** Shows how headline compliance shifts when high-volume types are removed. */
export function computeCherryPickSensitivity(slaRows: SLARow[]): CherryPickSensitivity {
  const totalAll = slaRows.reduce((s, r) => s + r.total, 0);
  const failuresAll = slaRows.reduce((s, r) => s + r.missed_sla_count + r.open_past_sla_count, 0);
  const headlinePct = totalAll > 0 ? round1(((totalAll - failuresAll) / totalAll) * 100) : 0;

  const top3 = [...slaRows].sort((a, b) => b.total - a.total).slice(0, 3);
  const top3Set = new Set(top3.map((r) => r.SERVICECODEDESCRIPTION));
  const rest = slaRows.filter((r) => !top3Set.has(r.SERVICECODEDESCRIPTION));

  const totalRest = rest.reduce((s, r) => s + r.total, 0);
  const failuresRest = rest.reduce((s, r) => s + r.missed_sla_count + r.open_past_sla_count, 0);
  const withoutTop3Pct = totalRest > 0 ? round1(((totalRest - failuresRest) / totalRest) * 100) : 0;

  return {
    headlinePct,
    withoutTop3Pct,
    top3Types: top3.map((r) => r.SERVICECODEDESCRIPTION),
    delta: round1(withoutTop3Pct - headlinePct),
  };
}

/** Picks the strongest month-over-month swing for an investigative callout. */
export function findInvestigativeDeepDive(
  rollups: RollupFile[],
  dicts: DataDictionaries,
): InvestigativeDeepDive | null {
  const stIndex = dicts.serviceTypes.indexOf(DEEP_DIVE_TARGET_TYPE);
  if (stIndex < 0) return null;

  const byMonth = [...rollups]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((file) => {
      const row = file.sla.find((r) => r.serviceType === stIndex);
      if (!row || row.total < 30) return null;
      const failures = row.missed_sla_count + row.open_past_sla_count;
      const pct = round1(((row.total - failures) / row.total) * 100);
      return { month: file.month, pct, volume: row.total };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  if (byMonth.length < 2) return null;

  let bestA = byMonth[0];
  let bestB = byMonth[1];
  let bestDelta = Math.abs(bestB.pct - bestA.pct);

  for (let i = 0; i < byMonth.length; i++) {
    for (let j = i + 1; j < byMonth.length; j++) {
      const delta = Math.abs(byMonth[j].pct - byMonth[i].pct);
      if (delta > bestDelta) {
        bestDelta = delta;
        if (byMonth[i].pct < byMonth[j].pct) {
          bestA = byMonth[i];
          bestB = byMonth[j];
        } else {
          bestA = byMonth[j];
          bestB = byMonth[i];
        }
      }
    }
  }

  if (bestDelta < 20) return null;

  return {
    serviceType: DEEP_DIVE_TARGET_TYPE,
    monthA: monthLabel(bestA.month),
    monthB: monthLabel(bestB.month),
    pctA: bestA.pct,
    pctB: bestB.pct,
    volumeA: bestA.volume,
    volumeB: bestB.volume,
    narrative:
      `${DEEP_DIVE_TARGET_TYPE} compliance swung from ${bestA.pct}% (${bestA.volume.toLocaleString()} requests, ${monthLabel(bestA.month)}) to ${bestB.pct}% (${bestB.volume.toLocaleString()}, ${monthLabel(bestB.month)}). Whether the deadline changed, routing shifted, or backlog cleared requires a closer look.`,
  };
}

export interface CategoryHighlight {
  category: string;
  pctMetSla: number;
  total: number;
  failures: number;
  tone: SlaTone;
  why: string;
}

export type ArticlePart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; tab: 'sla' | 'explorer' };

export interface CategoryArticle {
  headline: string;
  dek: string;
  paragraphs: ArticlePart[][];
  figureCaption: string;
}

function truncateLabel(s: string, n = 36): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function explainCategory(category: string, rows: SLARow[], pctMetSla: number): string {
  const catRows = rows.filter((r) => r.category === category);
  if (catRows.length === 0) return '';

  const total = catRows.reduce((s, r) => s + r.total, 0);
  const missed = catRows.reduce((s, r) => s + r.missed_sla_count, 0);
  const overdue = catRows.reduce((s, r) => s + r.open_past_sla_count, 0);
  const closed = catRows.reduce((s, r) => s + r.closed, 0);
  const pctResolved = total > 0 ? round1((closed / total) * 100) : 0;
  const avgSla = total > 0
    ? round1(catRows.reduce((s, r) => s + r.sla_days * r.total, 0) / total)
    : 0;
  const topType = [...catRows].sort((a, b) => b.total - a.total)[0];

  if (pctMetSla >= 99) {
    if (avgSla <= 3) {
      return `Short SLAs (~${avgSla} days) on routable, high-throughput work, led by ${truncateLabel(topType.SERVICECODEDESCRIPTION)}.`;
    }
    if (pctResolved < 50) {
      return `${pctMetSla}% met SLA, but only ${pctResolved}% resolved. Long deadlines can mask open backlog.`;
    }
    return `On-time closure across ${catRows.length} service types at ${total.toLocaleString()} requests.`;
  }

  if (pctMetSla < 95) {
    if (overdue > missed * 1.2) {
      return `${overdue.toLocaleString()} open and overdue tickets. Backlog is driving the miss more than late closures.`;
    }
    if (missed > overdue) {
      return `${missed.toLocaleString()} resolved late. Resolution speed is the main failure mode, not open volume.`;
    }
    return `${(missed + overdue).toLocaleString()} known failures across ${total.toLocaleString()} requests.`;
  }

  return `Below the 99% target at ${total.toLocaleString()} requests.`;
}

function formatCategoryClause(item: CategoryHighlight): string {
  return `${item.category} (${item.pctMetSla}%, ${item.total.toLocaleString()} requests)`;
}

function joinClauses(items: CategoryHighlight[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return formatCategoryClause(items[0]);
  if (items.length === 2) {
    return `${formatCategoryClause(items[0])} and ${formatCategoryClause(items[1])}`;
  }
  const last = items[items.length - 1];
  const rest = items.slice(0, -1).map(formatCategoryClause).join(', ');
  return `${rest}, and ${formatCategoryClause(last)}`;
}

type CatSummaryRow = ReturnType<typeof slaCategorySummary>[number];

/** Category article dek from full summary counts, not the top-N highlights. */
function buildCategoryDek(catSummary: CatSummaryRow[]): string {
  const total = catSummary.length;
  const met99Count = catSummary.filter((c) => c.pct_met_sla >= 99).length;
  const below95Count = catSummary.filter((c) => c.pct_met_sla < 95).length;

  if (below95Count === 0) {
    return met99Count >= total / 2
      ? 'Most categories meet the 99% target. Failures still concentrate in a handful of high-traffic request types.'
      : 'No category falls below 95%, but most sit short of the 99% target. Failures concentrate in high-traffic request types.';
  }

  if (met99Count === 0) {
    return `No category clears the 99% target. ${below95Count} fall below 95%, often where volume and backlog collide.`;
  }

  if (met99Count < total / 2) {
    return `Only ${met99Count} of ${total} categories clear the 99% target. ${below95Count} fall below 95%, often where volume and backlog collide.`;
  }

  return `Most categories meet the 99% target. ${below95Count} ${below95Count === 1 ? 'category falls' : 'categories fall'} below 95%, often where volume and backlog collide.`;
}

function buildDoingWellParagraph(
  doingWell: CategoryHighlight[],
  met99Total: number,
): string {
  const lead = doingWell[0];
  const others = doingWell.slice(1);

  if (met99Total <= 2 && doingWell.length === met99Total) {
    if (met99Total === 1) {
      return `Only ${formatCategoryClause(lead)} clears the 99% target. ${lead.why}`;
    }
    return `Only ${joinClauses(doingWell)} clear the 99% target. ${lead.why}`;
  }

  let text = `The city meets the 99% target most reliably in ${formatCategoryClause(lead)}. ${lead.why}`;
  if (others.length > 0) {
    text += ` Similar patterns hold for ${joinClauses(others)}.`;
  }
  return text;
}

/** Builds category-section narrative from SLA aggregates. */
export function buildCategoryArticle(
  catSummary: ReturnType<typeof slaCategorySummary>,
  slaRows: SLARow[],
  wardEquity: WardEquitySummary | null,
): CategoryArticle {
  const toHighlight = (row: typeof catSummary[number]): CategoryHighlight => ({
    category: row.category,
    pctMetSla: row.pct_met_sla,
    total: row.total,
    failures: row.missed + row.overdue,
    tone: slaTone(row.pct_met_sla),
    why: explainCategory(row.category, slaRows, row.pct_met_sla),
  });

  const doingWell = catSummary
    .filter((c) => c.pct_met_sla >= 99)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .map(toHighlight);

  const needsAttention = catSummary
    .filter((c) => c.pct_met_sla < 95)
    .sort((a, b) => a.pct_met_sla - b.pct_met_sla || b.total - a.total)
    .slice(0, 3)
    .map(toHighlight);

  const atRisk = catSummary
    .filter((c) => c.pct_met_sla >= 95 && c.pct_met_sla < 99)
    .sort((a, b) => b.total - a.total);

  const met99Total = catSummary.filter((c) => c.pct_met_sla >= 99).length;

  const paragraphs: ArticlePart[][] = [];

  paragraphs.push([{
    kind: 'text',
    text: 'The citywide compliance number covers seventeen categories: sanitation, sidewalks, snow, transit, traffic safety, and more. The chart shows whether each met its promised deadline, with markers sized to request volume. Where failures cluster, residents feel it most.',
  }]);

  if (doingWell.length > 0) {
    paragraphs.push([{
      kind: 'text',
      text: buildDoingWellParagraph(doingWell, met99Total),
    }]);
  }

  if (needsAttention.length > 0) {
    const lead = needsAttention[0];
    let text = `The stress points are elsewhere. ${formatCategoryClause(lead)} falls well below the 95% floor. ${lead.why.charAt(0).toUpperCase()}${lead.why.slice(1)}`;
    if (needsAttention.length > 1) {
      const rest = needsAttention.slice(1);
      text += ` ${joinClauses(rest)} ${rest.length === 1 ? 'shows' : 'show'} the same strain at lower volume.`;
    }
    paragraphs.push([{ kind: 'text', text }]);
  } else if (atRisk.length > 0) {
    const atRiskHighlights = atRisk.map(toHighlight);
    paragraphs.push([{
      kind: 'text',
      text: `No category falls below 95%, but ${joinClauses(atRiskHighlights)} ${atRisk.length === 1 ? 'sits' : 'sit'} in the at-risk band. A seasonal spike could push ${atRisk.length === 1 ? 'it' : 'them'} over.`,
    }]);
  }

  if (wardEquity) {
    paragraphs.push([{
      kind: 'text',
      text: `Resolution rates range from ${wardEquity.minPct}% in ${wardEquity.minWard} to ${wardEquity.maxPct}% in ${wardEquity.maxWard}, a ${wardEquity.spread}-point spread. A citywide average masks that gap: a category can look healthy while specific wards wait far longer for the same fixes.`,
    }]);
  }

  paragraphs.push([
    { kind: 'text', text: 'The ' },
    { kind: 'link', text: 'Performance tab', tab: 'sla' },
    { kind: 'text', text: ' breaks each category into service types and pairs resolution time with compliance. ' },
    { kind: 'text', text: 'The ' },
    { kind: 'link', text: 'Explore tab', tab: 'explorer' },
    { kind: 'text', text: ' adds geography and timing: ward-level resolution, ticket age, and weekly filing rhythms.' },
  ]);

  const dek = buildCategoryDek(catSummary);

  return {
    headline: 'Where DC keeps its promises and where it doesn\u2019t',
    dek,
    paragraphs,
    figureCaption: 'Share of requests meeting the promised deadline by category, last 12 months. Bar color reflects the 99% and 95% targets.',
  };
}

const PERCEPTIBILITY_DOING_WELL_COUNT = 2;
const PERCEPTIBILITY_URBANIST_COUNT = 3;

/** Categories for the perceptibility essay chart: strong performers plus lagging resident-facing priorities. */
export function selectPerceptibilityChartCategories(
  catSummary: ReturnType<typeof slaCategorySummary>,
): string[] {
  const doingWell = catSummary
    .filter((c) => c.pct_met_sla >= 99)
    .sort((a, b) => b.total - a.total)
    .slice(0, PERCEPTIBILITY_DOING_WELL_COUNT)
    .map((c) => c.category);

  const selected = new Set(doingWell);
  const residentSet = new Set<string>(PERCEPTIBILITY_RESIDENT_CATEGORIES);

  const strugglingResident = catSummary
    .filter((c) => residentSet.has(c.category) && !selected.has(c.category))
    .sort((a, b) => {
      const tier = (pct: number) => (pct < 95 ? 0 : pct < 99 ? 1 : 2);
      const tierDiff = tier(a.pct_met_sla) - tier(b.pct_met_sla);
      if (tierDiff !== 0) return tierDiff;
      if (a.pct_met_sla !== b.pct_met_sla) return a.pct_met_sla - b.pct_met_sla;
      return b.total - a.total;
    })
    .slice(0, PERCEPTIBILITY_URBANIST_COUNT)
    .map((c) => c.category);

  return [...doingWell, ...strugglingResident];
}

/** Keeps monthly SLA rows in the order returned by selectPerceptibilityChartCategories. */
export function orderCategoryMonthlySla(
  rows: CategoryMonthlySla[],
  categoryOrder: string[],
): CategoryMonthlySla[] {
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  return categoryOrder
    .map((category) => byCategory.get(category))
    .filter((row): row is CategoryMonthlySla => row !== undefined);
}
