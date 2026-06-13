import { FilterChipItem } from '../../../lib/filterTypes';

interface FilterChipsProps {
  chips: FilterChipItem[];
  onClearAll: () => void;
}

export default function FilterChips({ chips, onClearAll }: FilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="font-mono flex flex-wrap items-center gap-1.5 mt-2">
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1 text-caption bg-surface-muted border border-border rounded-full px-2.5 py-1"
        >
          <span className="max-w-[200px] truncate">{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            className="text-text-muted hover:text-gray-900 leading-none"
            aria-label={`Remove ${chip.label}`}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="min-h-[44px] text-caption text-blue-600 hover:underline px-1"
      >
        Clear all
      </button>
    </div>
  );
}
