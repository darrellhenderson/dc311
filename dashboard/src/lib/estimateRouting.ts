import { TAB_IDS, TabId } from './tabIds';

export const ESTIMATE_URL_KEYS = ['ticket', 'type', 'ward', 'wait'] as const;

export function stripEstimateSearchParams(params: URLSearchParams): void {
  for (const key of ESTIMATE_URL_KEYS) {
    params.delete(key);
  }
}

export function resolveTabFromSearchParams(params: URLSearchParams): TabId {
  const tab = params.get('tab');
  if (TAB_IDS.includes(tab as TabId)) {
    return tab as TabId;
  }
  const hasEstimateState = ESTIMATE_URL_KEYS.some((key) => params.has(key));
  return hasEstimateState ? 'estimate' : 'overview';
}
