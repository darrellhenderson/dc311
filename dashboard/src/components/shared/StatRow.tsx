import { KpiTone } from './KPICard';
import { colors } from '../../lib/theme';

export interface StatItem {
  label: string;
  value: string | number;
  tone?: KpiTone;
}

const valueColor: Record<KpiTone, string | undefined> = {
  default: undefined,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

/** Compact metric band — 2×2 on mobile, 4 across on md+. */
export default function StatRow({ stats }: { stats: StatItem[] }) {
  return (
    <div className="font-mono grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden mb-3">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-surface px-3 py-2.5">
          <p className="text-caption text-text-muted mb-0.5">{stat.label}</p>
          <p
            className="text-lg font-semibold mb-0 tabular-nums"
            style={{ color: valueColor[stat.tone ?? 'default'] || colors.text }}
          >
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
