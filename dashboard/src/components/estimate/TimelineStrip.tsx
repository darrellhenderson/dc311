import { useEffect, useRef, useState } from 'react';
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

function tickLabelPosition(
  positionPct: number,
  stripWidthPx: number,
  labelText: string,
): { left: string; alignClass: string } {
  const labelWidthPx = labelText.length * 7.5;
  const halfLabelPx = labelWidthPx / 2;

  if (stripWidthPx <= 0) {
    return { left: `${positionPct}%`, alignClass: '-translate-x-full' };
  }

  const centerPx = (positionPct / 100) * stripWidthPx;
  if (centerPx + halfLabelPx > stripWidthPx) {
    return { left: `${positionPct}%`, alignClass: '-translate-x-full' };
  }
  if (centerPx - halfLabelPx < 0) {
    return { left: `${positionPct}%`, alignClass: '' };
  }
  return { left: `${positionPct}%`, alignClass: '-translate-x-1/2' };
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

// Bracket glyphs consume fixed width; pixel budget avoids truncated labels in narrow bands.
const BRACKET_OVERHEAD_PX = 36;
const MIN_TYPICAL_LABEL_PX = 40;
const MIN_LONG_TAIL_LABEL_PX = 28;

export default function TimelineStrip({ estimate, markerDays }: TimelineStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripWidth, setStripWidth] = useState(0);

  useEffect(() => {
    const node = stripRef.current;
    if (!node) return undefined;

    const syncWidth = () => {
      setStripWidth(node.clientWidth);
    };

    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
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

  const typicalBandPx = (typicalBandWidth / 100) * stripWidth;
  const longTailBandPx = (longTailWidth / 100) * stripWidth;

  // Choose label set based on available space
  const useShortLabels = typicalBandPx < 120
    || (longTailWidth > 0 && longTailBandPx < 100)
    || isZeroDayCase;
  const labels = useShortLabels ? SHORT_LABELS : LABELS;

  // Hide bracket row when bands are too narrow to fit text, or for 0-day cases
  const showTypicalAnnotation = typicalBandPx >= BRACKET_OVERHEAD_PX + MIN_TYPICAL_LABEL_PX;
  const showLongTailAnnotation = longTailWidth > 0
    && longTailBandPx >= BRACKET_OVERHEAD_PX + MIN_LONG_TAIL_LABEL_PX;
  const showBracketAnnotations = showTypicalAnnotation && !isZeroDayCase;

  const ariaLabel = markerDays != null && markerDays > 0
    ? `Typical resolution ${formatTick(estimate.p25)} to ${formatTick(estimate.p75)}. You at ${formatTick(markerDays)}.`
    : `Typical resolution ${formatTick(estimate.p25)} to ${formatTick(estimate.p75)}.`;

  const slaLabelText = `city's deadline ${formatTick(estimate.sla_days)}`;
  const slaLabelPosition = slaLeft !== null
    ? tickLabelPosition(slaLeft, stripWidth, slaLabelText)
    : null;
  const markerLabelPosition = markerLeft !== null
    ? tickLabelPosition(markerLeft, stripWidth, LABELS.you)
    : null;

  return (
    <div ref={stripRef} className="font-mono" aria-label={ariaLabel}>
      {showBracketAnnotations && (
        <div className="relative h-6 mb-1 text-[11px] text-text-muted">
          {/* Typical band bracket */}
          <div
            className="absolute bottom-0 flex items-center overflow-hidden"
            style={{ left: `${p25Left}%`, width: `${Math.max(typicalBandWidth, 0)}%` }}
          >
            <span className="shrink-0">╭──</span>
            <div className="flex-1 min-w-0 text-center px-1 truncate">{labels.typical}</div>
            <span className="shrink-0">──╮</span>
          </div>
          {/* Long tail bracket — only show if wide enough */}
          {showLongTailAnnotation && (
            <div
              className="absolute bottom-0 flex items-center overflow-hidden"
              style={{ left: `${p75Left}%`, width: `${Math.max(longTailWidth, 0)}%` }}
            >
              <span className="shrink-0">╭──</span>
              <div className="flex-1 min-w-0 text-center px-1 truncate">{labels.longTail}</div>
              <span className="shrink-0">──╮</span>
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
              {barEnd >= 0.5 && barEndLeft - p75Left >= 5
                && !(slaLeft !== null && Math.abs(barEndLeft - slaLeft) < 8) && (
                <span className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${barEndLeft}%` }}>
                  {formatTick(barEnd)}
                </span>
              )}
            </>
          )}
        </div>
        <div className="relative h-5">
          {/* Hide SLA tick when it would collide with marker (within 5%) */}
          {slaLeft !== null && slaLabelPosition !== null
            && !(markerLeft !== null && Math.abs(slaLeft - markerLeft) < 5) && (
            <span
              className={`absolute tabular-nums whitespace-nowrap ${slaLabelPosition.alignClass}`}
              style={{ left: slaLabelPosition.left, color: colors.warning }}
            >
              {slaLabelText}
            </span>
          )}
          {markerLeft !== null && markerLabelPosition !== null && (
            <span
              className={`absolute font-medium whitespace-nowrap tabular-nums transition-[left] duration-500 ease-out ${markerLabelPosition.alignClass}`}
              style={{ left: markerLabelPosition.left, color: colors.danger }}
            >
              {LABELS.you}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
