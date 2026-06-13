import { ReactNode } from 'react';
import ChartPanel from '../shared/ChartPanel';
import PlotlyChart from '../shared/PlotlyChart';

interface ArticleFigureProps {
  caption: string;
  children?: ReactNode;
  data?: Record<string, unknown>[];
  layout?: Record<string, unknown>;
  remountKey?: string;
  preserveTracesOnResize?: boolean;
  className?: string;
}

export default function ArticleFigure({
  caption,
  children,
  data,
  layout,
  remountKey,
  preserveTracesOnResize,
  className = '',
}: ArticleFigureProps) {
  return (
    <figure className={`article-figure my-3 ${className}`}>
      {children ?? (
        <ChartPanel>
          <PlotlyChart
            data={data!}
            layout={layout!}
            remountKey={remountKey}
            preserveTracesOnResize={preserveTracesOnResize}
          />
        </ChartPanel>
      )}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
