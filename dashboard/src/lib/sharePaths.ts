import { EstimateResult } from './estimateData';

export type SharePathId =
  | 'ward_gap'
  | 'promise_broken'
  | 'generous_deadline'
  | 'long_wait'
  | 'quick_fix'
  | 'wide_range'
  | 'reliable'
  | 'delays_common'
  | 'perceptibly_slow'
  | 'typical';

export type SharePathTone = 'success' | 'warning' | 'danger' | 'neutral';

export type PromiseBrokenTier = 'severe' | 'moderate';

export type SharePathLayout = 'comparison' | 'compliance' | 'range';

export const SHARE_PATH_THRESHOLDS = {
  /** Ward median must exceed citywide by this factor to select ward_gap. */
  wardDivergenceRatio: 1.5,
  /** Minimum day gap so small medians don't trigger ward_gap. */
  wardAbsDiffDays: 3,
  promiseBrokenBelow: 80,
  reliableAt: 99,
  barelyAcceptableAt: 95,
  softWarningAt: 80,
  longWaitDays: 30,
  generousDeadlineMinSlaDays: 60,
  wideRangeIqrMin: 14,
  wideRangeSpreadRatio: 2,
  promiseBrokenSevereBelow: 50,
} as const;

export interface SharePathContext {
  serviceType: string;
  ward: string | null;
  estimate: EstimateResult;
  citywideEstimate: EstimateResult | null;
}

export interface SharePathSelection {
  id: SharePathId;
  layout: SharePathLayout;
  tone: SharePathTone;
  promiseTier?: PromiseBrokenTier;
  wardMedian?: number;
  citywideMedian?: number;
}

export interface SentenceLeadParts {
  beforeType: string;
  serviceType: string;
  afterType: string;
}

export interface SharePathContent {
  id: SharePathId;
  layout: SharePathLayout;
  tone: SharePathTone;
  sentenceLead: string;
  sentenceLeadParts: SentenceLeadParts;
  heroPrimary: string;
  supportLine: string;
  heroColor: string;
  ogTitle: string;
  ogDescription: string;
  shareLine: string;
}

export const SHARE_SERVICE_TYPE_MAX_LENGTH = 38;

/** Shortens long service names at a word boundary for OG card copy. */
export function truncateServiceType(name: string, maxLen = SHARE_SERVICE_TYPE_MAX_LENGTH): string {
  if (name.length <= maxLen) return name;
  const truncated = name.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.5) {
    return `${truncated.slice(0, lastSpace)}\u2026`;
  }
  return `${truncated.slice(0, maxLen - 1)}\u2026`;
}

export interface ContextLeadOptions {
  predicate: string;
  wardInLead?: boolean;
}

export function buildContextLead(
  serviceType: string,
  ward: string | null,
  options: ContextLeadOptions,
): SentenceLeadParts {
  const wardPhrase = options.wardInLead && ward ? `in ${ward} ` : '';
  return {
    beforeType: '',
    serviceType: truncateServiceType(serviceType),
    afterType: `${wardPhrase}${options.predicate}`.trim(),
  };
}

function formatSentenceLead(parts: SentenceLeadParts): string {
  const lead = `${parts.beforeType}${parts.serviceType}`.trim();
  return parts.afterType ? `${lead} ${parts.afterType}`.trim() : lead;
}

function formatPunchUpperBound(estimate: EstimateResult): string {
  if (estimate.p75 < 1) return '< 1 day';
  const upper = Math.round(estimate.p75);
  if (upper <= 1) return 'Up to 1 day';
  return `Up to ${upper} days`;
}

function formatHeadlinePunch(punch: string): string {
  return punch.endsWith('.') ? punch : `${punch}.`;
}

function formatShareLine(lead: string, punch: string, proof: string): string {
  const headline = formatHeadlinePunch(punch);
  const head = lead ? `${lead} ${headline}` : headline;
  return `${head} ${proof}`;
}

function withLeadParts(
  parts: SentenceLeadParts,
  content: Omit<SharePathContent, 'sentenceLead' | 'sentenceLeadParts'>,
): SharePathContent {
  return {
    ...content,
    sentenceLead: formatSentenceLead(parts),
    sentenceLeadParts: parts,
    heroPrimary: formatHeadlinePunch(content.heroPrimary),
  };
}

