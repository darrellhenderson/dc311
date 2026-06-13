import { KpiTone } from './KPICard';
import { colors } from '../../lib/theme';

export interface MetricItem {
  label: string;
  value: string | number;
  tone?: KpiTone;
  color?: string;
  title?: string;
}

const valueColor: Record<KpiTone, string | undefined> = {
  default: undefined,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

/** Vertical metric band — StatRow typography, horizontal rules, no outer frame. */
export default function MetricStack({ items }: { items: MetricItem[] }) {
  return (
    <div className="font-mono flex flex-col">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`py-3 ${i > 0 ? 'border-t border-border' : ''}`}
        >
          <p className="text-caption text-text-muted mb-1" title={item.title}>{item.label}</p>
          <p
            className="text-lg font-semibold mb-0 tabular-nums"
            style={{ color: item.color ?? (valueColor[item.tone ?? 'default'] || colors.text) }}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}
