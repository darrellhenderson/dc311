import { DataManifest, DateRangePreset, EstimateRow } from '../api/dataTypes';
import { ProcessedRequest } from './dataProcessing';
import { IN_APP_COMPLIANCE_THRESHOLDS } from './complianceThresholds';
import { resolveSharePath, isSlowerWardGap } from './sharePaths';
import { estimateShareSlug } from './shareSlug';

export { estimateShareSlug } from './shareSlug';
export {
  ESTIMATE_URL_KEYS,
  resolveTabFromSearchParams,
  stripEstimateSearchParams,
} from './estimateRouting';

/** Minimum closed requests to include a citywide estimate row. */
export const CITYWIDE_MIN_SAMPLE = 10;

/** Minimum closed requests to include a ward-specific estimate row. */
export const WARD_MIN_SAMPLE = 30;

export interface EstimateResult {
  n: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95?: number;
  sla_days: number;
  pct_met_sla: number;
}

/** Upper bound of the timeline bar — p95 when available, else p90. */
export function estimateBarEnd(estimate: EstimateResult): number {
  return estimate.p95 ?? estimate.p90;
}

export interface TicketInfo {
  id: string;
  serviceType: string;
  ward: string;
  filedDate: Date;
  isOpen: boolean;
  isClosed: boolean;
  markerDays: number;
}

export type EstimateLookup = Map<string, EstimateResult>;

function estimateKey(serviceType: string, ward: string | null): string {
  return ward ? `${serviceType}|${ward}` : serviceType;
}

function rowToResult(row: EstimateRow): EstimateResult {
  return {
    n: row.n,
    p25: row.p25,
    p50: row.p50,
    p75: row.p75,
    p90: row.p90,
    p95: row.p95,
    sla_days: row.sla_days,
    pct_met_sla: row.pct_met_sla,
  };
}

export function buildEstimateLookup(manifest: DataManifest): EstimateLookup {
  const lookup: EstimateLookup = new Map();
  const dicts = manifest.dictionaries;
  const rows = manifest.estimates ?? [];

  for (const row of rows) {
    const serviceType = dicts.serviceTypes[row.st];
    if (!serviceType) continue;
    const ward = row.w === null ? null : dicts.wards[row.w] ?? null;
    lookup.set(estimateKey(serviceType, ward), rowToResult(row));
  }

  return lookup;
}

export interface LookupEstimateResult {
  estimate: EstimateResult;
  citywideEstimate: EstimateResult;
  wardEstimate: EstimateResult | null;
  usedWardFallback: boolean;
}

/** Falls back to citywide when ward sample is below WARD_MIN_SAMPLE. */
export function lookupEstimate(
  lookup: EstimateLookup,
  serviceType: string,
  ward: string | null,
): LookupEstimateResult | null {
  const citywide = lookup.get(estimateKey(serviceType, null));
  if (!citywide) return null;

  if (!ward) {
    return { estimate: citywide, citywideEstimate: citywide, wardEstimate: null, usedWardFallback: false };
  }

  const wardSpecific = lookup.get(estimateKey(serviceType, ward));
  if (wardSpecific && wardSpecific.n >= WARD_MIN_SAMPLE) {
    return {
      estimate: wardSpecific,
      citywideEstimate: citywide,
      wardEstimate: wardSpecific,
      usedWardFallback: false,
    };
  }

  return {
    estimate: citywide,
    citywideEstimate: citywide,
    wardEstimate: wardSpecific ?? null,
    usedWardFallback: true,
  };
}

const TICKET_ID_RE = /^\d{2}-?\d{5,}$/;

export function looksLikeTicketId(input: string): boolean {
  const trimmed = input.trim();
  return TICKET_ID_RE.test(trimmed.replace(/\s/g, ''));
}

