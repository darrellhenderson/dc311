import { DateRangePreset } from '../../../api/dataTypes';
import { useDashboard } from '../../../context/DashboardContext';

interface DateRangeSelectProps {
  variant?: 'inline' | 'card';
  className?: string;
}

/** Global date-range control — inline variant sits in the filter panel header. */
export default function DateRangeSelect({ variant = 'card', className = '' }: DateRangeSelectProps) {
  const { datePreset, setDatePreset, isLoading } = useDashboard();

  const select = (
    <select
      id="date-range"
      aria-label="Date range"
      className={
        variant === 'inline'
          ? 'font-mono text-body text-gray-900 border border-border rounded-md px-2 py-1.5 bg-surface hover:bg-surface-muted transition-colors disabled:opacity-50'
          : 'w-full sm:w-auto text-body border border-border rounded-md px-2 py-2 min-h-[44px] bg-surface'
      }
      value={datePreset}
      onChange={(e) => setDatePreset(e.target.value as DateRangePreset)}
      disabled={isLoading}
    >
      <option value="full">Full year</option>
      <option value="90d">Last 90 days</option>
    </select>
  );

  if (variant === 'inline') {
    return <div className={className}>{select}</div>;
  }

  return (
    <div className={`font-mono bg-surface border border-border rounded-lg px-4 py-3 shrink-0 ${className}`}>
      <label htmlFor="date-range" className="text-caption font-semibold text-text-muted block mb-1">
        Date range
      </label>
      {select}
    </div>
  );
}
