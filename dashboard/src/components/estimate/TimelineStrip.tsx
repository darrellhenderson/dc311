import { EstimateResult, estimateBarEnd } from '../../lib/estimateData';
import { CATEGORICAL_COLORS, colors } from '../../lib/theme';

interface TimelineStripProps {
  estimate: EstimateResult;
  markerDays?: number | null;
}

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

function formatTick(days: number): string {
  return `${Math.round(days)}d`;
}

const LABELS = {
  typical: 'typical range',
  longTail: 'slower than most',
  deadline: 'city deadline',
  you: 'you',
} as const;

const SHORT_LABELS = {
  typical: 'typical',
  longTail: 'slow',
  deadline: 'deadline',
  you: 'you',
} as const;

export default function TimelineStrip({ estimate, markerDays }: TimelineStripProps) {
  const barEnd = estimateBarEnd(estimate);
  const maxValue = Math.max(
    barEnd,
    estimate.sla_days > 0 ? estimate.sla_days : 0,
    markerDays ?? 0,
  ) * 1.15;
  const p25Left = pct(estimate.p25, maxValue);
  const p75Left = pct(estimate.p75, maxValue);
  const barEndLeft = pct(barEnd, maxValue);
  const slaLeft = estimate.sla_days > 0 ? pct(estimate.sla_days, maxValue) : null;
  const markerLeft = markerDays != null && markerDays > 0 ? pct(markerDays, maxValue) : null;
  const bandColor = CATEGORICAL_COLORS[0];

  const typicalBandWidth = p75Left - p25Left;
  const longTailWidth = barEndLeft - p75Left;

  // Handle 0-day degenerate case: when p25 and p75 are both effectively 0
  const isZeroDayCase = estimate.p25 < 1 && estimate.p75 < 1;
  // For 0-day cases, calculate position of 1 day for the bar end
  const oneDayLeft = isZeroDayCase ? pct(1, maxValue) : null;

  // Choose label set based on available space
  const useShortLabels = typicalBandWidth < 12 || (longTailWidth > 0 && longTailWidth < 12) || isZeroDayCase;
  const labels = useShortLabels ? SHORT_LABELS : LABELS;

  // Hide bracket row when bands are too narrow to fit text, or when typical collides with marker, or for 0-day cases
  const showBracketAnnotations = typicalBandWidth >= 8 && !isZeroDayCase;

  const ariaLabel = markerDays != null && markerDays > 0
    ? `Typical resolution ${formatTick(estimate.p25)} to ${formatTick(estimate.p75)}. You at ${formatTick(markerDays)}.`
    : `Typical resolution ${formatTick(estimate.p25)} to ${formatTick(estimate.p75)}.`;

  return (
    <div className="font-mono" aria-label={ariaLabel}>
      {showBracketAnnotations && (
        <div className="relative h-6 mb-1 text-[11px] text-text-muted">
          {/* Typical band bracket */}
          <div
            className="absolute bottom-0 flex items-center"
            style={{ left: `${p25Left}%`, width: `${Math.max(typicalBandWidth, 0)}%` }}
          >
            <span>╭──</span>
            <div className="flex-1 text-center px-1 truncate">{labels.typical}</div>
            <span>──╮</span>
          </div>
          {/* Long tail bracket — only show if wide enough */}
          {longTailWidth >= 10 && (
            <div
              className="absolute bottom-0 flex items-center"
              style={{ left: `${p75Left}%`, width: `${Math.max(longTailWidth, 0)}%` }}
            >
              <span>╭──</span>
              <div className="flex-1 text-center px-1 truncate">{labels.longTail}</div>
              <span>──╮</span>
            </div>
          )}
        </div>
      )}
      {/* Show "Resolved same day" note for 0-day case */}
      {isZeroDayCase && (
        <div className="relative h-6 mb-1 text-[11px] text-text-muted">
          <div
            className="absolute bottom-0 flex items-center"
            style={{ left: '0%', width: `${oneDayLeft ?? 0}%` }}
          >
            <span>╭──</span>
            <div className="flex-1 text-center px-1 truncate">Resolved same day</div>
            <span>──╮</span>
          </div>
        </div>
      )}
      <div className="relative h-3.5 rounded-full bg-surface-muted overflow-visible">
        {isZeroDayCase ? (
          // For 0-day case: show single bar from 0 to max(barEnd, 1d) to represent full range
          <div
            className="absolute top-0 h-full rounded-l-full"
            style={{
              left: '0%',
              width: `${Math.max(barEndLeft, oneDayLeft ?? 0)}%`,
              backgroundColor: `${bandColor}cc`,
            }}
          />
        ) : (
          <>
            <div
              className="absolute top-0 h-full rounded-l-full"
              style={{
                left: `${p25Left}%`,
                width: `${Math.max(p75Left - p25Left, 0)}%`,
                backgroundColor: `${bandColor}cc`,
              }}
            />
            <div
              className="absolute top-0 h-full"
              style={{
                left: `${p75Left}%`,
                width: `${Math.max(barEndLeft - p75Left, 0)}%`,
                backgroundColor: `${bandColor}66`,
              }}
            />
          </>
        )}
        {slaLeft !== null && (
          <div
            className="absolute top-[-4px] bottom-[-16px] w-0 border-l-2 border-dashed"
            style={{ left: `${slaLeft}%`, borderColor: colors.warning }}
          />
        )}
        {markerLeft !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow transition-[left] duration-500 ease-out"
            style={{ left: `${markerLeft}%`, backgroundColor: colors.danger }}
          />
        )}
      </div>
      <div className="relative mt-1.5 text-caption text-text-muted">
        <div className="relative h-4">
          {isZeroDayCase ? (
            // For 0-day case: show "1d" at 1-day position and bar end at its position
            <>
              {oneDayLeft !== null && (
                <span className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${oneDayLeft}%` }}>
                  1d
                </span>
              )}
              {barEnd >= 0.5 && barEndLeft - (oneDayLeft ?? 0) >= 5 && (
                <span className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${barEndLeft}%` }}>
                  {formatTick(barEnd)}
                </span>
              )}
            </>
          ) : (
            <>
              {/* Hide p25 tick when it's too close to 0 (within 3%) or would display as "0d" */}
              {estimate.p25 >= 0.5 && (
                <span className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${p25Left}%` }}>
                  {formatTick(estimate.p25)}
                </span>
              )}
              {/* Hide p75 tick when it's within 5% of p25 (duplicate labels) or would display as "0d" */}
              {estimate.p75 >= 0.5 && p75Left - p25Left >= 5 && (
                <span className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${p75Left}%` }}>
                  {formatTick(estimate.p75)}
                </span>
              )}
              {/* Hide bar-end tick when it's within 5% of p75 (duplicate labels) or would display as "0d" */}
              {barEnd >= 0.5 && barEndLeft - p75Left >= 5 && (
                <span className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${barEndLeft}%` }}>
                  {formatTick(barEnd)}
                </span>
              )}
            </>
          )}
        </div>
        <div className="relative h-5">
          {/* Hide SLA tick when it would collide with marker (within 5%) */}
          {slaLeft !== null && !(markerLeft !== null && Math.abs(slaLeft - markerLeft) < 5) && (
            <span
              className="absolute -translate-x-1/2 tabular-nums whitespace-nowrap"
              style={{ left: `${slaLeft}%`, color: colors.warning }}
            >
              city's deadline {formatTick(estimate.sla_days)}
            </span>
          )}
          {markerLeft !== null && (
            <span
              className={`absolute font-medium whitespace-nowrap tabular-nums transition-[left] duration-500 ease-out ${
                markerLeft > 95 ? 'text-right right-0' : '-translate-x-1/2'
              }`}
              style={{ left: markerLeft > 95 ? '100%' : `${markerLeft}%`, color: colors.danger }}
            >
              {LABELS.you}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