export function normalizeTicketId(input: string): string {
  const trimmed = input.trim().replace(/\s/g, '');
  if (trimmed.includes('-')) return trimmed;
  if (trimmed.length >= 7) {
    return `${trimmed.slice(0, 2)}-${trimmed.slice(2)}`;
  }
  return trimmed;
}

export function buildTicketIndex(rows: ProcessedRequest[]): Map<string, ProcessedRequest> {
  const index = new Map<string, ProcessedRequest>();
  for (const row of rows) {
    index.set(row.SERVICEREQUESTID, row);
    const normalized = normalizeTicketId(row.SERVICEREQUESTID);
    if (normalized !== row.SERVICEREQUESTID) {
      index.set(normalized, row);
    }
  }
  return index;
}

export function ticketFromRequest(row: ProcessedRequest): TicketInfo {
  const markerDays = row.is_closed && row.resolution_days !== null
    ? row.resolution_days
    : row.age_days;
  return {
    id: row.SERVICEREQUESTID,
    serviceType: row.SERVICECODEDESCRIPTION,
    ward: row.WARD,
    filedDate: row.date,
    isOpen: row.is_open,
    isClosed: row.is_closed,
    markerDays,
  };
}

export type ConfidenceTone = 'success' | 'warning' | 'danger';

export interface ConfidenceVerdict {
  label: string;
  tone: ConfidenceTone;
  message: string;
}

export function confidenceVerdict(pctMetSla: number): ConfidenceVerdict {
  if (pctMetSla >= IN_APP_COMPLIANCE_THRESHOLDS.usuallyMeetsAt) {
    return {
      label: 'Usually meets the city\'s deadline',
      tone: 'success',
      message: 'The city almost always resolves this type on time.',
    };
  }
  if (pctMetSla >= IN_APP_COMPLIANCE_THRESHOLDS.sometimesMissesAt) {
    return {
      label: 'Sometimes misses the deadline',
      tone: 'warning',
      message: 'Most requests are resolved on time, but delays are common.',
    };
  }
  return {
    label: 'Often misses the city\'s deadline',
    tone: 'danger',
    message: 'Be prepared to follow up if you file this type.',
  };
}

export function formatDays(days: number): string {
  return String(Math.round(days));
}

function percentileRank(days: number, estimate: EstimateResult): number {
  if (days <= estimate.p25) return 25;
  if (days <= estimate.p50) return 50;
  if (days <= estimate.p75) return 75;
  if (days <= estimate.p90) return 90;
  if (estimate.p95 != null && days <= estimate.p95) return 95;
  return 99;
}

export function generateWaitContext(
  days: number,
  estimate: EstimateResult,
  includeExternalLinks = true,
): string {
  const rank = percentileRank(days, estimate);
  const sla = estimate.sla_days > 0 ? estimate.sla_days : null;
  const daysToDeadline = sla !== null ? Math.max(0, Math.round(sla - days)) : null;

  if (days < estimate.p50) {
    return 'Your request is well within the typical range \u2014 no action needed.';
  }
  if (days < estimate.p75) {
    return 'Your request is taking longer than average. Most like this resolve soon.';
  }
  if (days < estimate.p90) {
    return includeExternalLinks
      ? 'Your request has taken longer than most. If no update, check status at 311.dc.gov.'
      : 'Your request has taken longer than most. If no update, check your request status.';
  }
  if (sla !== null && days < sla) {
    const deadlinePart = daysToDeadline !== null
      ? ` The city's deadline is in ${daysToDeadline} day${daysToDeadline === 1 ? '' : 's'}.`
      : '';
    return `Your request is past what's typical.${deadlinePart} Check your request status.`;
  }
  if (sla !== null && days >= sla) {
    return includeExternalLinks
      ? 'Your request is past the city\'s deadline. Follow up at 311.dc.gov or contact your council member.'
      : 'Your request is past the city\'s deadline. Consider following up or contacting your council member.';
  }
  return `Your request has been open ${formatDays(days)} days — longer than about ${rank}% of similar requests.`;
}

