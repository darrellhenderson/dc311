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
  generousDeadlineMinPct: 95,
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

export interface SharePathContent {
  id: SharePathId;
  layout: SharePathLayout;
  tone: SharePathTone;
  heroPrimary: string;
  heroLabel?: string;
  supportLine: string;
  heroColor: string;
  ogTitle: string;
  ogDescription: string;
  shareLine: string;
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
  return isLongWait(estimate)
    && estimate.sla_days >= SHARE_PATH_THRESHOLDS.generousDeadlineMinSlaDays
    && estimate.pct_met_sla >= SHARE_PATH_THRESHOLDS.generousDeadlineMinPct;
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
    return { id: 'generous_deadline', layout: 'range', tone: 'warning' };
  }

  if (isLongWait(estimate)) {
    return { id: 'long_wait', layout: 'range', tone: 'warning' };
  }

  if (isQuickFix(estimate)) {
    return { id: 'quick_fix', layout: 'range', tone: 'success' };
  }

  if (isWideRange(estimate)) {
    return { id: 'wide_range', layout: 'range', tone: 'warning' };
  }

  if (isReliable(estimate)) {
    return { id: 'reliable', layout: 'compliance', tone: 'success' };
  }

  if (isDelaysCommon(estimate)) {
    return { id: 'delays_common', layout: 'compliance', tone: 'warning' };
  }

  if (isPerceptiblySlow(estimate)) {
    return { id: 'perceptibly_slow', layout: 'range', tone: 'warning' };
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

function wardSuffix(ward: string | null): string {
  return ward ? ` in ${ward}` : '';
}

function serviceLabel(serviceType: string): string {
  return serviceType.toLowerCase();
}

function formatGenerousDeadlinePhrase(slaDays: number): string {
  if (slaDays >= 365) {
    const years = Math.round(slaDays / 365);
    return years <= 1 ? 'over a year' : `over ${years} years`;
  }
  return `${slaDays} days`;
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
): Pick<SharePathContent, 'heroLabel' | 'heroPrimary' | 'supportLine' | 'ogDescription' | 'shareLine'> {
  const wm = Math.round(wardMedian);
  const cm = Math.round(citywideMedian);
  const gapHeadline = formatWardGapHero(wardMedian, citywideMedian);
  const supportLine = `${wm} days in ${ward}. Citywide? ${cm}.`;
  const shareLine = `In ${ward}, ${serviceLabel(serviceType)} takes ${gapHeadline} — ${wm} days here, ${cm} citywide.`;
  return {
    heroLabel: `In ${ward}`,
    heroPrimary: gapHeadline,
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
        heroLabel: copy.heroLabel,
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
      const supportLine = tier === 'severe'
        ? `The city promised ${estimate.sla_days} days but only delivers ${slaRate}% of the time.`
        : `The city gave itself ${estimate.sla_days} days and misses that ${100 - slaRate}% of the time.`;
      return {
        id: 'promise_broken',
        layout: 'compliance',
        tone: 'danger',
        heroPrimary: `Only ${slaRate}% on time`,
        supportLine,
        heroColor: HERO_COLORS.danger,
        ogTitle,
        ogDescription: `Only ${slaRate}% meet the city's deadline for ${serviceLabel(serviceType)}.`,
        shareLine: `Only ${slaRate}% meet the city's deadline for ${serviceLabel(serviceType)}.`,
      };
    }
    case 'generous_deadline': {
      const deadlinePhrase = formatGenerousDeadlinePhrase(estimate.sla_days);
      const supportLine = `Easy to hit ${slaRate}% when the deadline is ${deadlinePhrase}.`;
      const shareLine = `${serviceType}${wardSuffix(ward)}: plan for ${range}. City gave itself ${deadlinePhrase} and meets it ${slaRate}% of the time.`;
      return {
        id: 'generous_deadline',
        layout: 'range',
        tone: 'warning',
        heroLabel: 'Plan for',
        heroPrimary: range,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: shareLine,
        shareLine: shareLine,
      };
    }
    case 'long_wait': {
      const supportLine = estimate.sla_days > 0
        ? `City deadline is ${estimate.sla_days} days. ${slaRate}% on time.`
        : `Based on ${estimate.n.toLocaleString()} resolved requests.`;
      return {
        id: 'long_wait',
        layout: 'range',
        tone: 'warning',
        heroLabel: 'Plan for',
        heroPrimary: range,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: `${serviceType}${wardSuffix(ward)}: plan for ${range}.`,
        shareLine: `${serviceType}${wardSuffix(ward)}: plan for ${range}.`,
      };
    }
    case 'quick_fix': {
      const supportLine = 'Usually handled within a day or two.';
      const shareLine = `${serviceType}${wardSuffix(ward)}: usually ${range}.`;
      return {
        id: 'quick_fix',
        layout: 'range',
        tone: 'success',
        heroLabel: 'Often',
        heroPrimary: range,
        supportLine,
        heroColor: HERO_COLORS.success,
        ogTitle,
        ogDescription: shareLine,
        shareLine: shareLine,
      };
    }
    case 'wide_range': {
      const supportLine = 'Outcomes vary wildly. They keep you on your toes.';
      const shareLine = `${serviceType}${wardSuffix(ward)}: ${range}. Outcomes vary wildly — they keep you on your toes.`;
      return {
        id: 'wide_range',
        layout: 'range',
        tone: 'warning',
        heroLabel: 'Can take',
        heroPrimary: range,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: shareLine,
        shareLine: shareLine,
      };
    }
    case 'reliable': {
      const supportLine = `One of the more dependable types — ${slaRate}% meet the ${estimate.sla_days}-day deadline.`;
      return {
        id: 'reliable',
        layout: 'compliance',
        tone: 'success',
        heroPrimary: `${slaRate}% on time`,
        supportLine,
        heroColor: HERO_COLORS.success,
        ogTitle,
        ogDescription: `${slaRate}% of ${serviceType} requests meet the city\u2019s ${estimate.sla_days}-day deadline.`,
        shareLine: `${slaRate}% of ${serviceType} requests meet the city\u2019s deadline.`,
      };
    }
    case 'delays_common': {
      const supportLine = 'Most requests are resolved on time, but delays are common.';
      const shareLine = `${serviceType}${wardSuffix(ward)}: ${slaRate}% on time — delays happen.`;
      return {
        id: 'delays_common',
        layout: 'compliance',
        tone: 'warning',
        heroPrimary: `${slaRate}% on time`,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: shareLine,
        shareLine: shareLine,
      };
    }
    case 'perceptibly_slow': {
      const supportLine = `Perceptibly slow — only ${slaRate}% meet the city\u2019s ${estimate.sla_days}-day deadline.`;
      const shareLine = `${serviceType}${wardSuffix(ward)}: typically ${range}. ${slaRate}% on time — perceptibly slow.`;
      return {
        id: 'perceptibly_slow',
        layout: 'range',
        tone: 'warning',
        heroLabel: 'Typically',
        heroPrimary: range,
        supportLine,
        heroColor: HERO_COLORS.warning,
        ogTitle,
        ogDescription: shareLine,
        shareLine: shareLine,
      };
    }
    default: {
      const supportLine = estimate.sla_days > 0
        ? `City\u2019s deadline is ${estimate.sla_days} days. ${slaRate}% on time.`
        : `Based on ${estimate.n.toLocaleString()} resolved requests.`;
      return {
        id: 'typical',
        layout: 'range',
        tone: 'neutral',
        heroLabel: 'Typically',
        heroPrimary: range,
        supportLine,
        heroColor: HERO_COLORS.neutral,
        ogTitle,
        ogDescription: `${serviceType}${wardSuffix(ward)}: typically ${range}.`,
        shareLine: `${serviceType}${wardSuffix(ward)}: typically ${range}.`,
      };
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
