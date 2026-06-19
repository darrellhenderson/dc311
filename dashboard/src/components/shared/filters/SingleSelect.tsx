interface SingleSelectProps {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  describedBy?: string;
  ariaLabel?: string;
}

export default function SingleSelect({
  label,
  value,
  options,
  onChange,
  describedBy,
  ariaLabel,
}: SingleSelectProps) {
  return (
    <div className="font-mono">
      {label && <label className="text-caption font-semibold text-text-muted block mb-1">{label}</label>}
      <select
        className="w-full text-body border border-border rounded-md px-2 py-2 min-h-[44px] bg-surface"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
