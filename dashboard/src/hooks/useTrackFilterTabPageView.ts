import { useEffect, useRef } from 'react';
import { AnalyticsFilterTab, trackFilterTabPageView } from '../lib/analytics';

/** Fires a virtual pageview when filter engagement on a tab changes. */
export function useTrackFilterTabPageView(tab: AnalyticsFilterTab, filterSummary: string): void {
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const key = filterSummary || '__none__';
    if (key === lastKey.current) {
      return;
    }
    lastKey.current = key;
    trackFilterTabPageView(tab, Boolean(filterSummary));
  }, [tab, filterSummary]);
}
