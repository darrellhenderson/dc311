import { useMemo } from 'react';
import {
  ExplorerFilterState,
  EMPTY_EXPLORER_FILTERS,
  STATUS_OPTIONS,
  buildExplorerChips,
  countExplorerActiveFilters,
  RequestStatusFilter,
} from '../../../lib/filterTypes';
import { useFilterOptions } from '../../../hooks/useFilterOptions';
import { ProcessedRequest } from '../../../lib/dataProcessing';
import FilterPanel from './FilterPanel';
import FilterCheckboxList from './FilterCheckboxList';
import SingleSelect from './SingleSelect';

interface ExplorerFilterBarProps {
  rows: ProcessedRequest[];
  filters: ExplorerFilterState;
  onChange: (filters: ExplorerFilterState) => void;
  className?: string;
  showDateRange?: boolean;
}

export default function ExplorerFilterBar({
  rows,
  filters,
  onChange,
  className,
  showDateRange = true,
}: ExplorerFilterBarProps) {
  const options = useFilterOptions(rows);

  const chips = useMemo(
    () => buildExplorerChips(filters, onChange),
    [filters, onChange],
  );

  const activeCount = countExplorerActiveFilters(filters);

  return (
    <FilterPanel
      activeCount={activeCount}
      chips={chips}
      onClearAll={() => onChange(EMPTY_EXPLORER_FILTERS)}
      className={className}
      showDateRange={showDateRange}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <FilterCheckboxList
          label="Category"
          options={options.categories}
          selected={filters.categories}
          onChange={(categories) => onChange({ ...filters, categories })}
        />
        <FilterCheckboxList
          label="Service type"
          options={options.serviceTypes}
          selected={filters.serviceTypes}
          onChange={(serviceTypes) => onChange({ ...filters, serviceTypes })}
        />
        <FilterCheckboxList
          label="Ward"
          options={options.wards}
          selected={filters.wards}
          onChange={(wards) => onChange({ ...filters, wards })}
        />
        <SingleSelect
          label="Status"
          value={filters.status}
          options={STATUS_OPTIONS}
          onChange={(status) => onChange({ ...filters, status: status as RequestStatusFilter })}
        />
      </div>
    </FilterPanel>
  );
}
