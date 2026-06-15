import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface InfoTipProps {
  /** Visible KPI label for screen readers. */
  label: string;
  /** Short explainer shown in the floating panel. */
  text: string;
}

const TOOLTIP_MARGIN = 6;
const VIEWPORT_PADDING = 8;

/** Positions a fixed tooltip near its trigger without shifting layout. */
function positionTooltip(
  trigger: HTMLElement,
  tooltip: HTMLElement,
): { top: number; left: number } {
  const triggerRect = trigger.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  let top = triggerRect.bottom + TOOLTIP_MARGIN;
  let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;

  left = Math.max(
    VIEWPORT_PADDING,
    Math.min(left, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING),
  );

  if (top + tooltipRect.height > window.innerHeight - VIEWPORT_PADDING) {
    top = triggerRect.top - tooltipRect.height - TOOLTIP_MARGIN;
  }

  top = Math.max(VIEWPORT_PADDING, top);

  return { top, left };
}

/** Compact (i) control with a click-to-toggle floating tooltip. */
export default function InfoTip({ label, text }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }

    const trigger = buttonRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const updatePosition = () => {
      setCoords(positionTooltip(trigger, tooltip));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, text]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (tooltipRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`inline-flex items-center justify-center shrink-0 rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${
          open ? 'text-gray-900' : 'text-text-muted hover:text-gray-900'
        }`}
        style={{ width: 14, height: 14 }}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? `Hide info about ${label}` : `Show info about ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          viewBox="0 0 16 16"
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v4" strokeLinecap="round" />
          <circle cx="8" cy="5.15" r="0.85" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={tooltipRef}
          id={panelId}
          role="tooltip"
          className="fixed z-50 w-52 rounded-md border border-border bg-surface px-2.5 py-2 font-sans text-[0.6875rem] leading-snug text-gray-700 shadow-md"
          style={{
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            visibility: coords ? 'visible' : 'hidden',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
