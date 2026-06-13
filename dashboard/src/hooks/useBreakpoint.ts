import { useSyncExternalStore } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia('(min-width: 1024px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'mobile';
}

function subscribe(onStoreChange: () => void): () => void {
  const queries = [
    window.matchMedia('(min-width: 768px)'),
    window.matchMedia('(min-width: 1024px)'),
  ];

  const handler = () => onStoreChange();

  queries.forEach((mq) => {
    mq.addEventListener('change', handler);
    // Legacy Safari < 14
    if ('addListener' in mq && typeof mq.addListener === 'function') {
      mq.addListener(handler);
    }
  });

  window.addEventListener('resize', handler);

  return () => {
    queries.forEach((mq) => {
      mq.removeEventListener('change', handler);
      if ('removeListener' in mq && typeof mq.removeListener === 'function') {
        mq.removeListener(handler);
      }
    });
    window.removeEventListener('resize', handler);
  };
}

/** Tracks viewport tier; re-renders when crossing 768px / 1024px or on resize. */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getBreakpoint, () => 'desktop');
}

export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile';
}

export function useIsDesktop(): boolean {
  return useBreakpoint() === 'desktop';
}
