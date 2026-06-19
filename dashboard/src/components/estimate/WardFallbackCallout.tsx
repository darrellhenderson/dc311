interface WardFallbackCalloutProps {
  ward: string;
}

export default function WardFallbackCallout({ ward }: WardFallbackCalloutProps) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface-muted px-4 py-3">
      <p className="text-sm text-gray-700 mb-0">
        Not enough data for {ward} specifically — showing citywide estimate.
      </p>
    </div>
  );
}