export interface PersonalVerdict {
  headline: string;
  detail: string;
  tone: ConfidenceTone;
}

/** Appends SLA deadline countdown when the request is still before the city deadline. */
function appendSlaDeadline(detail: string, days: number, slaDays: number): string {
  if (slaDays <= 0 || days >= slaDays) return detail;
  const daysToDeadline = Math.max(0, Math.round(slaDays - days));
  return `${detail} · deadline in ${daysToDeadline} day${daysToDeadline === 1 ? '' : 's'}`;
}

export function personalVerdict(
  estimate: EstimateResult,
  options: { ticket?: TicketInfo | null; waitDays?: number | null },
): PersonalVerdict | null {
  const { ticket, waitDays } = options;

  if (ticket?.isClosed) {
    const days = ticket.markerDays;
    const faster = days <= estimate.p50;
    const rank = percentileRank(days, estimate);
    if (faster) {
      return {
        headline: 'Resolved faster than most',
        detail: `Closed in ${formatDays(days)} days`,
        tone: 'success',
      };
    }
    if (days < estimate.p90) {
      return {
        headline: 'Resolved slower than average',
        detail: `Closed in ${formatDays(days)} days`,
        tone: 'warning',
      };
    }
    return {
      headline: 'Resolved slower than most',
      detail: `Closed in ${formatDays(days)} days — longer than about ${rank}% of similar requests`,
      tone: 'danger',
    };
  }

  const days = ticket?.isOpen ? ticket.markerDays : waitDays;
  if (days == null || days <= 0) return null;

  if (days < estimate.p50) {
    return {
      headline: 'Still on track',
      detail: appendSlaDeadline(
        `Open ${formatDays(days)} days — within the typical range`,
        days,
        estimate.sla_days,
      ),
      tone: 'success',
    };
  }
  if (days < estimate.p75) {
    return {
      headline: 'Taking longer than average',
      detail: appendSlaDeadline(`Most similar requests resolve soon (typical: ${formatDays(estimate.p25)}–${formatDays(estimate.p75)} days)`, days, estimate.sla_days),
      tone: 'warning',
    };
  }
  if (days < estimate.p90) {
    return {
      headline: 'Longer than most',
      detail: appendSlaDeadline('Consider checking your request status', days, estimate.sla_days),
      tone: 'warning',
    };
  }

  const sla = estimate.sla_days > 0 ? estimate.sla_days : null;
  if (sla !== null && days < sla) {
    const daysToDeadline = Math.max(0, Math.round(sla - days));
    return {
      headline: 'Past what\'s typical',
      detail: `City's deadline in ${daysToDeadline} day${daysToDeadline === 1 ? '' : 's'}`,
      tone: 'warning',
    };
  }
  if (sla !== null && days >= sla) {
    return {
      headline: 'Past the city\'s deadline',
      detail: 'Follow up at 311.dc.gov or contact your council member',
      tone: 'danger',
    };
  }

  const rank = percentileRank(days, estimate);
  return {
    headline: 'Longer than most similar requests',
    detail: `Open ${formatDays(days)} days — longer than about ${rank}%`,
    tone: 'danger',
  };
}

export function typeOnlySummary(estimate: EstimateResult): { message: string; tone: ConfidenceTone } {
  const v = confidenceVerdict(estimate.pct_met_sla);
  return { message: v.message, tone: v.tone };
}

export interface OutcomeSentenceOptions {
  estimate: EstimateResult;
  citywideEstimate?: EstimateResult;
  wardEstimate?: EstimateResult | null;
  ward?: string | null;
  usedWardFallback?: boolean;
  ticket?: TicketInfo | null;
  waitDays?: number | null;
}

export interface WardComparison {
  ward: string;
  wardRange: string;
  citywideRange: string;
  wardMedian: number;
  citywideMedian: number;
  direction: 'slower' | 'faster';
  /** Screen-reader text for the ward comparison callout. */
  sentence: string;
}