const HERO_COLORS: Record<SharePathTone, string> = {
  success: '#4ade80',
  warning: '#f59e0b',
  danger: '#e63946',
  neutral: '#ffffff',
};

export function isSlowerWardGap(
  wardMedian: number,
  citywideMedian: number,
): boolean {
  if (citywideMedian <= 0 || wardMedian <= 0) return false;
  const absDiff = Math.abs(wardMedian - citywideMedian);
  return (
    wardMedian >= citywideMedian * SHARE_PATH_THRESHOLDS.wardDivergenceRatio
    && absDiff >= SHARE_PATH_THRESHOLDS.wardAbsDiffDays
  );
}

function isPromiseBroken(estimate: EstimateResult): boolean {
  return estimate.sla_days > 0
    && estimate.pct_met_sla < SHARE_PATH_THRESHOLDS.promiseBrokenBelow;
}

function isLongWait(estimate: EstimateResult): boolean {
  return estimate.p50 >= SHARE_PATH_THRESHOLDS.longWaitDays;
}

export function isGenerousDeadline(estimate: EstimateResult): boolean {
  return estimate.sla_days >= SHARE_PATH_THRESHOLDS.generousDeadlineMinSlaDays;
}

function isQuickFix(estimate: EstimateResult): boolean {
  return estimate.p50 < 1;
}

function isWideRange(estimate: EstimateResult): boolean {
  const iqr = estimate.p75 - estimate.p25;
  if (iqr < SHARE_PATH_THRESHOLDS.wideRangeIqrMin) return false;
  return iqr / Math.max(estimate.p50, 1) >= SHARE_PATH_THRESHOLDS.wideRangeSpreadRatio;
}

function isReliable(estimate: EstimateResult): boolean {
  return estimate.sla_days > 0
    && estimate.pct_met_sla >= SHARE_PATH_THRESHOLDS.reliableAt;
}

function isDelaysCommon(estimate: EstimateResult): boolean {
  return estimate.sla_days > 0
    && estimate.pct_met_sla >= SHARE_PATH_THRESHOLDS.barelyAcceptableAt
    && estimate.pct_met_sla < SHARE_PATH_THRESHOLDS.reliableAt;
}

function isPerceptiblySlow(estimate: EstimateResult): boolean {
  return estimate.sla_days > 0
    && estimate.pct_met_sla >= SHARE_PATH_THRESHOLDS.softWarningAt
    && estimate.pct_met_sla < SHARE_PATH_THRESHOLDS.barelyAcceptableAt;
}

function promiseTier(pctMetSla: number): PromiseBrokenTier {
  return pctMetSla < SHARE_PATH_THRESHOLDS.promiseBrokenSevereBelow ? 'severe' : 'moderate';
}

export function selectSharePath(context: SharePathContext): SharePathSelection {
  const { estimate, citywideEstimate, ward } = context;
  const citywide = citywideEstimate ?? estimate;

  if (ward && citywideEstimate && isSlowerWardGap(estimate.p50, citywide.p50)) {
    return {
      id: 'ward_gap',
      layout: 'comparison',
      tone: 'warning',
      wardMedian: estimate.p50,
      citywideMedian: citywide.p50,
    };
  }

  if (isPromiseBroken(estimate)) {
    return {
      id: 'promise_broken',
      layout: 'compliance',
      tone: 'danger',
      promiseTier: promiseTier(estimate.pct_met_sla),
    };
  }

  if (isGenerousDeadline(estimate)) {
    return {
      id: 'generous_deadline',
      layout: isLongWait(estimate) ? 'range' : 'compliance',
      tone: 'warning',
    };
  }

  if (isLongWait(estimate)) {
    return { id: 'long_wait', layout: 'range', tone: 'warning' };
  }

  if (isQuickFix(estimate)) {
    return { id: 'quick_fix', layout: 'range', tone: 'success' };
  }

  if (isReliable(estimate)) {
    return { id: 'reliable', layout: 'compliance', tone: 'success' };
  }

  if (isDelaysCommon(estimate)) {
    return { id: 'delays_common', layout: 'compliance', tone: 'warning' };
  }

  if (isPerceptiblySlow(estimate)) {
    return { id: 'perceptibly_slow', layout: 'compliance', tone: 'warning' };
  }

  if (isWideRange(estimate)) {
    return { id: 'wide_range', layout: 'range', tone: 'warning' };
  }

  return { id: 'typical', layout: 'range', tone: 'neutral' };
}

