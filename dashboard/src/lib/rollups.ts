import {
  DataDictionaries,
  RollupFile,
  SlaRollupRow,
} from '../api/dataTypes';
import { includeInSlaSummary, SLARow } from './dataProcessing';
import { CATEGORICAL_COLORS } from './theme';

const CAT_PALETTE = [...CATEGORICAL_COLORS];

export interface MergedRollups {
  sla: SLARow[];
  categoryBreakdown: Array<{ category: string; resolved: number; open: number; total: number }>;
  dayOfWeek: Array<{ day: string; category: string; count: number }>;
  wardVolume: Array<{ ward: string; open: number; resolved: number }>;
  wardResolution: Array<{ ward: string; pct: number }>;
  countByType: Array<{ type: string; label: string; resolved: number; open: number; total: number }>;
  weeklyVolume: { weeks: string[]; categories: string[]; traces: Array<{ x: string[]; y: number[]; name: string; type: 'bar'; marker: { color: string } }> };
  totalRows: number;
}

function truncate(s: string, n = 32): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

/** Merges per-month rollup files into chart-ready structures. */
export function mergeRollups(rollups: RollupFile[], dicts: DataDictionaries): MergedRollups {
  const categoryBreakdown = mergeCategoryBreakdown(rollups, dicts);
  return {
    sla: mergeSlaRollups(rollups, dicts),
    categoryBreakdown,
    dayOfWeek: mergeDayOfWeek(rollups, dicts),
    wardVolume: mergeWardVolume(rollups, dicts),
    wardResolution: mergeWardResolution(rollups, dicts),
    countByType: mergeCountByType(rollups, dicts),
    weeklyVolume: mergeWeeklyVolume(rollups, dicts),
    totalRows: categoryBreakdown.reduce((s, c) => s + c.total, 0),
  };
}

export function mergeSlaRollups(rollups: RollupFile[], dicts: DataDictionaries): SLARow[] {
  const merged = new Map<number, SlaRollupRow & { _medSum: number; _p99Sum: number }>();

  for (const file of rollups) {
    for (const row of file.sla) {
      const existing = merged.get(row.serviceType);
      if (!existing) {
        merged.set(row.serviceType, {
          ...row,
          // NOTE: monthly medians/p99s cannot be combined exactly across shards.
          // We approximate with a closed-count weighted average. For exact cross-month
          // percentiles, recompute from raw resolution_days (slaTableData path).
          _medSum: row.median_resolution * row.closed,
          _p99Sum: row.p99_resolution * row.closed,
        });
      } else {
        existing.total += row.total;
        existing.closed += row.closed;
        existing.met_sla_count += row.met_sla_count;
        existing.missed_sla_count += row.missed_sla_count;
        existing.open_past_sla_count += row.open_past_sla_count;
        existing._medSum += row.median_resolution * row.closed;
        existing._p99Sum += row.p99_resolution * row.closed;
        if (existing.sla_days <= 0 && row.sla_days > 0) {
          existing.sla_days = row.sla_days;
        }
      }
    }
  }

  const result: SLARow[] = [];
  for (const row of merged.values()) {
    const hasSlaDueDate = row.sla_days > 0;
    if (!includeInSlaSummary(row.total, hasSlaDueDate)) continue;

    const pct_resolved = row.total > 0 ? Math.round((row.closed / row.total) * 1000) / 10 : 0;
    // pct_met_sla denominator is the full request count, not just rows with a due date.
    // Requests without SERVICEDUEDATE are neither missed nor overdue, so they count as met.
    // This intentionally matches the city's published methodology.
    const pct_met_sla = row.total > 0
      ? Math.round(((row.total - row.missed_sla_count - row.open_past_sla_count) / row.total) * 1000) / 10
      : 0;
    const median_resolution = row.closed > 0 ? Math.round((row._medSum / row.closed) * 10) / 10 : 0;
    const p99_resolution = row.closed > 0 ? Math.round((row._p99Sum / row.closed) * 10) / 10 : 0;

    result.push({
      SERVICECODEDESCRIPTION: dicts.serviceTypes[row.serviceType],
      category: dicts.categories[row.category],
      agency: row.agency !== null ? dicts.agencies[row.agency] || '' : '',
      sla_days: row.sla_days,
      total: row.total,
      closed: row.closed,
      met_sla_count: row.met_sla_count,
      missed_sla_count: row.missed_sla_count,
      open_past_sla_count: row.open_past_sla_count,
      median_resolution,
      p99_resolution,
      pct_resolved,
      pct_met_sla,
    });
  }

  return result.sort((a, b) => {
    const cat = a.category.localeCompare(b.category);
    return cat !== 0 ? cat : a.sla_days - b.sla_days;
  });
}

