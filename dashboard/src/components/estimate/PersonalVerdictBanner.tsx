import { ReactNode } from 'react';
import { ConfidenceTone } from '../../lib/estimateData';

interface PersonalVerdictBannerProps {
  headline: string;
  detail: string;
  tone: ConfidenceTone;
  resolutionLine?: string | null;
  neutralBox?: boolean;
  children?: ReactNode;
  onShare?: () => void;
  saveLinkNudge?: ReactNode;
}

const toneClasses: Record<ConfidenceTone, string> = {
  success: 'bg-green-50 border-green-200',
  warning: 'bg-amber-50 border-amber-200',
  danger: 'bg-red-50 border-red-200',
};

const neutralBoxClasses = 'bg-surface-muted border-border';

const headlineClasses: Record<ConfidenceTone, string> = {
  success: 'text-green-900',
  warning: 'text-amber-900',
  danger: 'text-red-900',
};

export default function PersonalVerdictBanner({
  headline,
  detail,
  tone,
  resolutionLine,
  neutralBox = false,
  children,
  onShare,
  saveLinkNudge,
}: PersonalVerdictBannerProps) {
  return (
    <div>
      <div
        className={`rounded-lg border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${
          neutralBox ? neutralBoxClasses : toneClasses[tone]
        }`}
        role="status"
      >
      <div className="flex-1 min-w-0">
        <p className={`text-lg font-semibold mb-0.5 ${headlineClasses[tone]}`}>
          {headline}
        </p>
        {detail && (
          <p className="text-body text-gray-800 mb-0">{detail}</p>
        )}
        {resolutionLine && (
          <p className="text-sm font-medium text-gray-700 mb-0 mt-1">{resolutionLine}</p>
        )}
      </div>
      {(onShare || children) && (
        <div className="flex flex-wrap gap-2 shrink-0 justify-end">
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md border border-border bg-surface hover:bg-surface-muted transition-colors"
              aria-label="Share this result"
            >
              <svg className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15" />
              </svg>
            </button>
          )}
          {children}
        </div>
      )}
      </div>
      {saveLinkNudge && (
        <div className="mt-2">{saveLinkNudge}</div>
      )}
    </div>
  );
}
