import { ServiceRequest } from '../api/types';

export interface ProcessedRequest extends ServiceRequest {
  date: Date;
  week: Date;
  hour: number;
  dayOfWeek: string;
  category: string;
  is_open: boolean;
  is_closed: boolean;
  age_days: number;
  resolution_days: number | null;
  age_bucket: string;
}

export interface SLARow {
  SERVICECODEDESCRIPTION: string;
  category: string;
  agency: string;
  sla_days: number;
  total: number;
  closed: number;
  met_sla_count: number;
  missed_sla_count: number;
  open_past_sla_count: number;
  median_resolution: number;
  p99_resolution: number;
  pct_resolved: number;
  pct_met_sla: number;
}

function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(dateStr);
}

export function slaTableData(requests: ProcessedRequest[]): SLARow[] {
  const grouped = new Map<string, {
    category: string;
    agency: string;
    sla_days: number[];
    total: number;
    closed: number;
    met_sla_count: number;
    missed_sla_count: number;
    open_past_sla_count: number;
    resolution_times: number[];
  }>();
  
  for (const r of requests) {
    const key = r.SERVICECODEDESCRIPTION;
    if (!grouped.has(key)) {
      grouped.set(key, {
        category: r.category,
        agency: r.ORGANIZATIONACRONYM || '',
        sla_days: [],
        total: 0,
        closed: 0,
        met_sla_count: 0,
        missed_sla_count: 0,
        open_past_sla_count: 0,
        resolution_times: [],
      });
    }
    
    const group = grouped.get(key)!;
    group.total++;
    
    if (r.is_closed) {
      group.closed++;
    }
    
    const serviceDueDate = parseDate(r.SERVICEDUEDATE);
    if (serviceDueDate) {
      const sla_days = (serviceDueDate.getTime() - r.date.getTime()) / (1000 * 60 * 60 * 24);
      group.sla_days.push(sla_days);
      
      if (r.is_closed && r.resolution_days !== null) {
        if (r.resolution_days <= sla_days) {
          group.met_sla_count++;
        } else {
          group.missed_sla_count++;
        }
      }
      
      if (r.is_open && r.age_days > sla_days) {
        group.open_past_sla_count++;
      }
    }
    
    if (r.resolution_days !== null) {
      group.resolution_times.push(r.resolution_days);
    }
  }
  
  const result: SLARow[] = [];
  for (const [serviceType, group] of grouped) {
    const hasSlaDueDate = group.sla_days.length > 0;
    if (!includeInSlaSummary(group.total, hasSlaDueDate)) continue;

    const sla_days = hasSlaDueDate
      ? median(group.sla_days)
      : -1;
    
    const resolution_times = group.resolution_times.sort((a, b) => a - b);
    const median_resolution = resolution_times.length > 0 
      ? median(resolution_times) 
      : 0;
    const p99_resolution = resolution_times.length > 0 
      ? percentile(resolution_times, 99) 
      : 0;
    
    const pct_resolved = (group.closed / group.total) * 100;
    // pct_met_sla denominator is the full request count, not just rows with a due date.
    // Requests without SERVICEDUEDATE are neither missed nor overdue, so they count as met.
    // This intentionally matches the city's published methodology.
    const pct_met_sla = ((group.total - group.missed_sla_count - group.open_past_sla_count) / group.total) * 100;
    
    result.push({
      SERVICECODEDESCRIPTION: serviceType,
      category: group.category,
      agency: group.agency,
      sla_days: Math.round(sla_days),
      total: group.total,
      closed: group.closed,
      met_sla_count: group.met_sla_count,
      missed_sla_count: group.missed_sla_count,
      open_past_sla_count: group.open_past_sla_count,
      median_resolution: Math.round(median_resolution * 10) / 10,
      p99_resolution: Math.round(p99_resolution * 10) / 10,
      pct_resolved: Math.round(pct_resolved * 10) / 10,
      pct_met_sla: Math.round(pct_met_sla * 10) / 10,
    });
  }
  
  return result.sort((a, b) => {
    const catCompare = a.category.localeCompare(b.category);
    if (catCompare !== 0) return catCompare;
    return a.sla_days - b.sla_days;
  });
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (upper >= sorted.length) return sorted[sorted.length - 1];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export interface SLACategorySummary {
  category: string;
  total: number;
  missed: number;
  overdue: number;
  good: number;
  pct_met_sla: number;
}

/** Include in SLA views when due dates exist, or volume is high enough for stable stats. */
export function includeInSlaSummary(total: number, hasSlaDueDate: boolean): boolean {
  return hasSlaDueDate || total >= 50;
}

export function slaCategorySummary(slaRows: SLARow[]): SLACategorySummary[] {
  const grouped = new Map<string, { total: number; missed: number; overdue: number }>();
  
  for (const row of slaRows) {
    if (!grouped.has(row.category)) {
      grouped.set(row.category, { total: 0, missed: 0, overdue: 0 });
    }
    const group = grouped.get(row.category)!;
    group.total += row.total;
    group.missed += row.missed_sla_count;
    group.overdue += row.open_past_sla_count;
  }
  
  const result: SLACategorySummary[] = [];
  for (const [category, group] of grouped) {
    const good = group.total - group.missed - group.overdue;
    const pct_met_sla = group.total > 0 ? (good / group.total) * 100 : 0;
    result.push({
      category,
      total: group.total,
      missed: group.missed,
      overdue: group.overdue,
      good,
      pct_met_sla: Math.round(pct_met_sla * 10) / 10,
    });
  }
  
  return result.sort((a, b) => a.pct_met_sla - b.pct_met_sla);
}