function mergeCategoryBreakdown(rollups: RollupFile[], dicts: DataDictionaries) {
  const stats = new Map<number, { open: number; resolved: number }>();
  for (const file of rollups) {
    for (const row of file.explorer.categoryBreakdown) {
      const s = stats.get(row.c) || { open: 0, resolved: 0 };
      s.open += row.open;
      s.resolved += row.resolved;
      stats.set(row.c, s);
    }
  }
  return Array.from(stats.entries())
    .map(([c, s]) => ({
      category: dicts.categories[c],
      resolved: s.resolved,
      open: s.open,
      total: s.open + s.resolved,
    }))
    .sort((a, b) => a.total - b.total);
}

function mergeDayOfWeek(rollups: RollupFile[], dicts: DataDictionaries) {
  const stats = new Map<string, number>();
  for (const file of rollups) {
    for (const row of file.explorer.dayOfWeek) {
      const key = `${row.dow}:${row.c}`;
      stats.set(key, (stats.get(key) || 0) + row.n);
    }
  }
  const result: Array<{ day: string; category: string; count: number }> = [];
  for (const [key, count] of stats) {
    const [dow, c] = key.split(':').map(Number);
    result.push({ day: dicts.dayOfWeek[dow], category: dicts.categories[c], count });
  }
  return result;
}

function mergeWardVolume(rollups: RollupFile[], dicts: DataDictionaries) {
  const stats = new Map<number, { open: number; resolved: number }>();
  for (const file of rollups) {
    for (const row of file.explorer.wardVolume) {
      const s = stats.get(row.w) || { open: 0, resolved: 0 };
      s.open += row.open;
      s.resolved += row.resolved;
      stats.set(row.w, s);
    }
  }
  return dicts.wards.map((ward, i) => {
    const s = stats.get(i) || { open: 0, resolved: 0 };
    return { ward, open: s.open, resolved: s.resolved };
  });
}

function mergeWardResolution(rollups: RollupFile[], dicts: DataDictionaries) {
  return mergeWardVolume(rollups, dicts).map((w) => {
    const total = w.open + w.resolved;
    return { ward: w.ward, pct: total > 0 ? (w.resolved / total) * 100 : 0 };
  });
}

function mergeCountByType(rollups: RollupFile[], dicts: DataDictionaries) {
  const stats = new Map<number, { open: number; resolved: number }>();
  for (const file of rollups) {
    for (const row of file.explorer.typeCounts) {
      const s = stats.get(row.st) || { open: 0, resolved: 0 };
      s.open += row.open;
      s.resolved += row.resolved;
      stats.set(row.st, s);
    }
  }
  return Array.from(stats.entries())
    .map(([st, s]) => {
      const type = dicts.serviceTypes[st];
      return {
        type,
        label: truncate(type),
        resolved: s.resolved,
        open: s.open,
        total: s.open + s.resolved,
      };
    })
    .sort((a, b) => a.total - b.total);
}

function mergeWeeklyVolume(rollups: RollupFile[], dicts: DataDictionaries) {
  const weekCat = new Map<number, Map<number, number>>();
  const categories = new Set<number>();

  for (const file of rollups) {
    for (const row of file.explorer.weeklyVolume) {
      categories.add(row.c);
      if (!weekCat.has(row.wk)) weekCat.set(row.wk, new Map());
      const catMap = weekCat.get(row.wk)!;
      catMap.set(row.c, (catMap.get(row.c) || 0) + row.n);
    }
  }

  const weeks = Array.from(weekCat.keys()).sort((a, b) => a - b);
  const weekLabels = weeks.map((wk) => {
    const d = new Date(wk);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  const catOrder = Array.from(categories).sort((a, b) => {
    const totalA = weeks.reduce((s, wk) => s + (weekCat.get(wk)?.get(a) || 0), 0);
    const totalB = weeks.reduce((s, wk) => s + (weekCat.get(wk)?.get(b) || 0), 0);
    return totalB - totalA;
  });

  const traces = catOrder.map((c, i) => ({
    x: weekLabels,
    y: weeks.map((wk) => weekCat.get(wk)?.get(c) || 0),
    name: dicts.categories[c],
    type: 'bar' as const,
    marker: { color: CAT_PALETTE[i % CAT_PALETTE.length] },
  }));

  return {
    weeks: weekLabels,
    categories: catOrder.map((c) => dicts.categories[c]),
    traces,
  };
}

/** True when no tab-specific filters are active (rollup fast-path eligible). */
export function hasSlaFilters(
  categories: string[],
  serviceTypes: string[],
  agencies: string[],
  wards: string[],
): boolean {
  return categories.length > 0 || serviceTypes.length > 0 || agencies.length > 0 || wards.length > 0;
}

export function hasExplorerFilters(
  categories: string[],
  serviceTypes: string[],
  wards: string[],
  status: string,
): boolean {
  return categories.length > 0 || serviceTypes.length > 0 || wards.length > 0 || status !== 'All';
}
