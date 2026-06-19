/** GA4 measurement ID; override with VITE_GA_MEASUREMENT_ID. */
const GA_MEASUREMENT_ID =
  import.meta.env.VITE_GA_MEASUREMENT_ID ?? 'G-RRLLWC2EMT';

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

/** Installs gtag in production builds only. */
export function initAnalytics(): void {
  if (import.meta.env.DEV || !GA_MEASUREMENT_ID) {
    return;
  }

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js expects Arguments, not a spread array.
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

/** Sends a GA4 custom event in production; no-ops in dev or before init. */
export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>,
): void {
  if (import.meta.env.DEV || !GA_MEASUREMENT_ID || typeof window.gtag !== 'function') {
    return;
  }

  window.gtag('event', eventName, params);
}

export type OutboundLink =
  | 'source_data'
  | 'cc_by'
  | 'github_repo'
  | 'github_profile'
  | 'linkedin';

export type AnalyticsFilterTab = 'sla' | 'explorer' | 'raw';

export type EstimateSearchSource = 'typeahead' | 'quick_pick' | 'ward_standout' | 'replay' | 'url';

export type EstimateSessionEntry = 'tab_click' | 'url' | 'share_link';

export type EstimateResultMode = 'type_only' | 'ticket' | 'wait_days';

export type EstimateVerdictTone = 'neutral' | 'success' | 'warning' | 'danger';

export type EstimateWaitDaysBucket = 'none' | '1-7' | '8-30' | '31+';

export type EstimateOutboundLink = 'dc311' | 'dc_council' | 'overview';

export type EstimateClearScope = 'input' | 'all';

/** Maps days open to a coarse bucket so GA never receives exact wait times. */
export function bucketEstimateWaitDays(days: number | null): EstimateWaitDaysBucket {
  if (days == null || days <= 0) {
    return 'none';
  }
  if (days <= 7) {
    return '1-7';
  }
  if (days <= 30) {
    return '8-30';
  }
  return '31+';
}

/** Infers how the user arrived on Estimate without logging URL contents. */
export function resolveEstimateSessionEntry(hasEstimateParams: boolean): EstimateSessionEntry {
  if (!hasEstimateParams) {
    return 'tab_click';
  }

  const referrer = document.referrer;
  if (referrer) {
    try {
      if (new URL(referrer).origin !== window.location.origin) {
        return 'share_link';
      }
    } catch {
      // Ignore malformed referrer values.
    }
  }

  return 'url';
}

export function trackOutboundClick(link: OutboundLink): void {
  trackEvent('outbound_click', { link });
}

export function trackAboutOpen(): void {
  trackEvent('about_open');
}

export function trackEstimateLookup(found: boolean): void {
  trackEvent('estimate_lookup', { found });
}

export function trackEstimateSearch(source: EstimateSearchSource, hasWard: boolean): void {
  trackEvent('estimate_search', { source, has_ward: hasWard });
}

export function trackEstimateRefine(hasWard: boolean): void {
  trackEvent('estimate_refine', { has_ward: hasWard });
}

export function trackEstimateShare(): void {
  trackEvent('estimate_share');
}

export function trackEstimateTryAnother(hasWard: boolean): void {
  trackEvent('estimate_try_another', { has_ward: hasWard });
}

export function trackEstimateSlaBridge(from: 'ward_callout' | 'result_footer'): void {
  trackEvent('estimate_sla_bridge', { from });
}

export type OverviewTabBridgeTarget = 'sla' | 'explorer';

export function trackOverviewTabBridge(target: OverviewTabBridgeTarget): void {
  trackEvent('overview_tab_bridge', { target });
}

export function trackSlaHandoffApplied(params: { has_category: boolean; has_ward: boolean }): void {
  trackEvent('sla_handoff_applied', params);
}

export type SectionToggleTab = 'sla' | 'explorer';

export function trackSectionToggle(tab: SectionToggleTab, section: string, open: boolean): void {
  trackEvent('section_toggle', { tab, section, open });
}

/** Sends a virtual pageview when filter tab state changes (no filter values in path). */
export function trackFilterTabPageView(tab: AnalyticsFilterTab, hasActiveFilters: boolean): void {
  const paths: Record<AnalyticsFilterTab, { base: string; filtered: string; title: string }> = {
    sla: { base: '/performance', filtered: '/performance/filtered', title: 'Performance' },
    explorer: { base: '/explore', filtered: '/explore/filtered', title: 'Explore' },
    raw: { base: '/records', filtered: '/records/filtered', title: 'Records' },
  };
  const { base, filtered, title } = paths[tab];
  trackEvent('page_view', {
    page_path: hasActiveFilters ? filtered : base,
    page_title: title,
  });
}

export function trackEstimateSessionStart(entry: EstimateSessionEntry): void {
  trackEvent('estimate_session_start', { entry });
}

export function trackEstimateResultView(params: {
  mode: EstimateResultMode;
  has_estimate: boolean;
  verdict_tone: EstimateVerdictTone;
  has_ward: boolean;
}): void {
  trackEvent('estimate_result_view', params);
}

export function trackEstimateWaitDays(days: number | null): void {
  trackEvent('estimate_wait_days', { bucket: bucketEstimateWaitDays(days) });
}

export function trackEstimateClear(scope: EstimateClearScope): void {
  trackEvent('estimate_clear', { scope });
}

export function trackEstimateSaveImage(): void {
  trackEvent('estimate_save_image');
}

export function trackEstimateCopyLink(): void {
  trackEvent('estimate_copy_link');
}

export function trackEstimateWardGuideShown(): void {
  trackEvent('estimate_ward_guide_shown');
}

export function trackEstimateDetailExpand(): void {
  trackEvent('estimate_detail_expand');
}

export function trackEstimateOutboundClick(link: EstimateOutboundLink): void {
  trackEvent('estimate_outbound_click', { link });
}

/** Sends a virtual pageview when estimate state changes (no PII in path). */
export function trackEstimatePageView(hasLookupState: boolean): void {
  trackEvent('page_view', {
    page_path: hasLookupState ? '/estimate/lookup' : '/estimate',
    page_title: 'Estimate',
  });
}

/** Records filter engagement without logging specific filter values. */
export function trackFilterChange(
  tab: AnalyticsFilterTab,
  previousSummary: string,
  nextSummary: string,
): void {
  if (previousSummary === nextSummary) {
    return;
  }

  if (!nextSummary) {
    trackEvent('filter_clear', { tab });
    return;
  }

  trackEvent('filter_apply', { tab, active_filters: nextSummary });
}