function formatRange(estimate: EstimateResult): string {
  if (estimate.p25 < 1 && estimate.p75 < 1) return '< 1 day';
  const p25 = Math.round(estimate.p25);
  const p75 = Math.round(estimate.p75);
  if (p25 === p75) return p25 === 0 ? 'Same day' : `${p25} days`;
  return `${p25}\u2013${p75} days`;
}

function formatGenerousDeadlinePhrase(slaDays: number): string {
  if (slaDays >= 365) {
    const years = Math.round(slaDays / 365);
    return years <= 1 ? 'over a year' : `over ${years} years`;
  }
  return `${slaDays} days`;
}

/** Fast typical wait + padded SLA: punch states compliance; support calls out the bar. */
function formatGenerousDeadlineFastSupport(
  slaRate: number,
  deadlinePhrase: string,
): string {
  if (slaRate >= SHARE_PATH_THRESHOLDS.barelyAcceptableAt) {
    return `The deadline is ${deadlinePhrase}.`;
  }
  return `The city gave itself ${deadlinePhrase}.`;
}

/** Dry ward-vs-citywide kicker; punch already states the ward wait. */
function formatCitywideQuip(citywideMedian: number): string {
  const cm = Math.round(citywideMedian);
  return cm === 1 ? 'Citywide? 1 day.' : `Citywide? ${cm} days.`;
}

/** Soft kicker for 95–98% compliance; punch already states the hit rate. */
function formatDelaysCommonQuip(): string {
  return 'Perceptibly close \u2014 not quite perfect.';
}

/** Disappointed kicker for sub-95% compliance; punch states the hit rate. */
function formatPerceptiblySlowSupport(slaRate: number, slaDays: number): string {
  const deadlineLabel = slaDays === 1 ? '1-day' : `${slaDays}-day`;
  if (slaRate >= 90) {
    const missRate = 100 - slaRate;
    return `Usually fine on a ${deadlineLabel} deadline \u2014 until you are in the ${missRate}%.`;
  }
  if (slaRate >= 85) {
    return 'Sounds okay, but why set a deadline if you are not going to meet it?';
  }
  return 'That\u2019s not good enough.';
}

export function formatWardGapHero(wardMedian: number, citywideMedian: number): string {
  const wm = Math.round(wardMedian);
  const cm = Math.round(citywideMedian);
  const ratio = cm > 0 ? wm / cm : 1;
  const extraDays = wm - cm;
  if (ratio >= 2) return `${Math.round(ratio)}\u00D7 longer`;
  if (extraDays === 1) return '1 day longer';
  return `${extraDays} days longer`;
}

function buildWardGapCopy(
  ward: string,
  serviceType: string,
  wardMedian: number,
  citywideMedian: number,
): Pick<SharePathContent, 'sentenceLead' | 'sentenceLeadParts' | 'heroPrimary' | 'supportLine' | 'ogDescription' | 'shareLine'> {
  const wm = Math.round(wardMedian);
  const sentenceLeadParts = buildContextLead(serviceType, ward, {
    predicate: 'take',
    wardInLead: true,
  });
  sentenceLeadParts.afterType = `requests ${sentenceLeadParts.afterType}`;
  const sentenceLead = formatSentenceLead(sentenceLeadParts);
  const punch = wm === 1 ? '1 day' : `${wm} days`;
  const supportLine = formatCitywideQuip(citywideMedian);
  const shareLine = formatShareLine(sentenceLead, punch, supportLine);
  return {
    sentenceLead,
    sentenceLeadParts,
    heroPrimary: formatHeadlinePunch(punch),
    supportLine,
    ogDescription: shareLine,
    shareLine,
  };
}

