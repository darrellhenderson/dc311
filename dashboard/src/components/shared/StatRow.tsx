import { KpiTone } from './KPICard';
import InfoTip from './InfoTip';
import { colors } from '../../lib/theme';
import type { ReactNode } from 'react';

export interface StatItem {
  label: string;
  value?: string | number;
  tone?: KpiTone;
  /** Plain-language comparison vs prior month. */
  detail?: string;
  /** Short definition shown via the label (i) control. */
  info?: string;
  /** Optional custom body (e.g. embedded chart). */
  content?: ReactNode;
  /** Optional row between the value and detail (e.g. outcome marker). */
  contentFooter?: ReactNode;
  /** Overrides the default aria-label for the value row. */
  valueAriaLabel?: string;
}

const valueColor: Record<KpiTone, string | undefined> = {
  default: undefined,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

function statLabelId(label: string): string {
  return `stat-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/** Compact metric band — 2×2 on mobile, 4 across on md+. */
export default function StatRow({ stats }: { stats: StatItem[] }) {
  return (
    <div className="font-mono grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden mb-3">
      {stats.map((stat) => {
        const labelId = statLabelId(stat.label);
        return (
          <div key={stat.label} className="bg-surface px-3 py-2.5" role="group" aria-labelledby={labelId}>
            <div id={labelId} className="text-caption text-text-muted mb-0.5 flex items-center gap-1">
              <span>{stat.label}</span>
              {stat.info ? <InfoTip label={stat.label} text={stat.info} /> : null}
            </div>
            {stat.content ? (
              <div className="relative">
                {stat.valueAriaLabel ? (
                  <div aria-label={stat.valueAriaLabel}>{stat.content}</div>
                ) : (
                  stat.content
                )}
                {stat.contentFooter && (
                  <div
                    className="pointer-events-none absolute inset-x-0 top-7 -mt-[5px] overflow-visible"
                    aria-hidden="true"
                  >
                    {stat.contentFooter}
                  </div>
                )}
                {stat.detail && (
                  <p
                    className="text-caption mb-0 mt-1 leading-snug"
                    style={{ color: valueColor[stat.tone ?? 'default'] || colors.textMuted }}
                  >
                    {stat.detail}
                  </p>
                )}
              </div>
            ) : (
              <>
                <p
                  className="text-lg font-semibold mb-0 tabular-nums leading-7"
                  style={{ color: valueColor[stat.tone ?? 'default'] || colors.text }}
                  aria-label={stat.valueAriaLabel ?? `${stat.label}: ${stat.value}`}
                >
                  {stat.value}
                </p>
                {stat.detail && (
                  <p
                    className="text-caption mb-0 mt-1 leading-snug"
                    style={{ color: valueColor[stat.tone ?? 'default'] || colors.textMuted }}
                  >
                    {stat.detail}
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
