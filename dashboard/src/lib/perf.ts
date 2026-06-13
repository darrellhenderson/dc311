export function markPerf(name: string): void {
  if (typeof performance !== 'undefined') {
    performance.mark(name);
  }
}

export function measurePerf(start: string, end: string, label: string): void {
  if (typeof performance === 'undefined') return;
  try {
    performance.measure(label, start, end);
    const entry = performance.getEntriesByName(label).pop();
    if (entry && import.meta.env.DEV) {
      console.debug(`[perf] ${label}: ${entry.duration.toFixed(1)}ms`);
    }
  } catch {
    // Ignore missing marks.
  }
}
