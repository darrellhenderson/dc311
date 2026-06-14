import { ProcessedRequest } from './dataProcessing';

export type RequestStatusFilter = 'All' | 'Open / In-Progress' | 'Resolved';

export interface ExplorerFilterState {
  categories: string[];
  serviceTypes: string[];
  wards: string[];
  status: RequestStatusFilter;
}

export interface SlaFilterState {
  categories: string[];
  serviceTypes: string[];
  agencies: string[];
  wards: string[];
}

export const EMPTY_EXPLORER_FILTERS: ExplorerFilterState = {
  categories: [],
  serviceTypes: [],
  wards: [],
  status: 'All',
};

export const EMPTY_SLA_FILTERS: SlaFilterState = {
  categories: [],
  serviceTypes: [],
  agencies: [],
  wards: [],
};

export const STATUS_OPTIONS: { label: string; value: RequestStatusFilter }[] = [
  { label: 'All', value: 'All' },
  { label: 'Open / In-Progress', value: 'Open / In-Progress' },
  { label: 'Resolved', value: 'Resolved' },
];

/** Applies explorer/records filter rules (service type overrides category). */
export function filterExplorerRows(
  rows: ProcessedRequest[],
  filters: ExplorerFilterState,
): ProcessedRequest[] {
  let result = rows;
  if (filters.serviceTypes.length > 0) {
    result = result.filter((r) => filters.serviceTypes.includes(r.SERVICECODEDESCRIPTION));
  } else if (filters.categories.length > 0) {
    result = result.filter((r) => filters.categories.includes(r.category));
  }
  if (filters.wards.length > 0) {
    result = result.filter((r) => filters.wards.includes(r.WARD));
  }
  if (filters.status === 'Open / In-Progress') {
    result = result.filter((r) => r.is_open);
  } else if (filters.status === 'Resolved') {
    result = result.filter((r) => r.is_closed);
  }
  return result;
}

/** Applies SLA tab filter rules (all dimensions combine with AND). */
export function filterSlaRows(
  rows: ProcessedRequest[],
  filters: SlaFilterState,
): ProcessedRequest[] {
  return rows.filter((r) => {
    if (filters.categories.length > 0 && !filters.categories.includes(r.category)) return false;
    if (filters.serviceTypes.length > 0 && !filters.serviceTypes.includes(r.SERVICECODEDESCRIPTION)) return false;
    if (filters.agencies.length > 0 && !filters.agencies.includes(r.ORGANIZATIONACRONYM || '')) return false;
    if (filters.wards.length > 0 && !filters.wards.includes(r.WARD)) return false;
    return true;
  });
}

export function countExplorerActiveFilters(filters: ExplorerFilterState): number {
  let n = filters.categories.length + filters.serviceTypes.length + filters.wards.length;
  if (filters.status !== 'All') n += 1;
  return n;
}

export function countSlaActiveFilters(filters: SlaFilterState): number {
  return filters.categories.length + filters.serviceTypes.length + filters.agencies.length + filters.wards.length;
}

/** Active filter dimensions for analytics (values omitted to limit noise and volume). */
export function summarizeExplorerFilterDimensions(filters: ExplorerFilterState): string {
  const parts: string[] = [];
  if (filters.categories.length > 0) parts.push('category');
  if (filters.serviceTypes.length > 0) parts.push('service_type');
  if (filters.wards.length > 0) parts.push('ward');
  if (filters.status !== 'All') parts.push('status');
  return parts.join(',');
}

export function summarizeSlaFilterDimensions(filters: SlaFilterState): string {
  const parts: string[] = [];
  if (filters.categories.length > 0) parts.push('category');
  if (filters.serviceTypes.length > 0) parts.push('service_type');
  if (filters.agencies.length > 0) parts.push('agency');
  if (filters.wards.length > 0) parts.push('ward');
  return parts.join(',');
}

export interface FilterChipItem {
  id: string;
  label: string;
  onRemove: () => void;
}

export function buildMultiSelectChips(
  group: string,
  values: string[],
  onRemove: (value: string) => void,
): FilterChipItem[] {
  return values.map((value) => ({
    id: `${group}:${value}`,
    label: `${group}: ${value}`,
    onRemove: () => onRemove(value),
  }));
}

export function buildExplorerChips(
  filters: ExplorerFilterState,
  onChange: (next: ExplorerFilterState) => void,
): FilterChipItem[] {
  const chips: FilterChipItem[] = [
    ...buildMultiSelectChips('Category', filters.categories, (v) =>
      onChange({ ...filters, categories: filters.categories.filter((c) => c !== v) }),
    ),
    ...buildMultiSelectChips('Service type', filters.serviceTypes, (v) =>
      onChange({ ...filters, serviceTypes: filters.serviceTypes.filter((s) => s !== v) }),
    ),
    ...buildMultiSelectChips('Ward', filters.wards, (v) =>
      onChange({ ...filters, wards: filters.wards.filter((w) => w !== v) }),
    ),
  ];
  if (filters.status !== 'All') {
    chips.push({
      id: 'status',
      label: `Status: ${filters.status}`,
      onRemove: () => onChange({ ...filters, status: 'All' }),
    });
  }
  return chips;
}

export function buildSlaChips(
  filters: SlaFilterState,
  onChange: (next: SlaFilterState) => void,
): FilterChipItem[] {
  return [
    ...buildMultiSelectChips('Category', filters.categories, (v) =>
      onChange({ ...filters, categories: filters.categories.filter((c) => c !== v) }),
    ),
    ...buildMultiSelectChips('Service type', filters.serviceTypes, (v) =>
      onChange({ ...filters, serviceTypes: filters.serviceTypes.filter((s) => s !== v) }),
    ),
    ...buildMultiSelectChips('Agency', filters.agencies, (v) =>
      onChange({ ...filters, agencies: filters.agencies.filter((a) => a !== v) }),
    ),
    ...buildMultiSelectChips('Ward', filters.wards, (v) =>
      onChange({ ...filters, wards: filters.wards.filter((w) => w !== v) }),
    ),
  ];
}
