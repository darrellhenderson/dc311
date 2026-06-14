import React, { Suspense, useMemo } from 'react';
import type { Data } from 'plotly.js';
import { mergePlotlyLayout } from './plotlyLayout';

/** Vite 8 may resolve the CJS default to the module wrapper instead of the component. */
async function loadReactPlotly(): Promise<{ default: typeof import('react-plotly.js').default }> {
  const mod = await import('react-plotly.js');
  const candidate = (mod.default ?? mod) as
    | typeof mod.default
    | { default: typeof mod.default };
  const Component =
    typeof candidate === 'object' && candidate !== null && 'default' in candidate
      ? candidate.default
      : candidate;
  return { default: Component };
}

const Plot = React.lazy(loadReactPlotly);

interface PlotlyChartProps {
  data: Data[];
  layout: Record<string, unknown>;
  config?: Record<string, unknown>;
  style?: React.CSSProperties;
  /** Remount only on structural layout changes (e.g. dual → single axis). */
  remountKey?: string;
  /** Dual-axis bar charts need fixed sizing to keep colored bars on drag-resize. */
  preserveTracesOnResize?: boolean;
}


function PlotlyChart({
  data,
  layout,
  config,
  style,
  remountKey,
  preserveTracesOnResize = false,
}: PlotlyChartProps) {
  const plotHeight = typeof layout.height === 'number' ? layout.height : 300;
  const fillWidth = !preserveTracesOnResize;

  const mergedLayout = useMemo(
    () => mergePlotlyLayout({
      ...layout,
      autosize: fillWidth,
      height: plotHeight,
    }),
    [plotHeight, layout, fillWidth],
  );

  const stableData = useMemo(() => data, [data]);

  const defaultConfig = useMemo(
    () => ({
      responsive: fillWidth,
      displayModeBar: false,
      ...config,
    }),
    [config, fillWidth],
  );

  return (
    <div className="w-full min-w-0" style={{ minHeight: plotHeight, ...style }}>
      <Suspense fallback={<div className="h-48 flex items-center justify-center text-sm text-gray-400">Loading chart…</div>}>
        <Plot
          key={remountKey}
          data={stableData}
          layout={mergedLayout}
          config={defaultConfig}
          useResizeHandler
          style={{ width: '100%', height: plotHeight }}
        />
      </Suspense>
    </div>
  );
}

export default PlotlyChart;