function wardComparisonSentence(
  ward: string,
  wardEstimate: EstimateResult,
  citywide: EstimateResult,
): string {
  return `In ${ward}, expect ${formatDays(wardEstimate.p25)}–${formatDays(wardEstimate.p75)} days (vs. ${formatDays(citywide.p25)}–${formatDays(citywide.p75)} citywide).`;
}

export function getWardComparison(options: OutcomeSentenceOptions): WardComparison | null {
  const { wardEstimate, ward, usedWardFallback } = options;
  const citywide = options.citywideEstimate ?? options.estimate;
  if (!ward || !wardEstimate || usedWardFallback) return null;

  const wardMedian = wardEstimate.p50;
  const citywideMedian = citywide.p50;
  if (wardMedian <= 0 || citywideMedian <= 0) return null;

  const direction = wardMedian > citywideMedian ? 'slower' : 'faster';

  return {
    ward,
    wardRange: `${formatDays(wardEstimate.p25)}–${formatDays(wardEstimate.p75)}`,
    citywideRange: `${formatDays(citywide.p25)}–${formatDays(citywide.p75)}`,
    wardMedian,
    citywideMedian,
    direction,
    sentence: wardComparisonSentence(ward, wardEstimate, citywide),
  };
}

export function generateOutcomeSentences(options: OutcomeSentenceOptions): string[] {
  if (getWardComparison(options)) return [];
  const { wardEstimate, ward, usedWardFallback } = options;
  if (!ward || !wardEstimate || usedWardFallback) return [];
  const citywide = options.citywideEstimate ?? options.estimate;
  if (wardEstimate.p50 <= 0 || citywide.p50 <= 0) return [];
  return [wardComparisonSentence(ward, wardEstimate, citywide)];
}

export function formatTicketContext(ticket: TicketInfo): string {
  const filed = ticket.filedDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (ticket.isOpen) {
    return `${ticket.serviceType} — ${ticket.ward} — Filed ${filed} — Open (${formatDays(ticket.markerDays)} days)`;
  }
  return `${ticket.serviceType} — ${ticket.ward} — Resolved in ${formatDays(ticket.markerDays)} days`;
}

export interface ServiceTypeStats {
  total: number;
  closed: number;
  open: number;
}

export function summarizeServiceTypeStats(
  rows: ProcessedRequest[],
  serviceType: string,
): ServiceTypeStats {
  let total = 0;
  let closed = 0;
  let open = 0;
  for (const r of rows) {
    if (r.SERVICECODEDESCRIPTION !== serviceType) continue;
    total++;
    if (r.is_closed) closed++;
    if (r.is_open) open++;
  }
  return { total, closed, open };
}

export function formatHeadlineRange(estimate: EstimateResult): string {
  const p25 = formatDays(estimate.p25);
  const p75 = formatDays(estimate.p75);
  if (p25 === p75) {
    return p25 === '0' ? 'Same day' : `${p25} days`;
  }
  return `${p25}–${p75} days`;
}

export function formatSampleSubline(
  estimate: EstimateResult,
  builtAt: string | null,
): string {
  let line = `Based on ${estimate.n.toLocaleString()} similar requests resolved`;
  if (builtAt) line += ` through ${builtAt}`;
  return line;
}

export function formatResolutionLine(stats: ServiceTypeStats | null, datePreset: DateRangePreset): string | null {
  if (!stats || stats.total === 0 || datePreset !== 'full') return null;
  const pct = Math.round((stats.closed / stats.total) * 100);
  return `${pct}% resolved · ${stats.open.toLocaleString()} still open out of ${stats.total.toLocaleString()} filed`;
}

export interface ShareTextOptions {
  serviceType: string;
  ward: string | null;
  lookup: LookupEstimateResult;
  ticket: TicketInfo | null;
  waitDays: number | null;
  personal?: PersonalVerdict | null;
}