export function buildSharePathContent(
  selection: SharePathSelection,
  context: SharePathContext,
): SharePathContent {
  const { serviceType, ward, estimate, citywideEstimate } = context;
  const slaRate = Math.round(estimate.pct_met_sla);
  const range = formatRange(estimate);
  const ogTitle = `${serviceType} \u2014 How long does DC take?`;

  switch (selection.id) {
    case 'ward_gap': {
      const wm = selection.wardMedian ?? estimate.p50;
      const cm = selection.citywideMedian ?? citywideEstimate?.p50 ?? estimate.p50;
      const copy = buildWardGapCopy(ward!, serviceType, wm, cm);
      return {
        id: 'ward_gap',
        layout: 'comparison',
        tone: 'warning',
        sentenceLead: copy.sentenceLead,
        sentenceLeadParts: copy.sentenceLeadParts,
        heroPrimary: copy.heroPrimary,
        supportLine: copy.supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: copy.ogDescription,
        shareLine: copy.shareLine,
      };
    }
    case 'promise_broken': {
      const tier = selection.promiseTier ?? promiseTier(estimate.pct_met_sla);
      const parts = buildContextLead(serviceType, ward, { predicate: 'requests met the deadline' });
      const lead = formatSentenceLead(parts);
      const heroPrimary = `${slaRate}% of the time`;
      const supportLine = tier === 'severe'
        ? `The city promised ${estimate.sla_days} days.`
        : `The city gave itself ${estimate.sla_days} days.`;
      const shareLine = formatShareLine(lead, heroPrimary, supportLine);
      return withLeadParts(parts, {
        id: 'promise_broken',
        layout: 'compliance',
        tone: 'danger',
        heroPrimary,
        supportLine,
        heroColor: HERO_COLORS.danger,
        ogTitle,
        ogDescription: shareLine,
        shareLine,
      });
    }
    case 'generous_deadline': {
      const deadlinePhrase = formatGenerousDeadlinePhrase(estimate.sla_days);
      if (isLongWait(estimate)) {
        const parts = buildContextLead(serviceType, ward, { predicate: 'usually takes' });
        const lead = formatSentenceLead(parts);
        const supportLine = `Easy to hit ${slaRate}% of your deadlines if you give yourself ${deadlinePhrase}.`;
        const shareLine = formatShareLine(lead, range, supportLine);
        return withLeadParts(parts, {
          id: 'generous_deadline',
          layout: 'range',
          tone: 'warning',
          heroPrimary: range,
          supportLine,
          heroColor: HERO_COLORS.warning,
          ogTitle,
          ogDescription: shareLine,
          shareLine,
        });
      }
      const parts = buildContextLead(serviceType, ward, { predicate: 'requests met the deadline' });
      const lead = formatSentenceLead(parts);
      const heroPrimary = `${slaRate}% of the time`;
      const supportLine = formatGenerousDeadlineFastSupport(slaRate, deadlinePhrase);
      const shareLine = formatShareLine(lead, heroPrimary, supportLine);
      return withLeadParts(parts, {
        id: 'generous_deadline',
        layout: 'compliance',
        tone: 'warning',
        heroPrimary,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: shareLine,
        shareLine,
      });
    }
    case 'long_wait': {
      const parts = buildContextLead(serviceType, ward, { predicate: 'usually takes' });
      const lead = formatSentenceLead(parts);
      const heroPrimary = formatPunchUpperBound(estimate);
      const supportLine = estimate.sla_days > 0
        ? `The city says ${estimate.sla_days} days. You\u2019ll wait longer.`
        : `Based on ${estimate.n.toLocaleString()} resolved requests.`;
      const shareLine = formatShareLine(lead, heroPrimary, supportLine);
      return withLeadParts(parts, {
        id: 'long_wait',
        layout: 'range',
        tone: 'warning',
        heroPrimary,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: shareLine,
        shareLine,
      });
    }
    case 'quick_fix': {
      const parts = buildContextLead(serviceType, ward, { predicate: 'usually takes' });
      const lead = formatSentenceLead(parts);
      const supportLine = 'Rare speed for DC 311.';
      const shareLine = formatShareLine(lead, range, supportLine);
      return withLeadParts(parts, {
        id: 'quick_fix',
        layout: 'range',
        tone: 'success',
        heroPrimary: range,
        supportLine,
        heroColor: HERO_COLORS.success,
        ogTitle,
        ogDescription: shareLine,
        shareLine,
      });
    }
    case 'wide_range': {
      const parts = buildContextLead(serviceType, ward, { predicate: 'can take' });
      const lead = formatSentenceLead(parts);
      const supportLine = 'Outcomes vary wildly \u2014 they keep you on your toes.';
      const shareLine = formatShareLine(lead, range, supportLine);
      return withLeadParts(parts, {
        id: 'wide_range',
        layout: 'range',
        tone: 'warning',
        heroPrimary: range,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: shareLine,
        shareLine,
      });
    }
    case 'reliable': {
      const parts = buildContextLead(serviceType, ward, { predicate: 'requests met the deadline' });
      const lead = formatSentenceLead(parts);
      const heroPrimary = `${slaRate}% of the time`;
      const supportLine = `${estimate.sla_days}-day window \u2014 rare for DC 311.`;
      const shareLine = formatShareLine(lead, heroPrimary, supportLine);
      return withLeadParts(parts, {
        id: 'reliable',
        layout: 'compliance',
        tone: 'success',
        heroPrimary,
        supportLine,
        heroColor: HERO_COLORS.success,
        ogTitle,
        ogDescription: shareLine,
        shareLine,
      });
    }
    case 'delays_common': {
      const parts = buildContextLead(serviceType, ward, { predicate: 'requests met the deadline' });
      const lead = formatSentenceLead(parts);
      const heroPrimary = `${slaRate}% of the time`;
      const supportLine = formatDelaysCommonQuip();
      const shareLine = formatShareLine(lead, heroPrimary, supportLine);
      return withLeadParts(parts, {
        id: 'delays_common',
        layout: 'compliance',
        tone: 'warning',
        heroPrimary,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: shareLine,
        shareLine,
      });
    }
    case 'perceptibly_slow': {
      const parts = buildContextLead(serviceType, ward, { predicate: 'requests met the deadline' });
      const lead = formatSentenceLead(parts);
      const heroPrimary = `${slaRate}% of the time`;
      const supportLine = formatPerceptiblySlowSupport(slaRate, estimate.sla_days);
      const shareLine = formatShareLine(lead, heroPrimary, supportLine);
      return withLeadParts(parts, {
        id: 'perceptibly_slow',
        layout: 'compliance',
        tone: 'warning',
        heroPrimary,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: shareLine,
        shareLine,
      });
    }
    default: {
      const parts = buildContextLead(serviceType, ward, { predicate: 'usually takes' });
      const lead = formatSentenceLead(parts);
      const supportLine = estimate.sla_days > 0
        ? 'Par for the course at DC 311.'
        : `Based on ${estimate.n.toLocaleString()} resolved requests.`;
      const shareLine = formatShareLine(lead, range, supportLine);
      return withLeadParts(parts, {
        id: 'typical',
        layout: 'range',
        tone: 'neutral',
        heroPrimary: range,
        supportLine,
        heroColor: HERO_COLORS.neutral,
        ogTitle,
        ogDescription: shareLine,
        shareLine,
      });
    }
  }
}

