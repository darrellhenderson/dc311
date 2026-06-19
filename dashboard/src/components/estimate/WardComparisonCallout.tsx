import { WardComparison } from '../../lib/estimateData';

interface WardComparisonCalloutProps {
  comparison: WardComparison;
  category?: string | null;
  onViewSlaPerformance?: () => void;
}

const deltaClasses = {
  slower: 'text-amber-800',
  faster: 'text-green-800',
} as const;

export default function WardComparisonCallout({
  comparison,
  category,
  onViewSlaPerformance,
}: WardComparisonCalloutProps) {
  const delta = Math.abs(comparison.wardMedian - comparison.citywideMedian);
  const roundedDelta = Math.round(delta);
  const dayWord = roundedDelta === 1 ? 'day' : 'days';

  const deltaLabel = delta < 1
    ? `${comparison.ward} is typically about the same as the rest of the city`
    : comparison.direction === 'slower'
      ? `${comparison.ward} is typically ${roundedDelta} ${dayWord} slower than the rest of the city`
      : `${comparison.ward} is typically ${roundedDelta} ${dayWord} faster than the rest of the city`;

  const deltaClass = delta < 1
    ? 'text-gray-700'
    : deltaClasses[comparison.direction];

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface-muted px-4 py-3">
      <p className="sr-only">{comparison.sentence}</p>
      <p className="text-caption font-semibold text-text-muted uppercase tracking-wide mb-2">
        Ward vs. citywide
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-caption text-text-muted mb-0.5">{comparison.ward}</p>
          <p className="font-mono text-lg font-bold tabular-nums text-gray-900 mb-0">
            {comparison.wardRange} days
          </p>
        </div>
        <div>
          <p className="text-caption text-text-muted mb-0.5">Citywide</p>
          <p className="font-mono text-lg font-bold tabular-nums text-gray-900 mb-0">
            {comparison.citywideRange} days
          </p>
        </div>
      </div>
      <p className={`mt-2 mb-0 text-sm font-medium ${deltaClass}`}>
        {deltaLabel}
      </p>
      {category && onViewSlaPerformance && (
        <button
          type="button"
          onClick={onViewSlaPerformance}
          className="mt-2 mb-0 text-sm text-blue-700 hover:text-blue-900 underline"
        >
          See all {category} performance in {comparison.ward} →
        </button>
      )}
    </div>
  );
}
