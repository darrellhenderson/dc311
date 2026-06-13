import { useMemo } from 'react';
import {
  SlaFilterState,
  EMPTY_SLA_FILTERS,
  buildSlaChips,
  countSlaActiveFilters,
} from '../../../lib/filterTypes';
import { useFilterOptions } from '../../../hooks/useFilterOptions';
import { ProcessedRequest } from '../../../lib/dataProcessing';
import FilterPanel from './FilterPanel';
import FilterCheckboxList from './FilterCheckboxList';

interface SlaFilterBarProps {
  rows: ProcessedRequest[];
  filters: SlaFilterState;
  onChange: (filters: SlaFilterState) => void;
  className?: string;
  showDateRange?: boolean;
}

export default function SlaFilterBar({
  rows,
  filters,
  onChange,
  className,
  showDateRange = true,
}: SlaFilterBarProps) {
  const options = useFilterOptions(rows);

  const chips = useMemo(
    () => buildSlaChips(filters, onChange),
    [filters, onChange],
  );

  const activeCount = countSlaActiveFilters(filters);

  return (
    <FilterPanel
      activeCount={activeCount}
      chips={chips}
      onClearAll={() => onChange(EMPTY_SLA_FILTERS)}
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
          label="Agency"
          options={options.agencies}
          selected={filters.agencies}
          onChange={(agencies) => onChange({ ...filters, agencies })}
        />
        <FilterCheckboxList
          label="Ward"
          options={options.wards}
          selected={filters.wards}
          onChange={(wards) => onChange({ ...filters, wards })}
        />
      </div>
    </FilterPanel>
  );
}
