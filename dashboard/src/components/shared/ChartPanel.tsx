import { ReactNode } from 'react';

interface ChartPanelProps {
  children: ReactNode;
  className?: string;
}

/** Consistent chart container surface — mono for all chart-adjacent data UI. */
export default function ChartPanel({ children, className = '' }: ChartPanelProps) {
  return (
    <div className={`font-mono w-full bg-surface rounded-lg shadow-sm p-4 border border-border ${className}`}>
      {children}
    </div>
  );
}
