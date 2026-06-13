import { useMemo, useState } from 'react';

interface FilterCheckboxListProps {
  label: string;
  options: { label: string; value: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export default function FilterCheckboxList({
  label,
  options,
  selected,
  onChange,
}: FilterCheckboxListProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="font-mono">
      <p className="text-caption font-semibold text-text-muted mb-1">{label}</p>
      <input
        type="search"
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full text-body border border-border rounded-md px-2 py-2 min-h-[44px] mb-2 bg-surface"
        aria-label={`Search ${label}`}
      />
      <div className="border border-border rounded-md bg-surface max-h-48 md:max-h-40 overflow-y-auto scrollbar-thin p-2 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-caption text-text-muted px-1 py-2 mb-0">No matches</p>
        ) : (
          filtered.map((opt) => (
            <label
              key={opt.value}
              className="flex items-start gap-2 text-body cursor-pointer hover:bg-surface-muted rounded px-1 py-2 min-h-[44px]"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="mt-0.5 shrink-0"
              />
              <span className="leading-snug">{opt.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
