import { ReactNode, useState } from 'react';
import FilterChips from './FilterChips';
import DateRangeSelect from './DateRangeSelect';
import { FilterChipItem } from '../../../lib/filterTypes';

interface FilterPanelProps {
  activeCount: number;
  chips: FilterChipItem[];
  onClearAll: () => void;
  children: ReactNode;
  className?: string;
  showDateRange?: boolean;
}

export default function FilterPanel({
  activeCount,
  chips,
  onClearAll,
  children,
  className = 'mb-2',
  showDateRange = false,
}: FilterPanelProps) {
  const [open, setOpen] = useState(activeCount > 0);

  return (
    <div className={`bg-surface border border-border rounded-lg ${className}`}>
      <div className="flex items-stretch min-h-[44px]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center px-4 py-2.5 min-w-0 text-left hover:bg-surface-muted/50 rounded-l-lg transition-colors"
          aria-expanded={open}
        >
          <span className="text-body font-medium text-gray-900">
            Filters
            {activeCount > 0 && (
              <span className="ml-2 text-caption font-normal text-text-muted">
                ({activeCount} active)
              </span>
            )}
          </span>
        </button>

        {showDateRange && (
          <div
            className="hidden md:flex items-center shrink-0 border-l border-border px-3"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <DateRangeSelect variant="inline" />
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 px-4 py-2.5 text-text-muted text-sm hover:bg-surface-muted/50 rounded-r-lg transition-colors"
          aria-label={open ? 'Collapse filters' : 'Expand filters'}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>

      {open && (
        <div className="font-mono px-4 pb-3 border-t border-border pt-2.5">
          {showDateRange && (
            <div className="md:hidden mb-3">
              <DateRangeSelect variant="card" className="w-full" />
            </div>
          )}
          {children}
          <FilterChips chips={chips} onClearAll={onClearAll} />
        </div>
      )}

      {!open && chips.length > 0 && (
        <div className="font-mono px-4 pb-2 border-t border-border pt-2">
          <FilterChips chips={chips} onClearAll={onClearAll} />
        </div>
      )}
    </div>
  );
}
