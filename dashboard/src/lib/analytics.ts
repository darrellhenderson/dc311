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

/** Records an external link click from the footer or About panel. */
export function trackOutboundClick(link: OutboundLink): void {
  trackEvent('outbound_click', { link });
}

/** Records when the Notes panel is opened. */
export function trackAboutOpen(): void {
  trackEvent('about_open');
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
