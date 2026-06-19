import { CITYWIDE_MIN_SAMPLE, ServiceTypeStats } from '../../lib/estimateData';

interface EstimateEmptyResultCardProps {
  serviceType: string;
  typeStats: ServiceTypeStats;
  ward: string;
  showTryAnother: boolean;
  onTryAnother: () => void;
}

export default function EstimateEmptyResultCard({
  serviceType,
  typeStats,
  ward,
  showTryAnother,
  onTryAnother,
}: EstimateEmptyResultCardProps) {
  return (
    <section className="bg-surface border border-border rounded-lg mb-2">
      <div className="px-4 py-2.5">
        <h3 className="text-body font-semibold text-gray-900 mb-0">Not enough resolution history</h3>
        <p className="text-caption text-text-muted mb-0 mt-0.5">{serviceType}</p>
      </div>
      <div className="px-4 pb-3 border-t border-border pt-2.5">
        <p className="text-body text-gray-800 mb-4">
          We don&apos;t have enough closed requests for this service type to show a reliable estimate
          (fewer than {CITYWIDE_MIN_SAMPLE} resolved in the past year).
        </p>
        <div className="font-mono text-caption text-text-muted space-y-1">
          <p className="mb-0">{typeStats.total.toLocaleString()} requests in the dataset</p>
          <p className="mb-0">
            {typeStats.closed.toLocaleString()} closed · {typeStats.open.toLocaleString()} still open
          </p>
          {typeStats.closed === 0 && (
            <p className="mb-0 text-amber-800">
              None have resolved yet — check back once the city closes some requests of this type.
            </p>
          )}
        </div>

        {showTryAnother && (
          <div className="mt-4 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onTryAnother}
              className="min-h-[44px] px-3 py-2 text-sm font-medium border border-border rounded-md bg-surface hover:bg-surface-muted transition-colors"
            >
              {ward ? `Check another in ${ward}` : 'Try another'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
