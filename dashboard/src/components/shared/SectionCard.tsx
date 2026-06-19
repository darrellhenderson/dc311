import { ReactNode, useState } from 'react';
import { trackSectionToggle, type SectionToggleTab } from '../../lib/analytics';

interface SectionCardProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  /** Stable slug for section_toggle analytics (requires analyticsTab). */
  sectionId?: string;
  /** Tab context for section_toggle analytics (requires sectionId). */
  analyticsTab?: SectionToggleTab;
  /** Force monospace for data-heavy section bodies (tables, etc.). */
  variant?: 'default' | 'mono';
  children: ReactNode;
}

export default function SectionCard({
  title,
  subtitle,
  defaultOpen = false,
  sectionId,
  analyticsTab,
  variant = 'default',
  children,
}: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyClass = variant === 'mono' ? 'font-mono' : '';

  const handleToggle = () => {
    setOpen((current) => {
      const next = !current;
      if (analyticsTab && sectionId) {
        trackSectionToggle(analyticsTab, sectionId, next);
      }
      return next;
    });
  };

  return (
    <section className="bg-surface border border-border rounded-lg mb-2">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 min-h-[44px] text-left hover:bg-surface-muted/50 rounded-lg transition-colors"
        aria-expanded={open}
      >
        <div>
          <h3 className="text-body font-semibold text-gray-900 mb-0">{title}</h3>
          {subtitle && <p className="text-caption text-text-muted mb-0 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-text-muted text-sm shrink-0 ml-4" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className={`${bodyClass} px-4 pb-3 border-t border-border pt-2.5`}>{children}</div>}
    </section>
  );
}
