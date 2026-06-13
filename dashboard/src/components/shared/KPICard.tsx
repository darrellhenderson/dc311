import { colors } from '../../lib/theme';

export type KpiTone = 'default' | 'success' | 'warning' | 'danger';

interface KPICardProps {
  label: string;
  value: string | number;
  tone?: KpiTone;
}

const borderByTone: Record<KpiTone, string> = {
  default: colors.primary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

const textByTone: Record<KpiTone, string | undefined> = {
  default: undefined,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

export default function KPICard({ label, value, tone = 'default' }: KPICardProps) {
  const valueColor = textByTone[tone];

  return (
    <div
      className="font-mono bg-surface rounded-lg shadow-sm p-4 border border-border"
      style={{ borderTopWidth: 4, borderTopColor: borderByTone[tone] }}
    >
      <p className="text-caption text-text-muted mb-1">{label}</p>
      <h3
        className="text-3xl font-bold mb-0 tracking-tight"
        style={{ color: valueColor || colors.text }}
      >
        {value}
      </h3>
    </div>
  );
}
