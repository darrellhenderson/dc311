import { useEffect, useRef, useState } from 'react';
import { ConfidenceTone } from '../../lib/estimateData';
import { TAB_NAV_HEIGHT_VAR } from '../shell/TabNav';

interface StickyVerdictBarProps {
  headline: string;
  tone: ConfidenceTone;
}

const barClasses: Record<ConfidenceTone, string> = {
  success: 'bg-green-50 border-green-200 text-green-900',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  danger: 'bg-red-50 border-red-200 text-red-900',
};

/** Fixed mobile bar below tab nav, with in-flow spacer so content is not occluded. */
export default function StickyVerdictBar({ headline, tone }: StickyVerdictBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);

  useEffect(() => {
    const node = barRef.current;
    if (!node) return undefined;

    const syncHeight = () => setBarHeight(node.offsetHeight);
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [headline]);

  return (
    <>
      <div
        ref={barRef}
        className={`sm:hidden fixed inset-x-0 z-20 border-b px-4 py-2 shadow-sm ${barClasses[tone]}`}
        style={{ top: `var(${TAB_NAV_HEIGHT_VAR}, 0px)` }}
        role="status"
        aria-live="polite"
      >
        <p className="text-sm font-semibold mb-0 truncate">{headline}</p>
      </div>
      <div
        className="sm:hidden shrink-0"
        style={{ height: barHeight > 0 ? barHeight : undefined }}
        aria-hidden="true"
      />
    </>
  );
}