export function resolveSharePath(context: SharePathContext): SharePathContent {
  const selection = selectSharePath(context);
  return buildSharePathContent(selection, context);
}

export interface SharePathDistribution {
  counts: Record<SharePathId, number>;
  total: number;
}

export function checkSharePathDistribution(
  counts: Record<SharePathId, number>,
): SharePathDistribution & { violations: string[] } {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const maxPct = total > 0 ? Math.max(...Object.values(counts)) / total : 0;
  const typicalPct = total > 0 ? (counts.typical ?? 0) / total : 0;
  const violations: string[] = [];

  if (maxPct > 0.3) {
    violations.push(
      `Share path distribution: largest bucket is ${(maxPct * 100).toFixed(1)}% (target ≤30%)`,
    );
  }
  if (typicalPct > 0.05) {
    violations.push(
      `Share path distribution: typical is ${(typicalPct * 100).toFixed(1)}% (target ≤5%)`,
    );
  }

  return { counts, total, violations };
}

export type SharePunchKind = 'compliance' | 'wait' | 'ward_wait';

export type ShareSupportTopic = 'compliance' | 'wait' | 'deadline' | 'ward' | 'meta';

const COMPLIANCE_PUNCH = /^\d+% of the time\.?$/;
const WAIT_PUNCH = /^(?:\d+–\d+ days|< 1 day|Same day|Up to \d+ days|\d+ days|1 day)\.?$/;
const WARD_WAIT_PUNCH = /^(?:\d+ days|1 day)\.?$/;

