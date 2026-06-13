export type StatusTone = 'success' | 'warning' | 'danger';

interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
}

const toneClasses: Record<StatusTone, string> = {
  success: 'bg-green-50 text-green-800 border-green-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
};

export default function StatusBadge({ label, tone }: StatusBadgeProps) {
  return (
    <span className={`font-mono inline-block text-caption font-medium px-2 py-0.5 rounded-full border ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}

/** Maps SLA % met to badge label and tone. */
export function slaMetBadge(pctMet: number): { label: string; tone: StatusTone } {
  if (pctMet >= 99) return { label: `${pctMet}% Met`, tone: 'success' };
  if (pctMet >= 95) return { label: `${pctMet}% At risk`, tone: 'warning' };
  return { label: `${pctMet}% Below`, tone: 'danger' };
}
