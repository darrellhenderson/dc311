import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { trackEstimateWardGuideShown } from '../../lib/analytics';

export const WARD_GUIDE_MESSAGE =
  'Add your ward above for a more accurate estimate — and to see what else is slow near you.';

const FADE_IN_MS = 200;
const VISIBLE_MS = 2500;
const FADE_OUT_MS = 350;
const VIEWPORT_PADDING = 12;
const GAP = 10;
const ARROW = 6;
const MAX_WIDTH = 260;

interface WardGuideCalloutProps {
  show: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onDismiss?: () => void;
}

interface GuidePosition {
  top: number;
  left: number;
  width: number;
  placement: 'above' | 'below';
  arrowLeft: number;
}

function computeGuidePosition(
  anchor: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
): GuidePosition {
  const width = Math.min(popoverWidth, window.innerWidth - VIEWPORT_PADDING * 2);
  const anchorCenter = anchor.left + anchor.width / 2;

  let left = anchorCenter - width / 2;
  left = Math.max(
    VIEWPORT_PADDING,
    Math.min(left, window.innerWidth - width - VIEWPORT_PADDING),
  );

  const aboveTop = anchor.top - popoverHeight - GAP - ARROW;
  const placement: GuidePosition['placement'] = aboveTop >= VIEWPORT_PADDING
    ? 'above'
    : 'below';
  const top = placement === 'above'
    ? aboveTop
    : anchor.bottom + GAP + ARROW;

  const arrowLeft = Math.max(16, Math.min(anchorCenter - left, width - 16));

  return { top, left, width, placement, arrowLeft };
}

/** Portals a ward-selection hint above the dropdown; avoids overflow clipping. */
export default function WardGuideCallout({
  show,
  anchorRef,
  onDismiss,
}: WardGuideCalloutProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [render, setRender] = useState(false);
  const [position, setPosition] = useState<GuidePosition | null>(null);
  const [opacity, setOpacity] = useState(0);

  const syncPosition = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;

    const popoverWidth = Math.min(MAX_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2);
    const popoverHeight = popover.offsetHeight;
    if (popoverHeight <= 0) return;

    setPosition(computeGuidePosition(
      anchor.getBoundingClientRect(),
      popoverWidth,
      popoverHeight,
    ));
  }, [anchorRef]);

  useEffect(() => {
    if (!show) {
      setRender(false);
      setOpacity(0);
      setPosition(null);
      return undefined;
    }

    trackEstimateWardGuideShown();
    setRender(true);
    setOpacity(0);
    setPosition(null);

    return undefined;
  }, [show]);

  useEffect(() => {
    if (!render || !position) return undefined;

    const fadeInTimer = window.setTimeout(() => setOpacity(1), FADE_IN_MS);
    const fadeOutTimer = window.setTimeout(() => setOpacity(0), FADE_IN_MS + VISIBLE_MS);
    const dismissTimer = window.setTimeout(() => {
      setRender(false);
      onDismiss?.();
    }, FADE_IN_MS + VISIBLE_MS + FADE_OUT_MS);

    return () => {
      window.clearTimeout(fadeInTimer);
      window.clearTimeout(fadeOutTimer);
      window.clearTimeout(dismissTimer);
    };
  }, [render, position, onDismiss]);

  useLayoutEffect(() => {
    if (!render) return undefined;

    syncPosition();
    const raf = window.requestAnimationFrame(syncPosition);

    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [render, syncPosition]);

  if (!render) return null;

  const arrowClass = position?.placement === 'above'
    ? 'top-full -mt-px border-r border-b'
    : 'bottom-full -mb-px border-l border-t';

  return createPortal(
    <div
      ref={popoverRef}
      id="estimate-ward-guide"
      role="status"
      className="fixed z-50 pointer-events-none transition-opacity ease-out"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? VIEWPORT_PADDING,
        width: position?.width ?? MAX_WIDTH,
        opacity: position ? opacity : 0,
        visibility: position ? 'visible' : 'hidden',
        transitionDuration: `${FADE_OUT_MS}ms`,
      }}
    >
      <div className="relative px-3 py-2.5 rounded-lg border border-blue-200 bg-blue-50 text-sm text-blue-900 shadow-lg">
        <p className="mb-0 leading-snug">{WARD_GUIDE_MESSAGE}</p>
        <span
          className={`absolute h-2.5 w-2.5 rotate-45 border-blue-200 bg-blue-50 ${arrowClass}`}
          style={{ left: position?.arrowLeft ?? '50%' }}
          aria-hidden="true"
        />
      </div>
    </div>,
    document.body,
  );
}