const COMPLIANCE_SUPPORT = /Usually fine|Perceptibly close|Sounds okay|That.s not good enough|Not for everyone|Quick for most|Easy to hit \d+%/;
const WAIT_SUPPORT = /Rare speed|wait longer|Par for the course|worst case/;
const DEADLINE_SUPPORT = /deadline|promised|gave itself|city says \d+ days|-day window/;
const WARD_SUPPORT = /Citywide\?/;
const META_SUPPORT = /wildly|on your toes|Based on \d+ resolved/;

/** Identifies what the hero stat is about so support can be checked against it. */
export function classifySharePunch(
  content: Pick<SharePathContent, 'heroPrimary' | 'layout'>,
): SharePunchKind | 'unknown' {
  const hero = content.heroPrimary.replace(/\.$/, '');
  if (COMPLIANCE_PUNCH.test(content.heroPrimary)) return 'compliance';
  if (content.layout === 'comparison' && WARD_WAIT_PUNCH.test(hero)) return 'ward_wait';
  if (WAIT_PUNCH.test(hero)) return 'wait';
  return 'unknown';
}

/** Tags support-line topics; deadline can bridge wait punches to compliance kickers. */
export function classifyShareSupportTopics(supportLine: string): ShareSupportTopic[] {
  const topics: ShareSupportTopic[] = [];
  if (COMPLIANCE_SUPPORT.test(supportLine)) topics.push('compliance');
  if (WAIT_SUPPORT.test(supportLine)) topics.push('wait');
  if (DEADLINE_SUPPORT.test(supportLine)) topics.push('deadline');
  if (WARD_SUPPORT.test(supportLine)) topics.push('ward');
  if (META_SUPPORT.test(supportLine)) topics.push('meta');
  return topics;
}

/** Flags punch/support frames that talk past each other (e.g. wait range + "usually fine"). */
export function validateSharePathCoherence(content: SharePathContent): string[] {
  const violations: string[] = [];
  const punch = classifySharePunch(content);
  const topics = classifyShareSupportTopics(content.supportLine);
  const topicSet = new Set(topics);
  const lead = content.sentenceLead;

  if (content.layout === 'compliance' && punch !== 'compliance') {
    violations.push('compliance layout requires a hit-rate punch');
  }
  if (content.layout === 'range' && punch === 'compliance') {
    violations.push('range layout cannot use a hit-rate punch');
  }
  if (content.layout === 'comparison' && punch !== 'ward_wait') {
    violations.push('comparison layout requires a ward wait punch');
  }

  if (lead.includes('met the deadline') && punch !== 'compliance') {
    violations.push('lead promises deadline compliance but punch is not a hit rate');
  }
  if ((lead.includes('usually takes') || lead.includes('can take')) && punch === 'compliance') {
    violations.push('lead promises wait time but punch is a hit rate');
  }
  if (lead.includes(' takes') && content.layout === 'comparison' && punch !== 'ward_wait') {
    violations.push('ward comparison lead requires a ward wait punch');
  }

  const hasComplianceSupport = topicSet.has('compliance');
  const hasWaitSupport = topicSet.has('wait');
  const hasDeadlineBridge = topicSet.has('deadline');

  if (punch === 'wait' && hasComplianceSupport && !hasDeadlineBridge) {
    violations.push('wait punch paired with compliance kicker and no deadline bridge');
  }
  if (punch === 'compliance' && hasWaitSupport && !hasDeadlineBridge) {
    violations.push('hit-rate punch paired with wait kicker and no deadline bridge');
  }
  if (punch === 'ward_wait' && !topicSet.has('ward')) {
    violations.push('ward wait punch missing citywide comparison kicker');
  }
  if (punch === 'unknown') {
    violations.push(`unrecognized punch: ${content.heroPrimary}`);
  }

  return violations;
}