export function buildShareText(options: ShareTextOptions): string {
  const { serviceType, ward, lookup, ticket, waitDays, personal } = options;
  const lines: string[] = [];

  if (personal && ticket?.isOpen) {
    lines.push(
      `${personal.headline} — my ${serviceType} request (#${ticket.id}) has been open ${formatDays(ticket.markerDays)} days.`,
    );
  } else if (personal && ticket?.isClosed) {
    lines.push(
      `${personal.headline} — my ${serviceType} request (#${ticket.id}) closed in ${formatDays(ticket.markerDays)} days.`,
    );
  } else if (personal && waitDays != null && waitDays > 0) {
    lines.push(
      `${personal.headline} — I've been waiting ${formatDays(waitDays)} days on a ${serviceType} request.`,
    );
  }

  if (!personal) {
    const shareEstimate = lookup.wardEstimate && !lookup.usedWardFallback
      ? lookup.wardEstimate
      : lookup.estimate;
    const { shareLine } = resolveSharePath({
      serviceType,
      ward,
      estimate: shareEstimate,
      citywideEstimate: lookup.citywideEstimate,
    });
    lines.push(shareLine);
  }

  return lines.join('\n\n');
}

const QUICK_PICK_PREFERRED = ['Bulk Collection', 'Parking Enforcement', 'Scheduled Yard Waste', 'Sidewalk Repair', 'Bicycle Services', 'Bus Stop Issues', 'Pothole', 'Illegal Dumping'];

export function getQuickPickServiceTypes(manifest: DataManifest, limit = 3): string[] {
  const dicts = manifest.dictionaries;
  const citywideRows = (manifest.estimates ?? []).filter((row) => row.w === null);
  const volumeByType = new Map<string, number>();

  for (const row of citywideRows) {
    const name = dicts.serviceTypes[row.st];
    if (name) volumeByType.set(name, row.n);
  }

  const picks: string[] = [];
  for (const name of QUICK_PICK_PREFERRED) {
    if (volumeByType.has(name) && !picks.includes(name)) {
      picks.push(name);
    }
  }

  const byVolume = [...volumeByType.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name);

  for (const name of byVolume) {
    if (picks.length >= limit) break;
    if (!picks.includes(name)) picks.push(name);
  }

  return picks.slice(0, limit);
}

export function getWardStandoutTypes(manifest: DataManifest, ward: string, limit = 3): string[] {
  const lookup = buildEstimateLookup(manifest);
  const ranked: { serviceType: string; ratio: number }[] = [];

  for (const serviceType of manifest.dictionaries.serviceTypes) {
    const result = lookupEstimate(lookup, serviceType, ward);
    if (!result || result.usedWardFallback || !result.wardEstimate) continue;

    const wardMedian = result.wardEstimate.p50;
    const citywideMedian = result.citywideEstimate.p50;
    if (!isSlowerWardGap(wardMedian, citywideMedian)) continue;

    ranked.push({ serviceType, ratio: wardMedian / citywideMedian });
  }

  ranked.sort((a, b) => b.ratio - a.ratio);
  return ranked.slice(0, limit).map((row) => row.serviceType);
}

export function getCitywideExploreTypes(
  manifest: DataManifest,
  excludeServiceType: string,
  limit = 2,
): string[] {
  const lookup = buildEstimateLookup(manifest);
  const ranked: { serviceType: string; median: number }[] = [];

  for (const serviceType of manifest.dictionaries.serviceTypes) {
    if (serviceType === excludeServiceType) continue;
    const row = lookup.get(estimateKey(serviceType, null));
    if (!row || row.n < WARD_MIN_SAMPLE || row.p50 < 1) continue;

    ranked.push({ serviceType, median: row.p50 });
  }

  ranked.sort((a, b) => b.median - a.median);
  return ranked.slice(0, limit).map((entry) => entry.serviceType);
}

