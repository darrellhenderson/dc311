interface EstimateReplayCardProps {
  title: string;
  promptLine?: string | null;
  suggestTypes: string[];
  onSelectType: (serviceType: string) => void;
}

export default function EstimateReplayCard({
  title,
  promptLine,
  suggestTypes,
  onSelectType,
}: EstimateReplayCardProps) {
  if (!promptLine) return null;

  return (
    <section className="bg-surface border border-border rounded-lg mb-2">
      <div className="px-4 py-2.5 border-b border-border">
        <h3 className="text-body font-medium text-gray-900 mb-0">{title}</h3>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-gray-700 mb-0">{promptLine}</p>
        {suggestTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2.5">
            {suggestTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onSelectType(type)}
                className="text-caption px-2.5 py-1 min-h-[32px] rounded-full border border-border bg-surface-muted hover:bg-blue-50 hover:border-blue-200 hover:text-blue-900 text-gray-800 transition-colors"
              >
                {type}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