export interface EstimateUrlState {
  ticket?: string | null;
  serviceType?: string | null;
  ward?: string | null;
  waitDays?: number | null;
}

/** Sentinel for ticket + citywide — distinct from omitting ward from the URL. */
export const CITYWIDE_WARD_VALUE = 'any';

export function encodeWardForUrl(ward: string | null | undefined, hasTicket: boolean): string | null {
  if (hasTicket) {
    return ward ? ward : CITYWIDE_WARD_VALUE;
  }
  return ward || null;
}

export function decodeWardFromUrl(ward: string | null, hasTicket: boolean): string {
  if (hasTicket && ward === CITYWIDE_WARD_VALUE) return '';
  return ward ?? '';
}

export function buildEstimateSearchParams(state: EstimateUrlState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('tab', 'estimate');

  if (state.ticket) {
    params.set('ticket', state.ticket);
    const encodedWard = encodeWardForUrl(state.ward, true);
    if (encodedWard) params.set('ward', encodedWard);
    return params;
  }

  if (state.serviceType) {
    params.set('type', state.serviceType);
    const encodedWard = encodeWardForUrl(state.ward, false);
    if (encodedWard) params.set('ward', encodedWard);
    if (state.waitDays != null && state.waitDays > 0) {
      params.set('wait', String(Math.round(state.waitDays)));
    }
  }

  return params;
}

export function parseEstimateSearchParams(params: URLSearchParams): EstimateUrlState {
  const ticket = params.get('ticket')?.trim() || null;
  const serviceType = params.get('type')?.trim() || null;
  const ward = params.get('ward')?.trim() || null;
  const waitRaw = params.get('wait');
  let waitDays: number | null = null;

  if (waitRaw != null && waitRaw !== '') {
    const days = Number(waitRaw);
    if (!Number.isNaN(days) && days >= 0 && days <= 999) {
      waitDays = Math.round(days);
    }
  }

  return { ticket, serviceType, ward, waitDays };
}

export function buildEstimateShareUrl(
  origin: string,
  pathname: string,
  state: EstimateUrlState,
): string {
  const url = new URL(pathname, origin);
  url.search = buildEstimateSearchParams(state).toString();
  return url.href;
}

export function buildShareClipboard(shareUrl: string, shareText: string): string {
  return shareText ? `${shareText}\n\n${shareUrl}` : shareUrl;
}

export function buildEstimateShareImagePath(
  basePath: string,
  serviceType: string,
  ward: string | null,
): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${base}share/og/${estimateShareSlug(serviceType, ward)}.png`;
}

export function buildEstimateStaticShareUrl(
  origin: string,
  basePath: string,
  serviceType: string,
  ward: string | null,
): string {
  const slug = estimateShareSlug(serviceType, ward);
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${origin}${base}share/${slug}.html`;
}

export interface ServiceTypeSearchGroup {
  category: string;
  types: string[];
}

function groupServiceTypesByCategory(
  types: string[],
  categoryMap: Record<string, string>,
): ServiceTypeSearchGroup[] {
  const byCategory = new Map<string, string[]>();

  for (const type of types) {
    const category = categoryMap[type] ?? 'Other';
    const list = byCategory.get(category) ?? [];
    list.push(type);
    byCategory.set(category, list);
  }

  return Array.from(byCategory.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, categoryTypes]) => ({
      category,
      types: categoryTypes.sort((a, b) => a.localeCompare(b)),
    }));
}

export function searchServiceTypes(
  query: string,
  serviceTypes: string[],
  categoryMap: Record<string, string>,
  limit = 20,
): ServiceTypeSearchGroup[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? serviceTypes.filter((t) => t.toLowerCase().includes(q)).slice(0, limit)
    : [...serviceTypes].sort((a, b) => a.localeCompare(b));

  if (matched.length === 0) return [];
  return groupServiceTypesByCategory(matched, categoryMap);
}
