import {
  colors,
  plotlyAxisTitleFont,
  plotlyChartTitleFont,
  plotlyLayoutDefaults,
} from '../../lib/theme';
import { chartTitle } from '../../lib/responsiveChartLayout';

/** Drops undefined keys so Plotly doesn't retain stale axes on relayout. */
function omitUndefined(layout: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(layout).filter(([, value]) => value !== undefined),
  );
}

function normalizeTitle(title: unknown) {
  if (typeof title === 'string') {
    return { ...chartTitle(title), font: plotlyChartTitleFont };
  }
  if (title && typeof title === 'object') {
    const titleObj = title as { font?: object };
    return {
      ...chartTitle(''),
      ...(title as object),
      font: { ...plotlyChartTitleFont, ...titleObj.font },
    };
  }
  return undefined;
}

function mergeAxis(
  defaults: Record<string, unknown>,
  override?: Record<string, unknown>,
): Record<string, unknown> {
  if (!override) return { ...defaults };

  const merged = { ...defaults, ...override };

  if (override.title !== undefined) {
    if (typeof override.title === 'string') {
      merged.title = { text: override.title, font: plotlyAxisTitleFont };
    } else if (typeof override.title === 'object') {
      const titleObj = override.title as { font?: object };
      merged.title = {
        ...override.title,
        font: { ...plotlyAxisTitleFont, ...titleObj.font },
      };
    }
  }

  merged.tickfont = {
    ...(defaults.tickfont as object),
    ...(override.tickfont as object),
  };

  return merged;
}

/** Merges per-chart layout with shared Plotly theme defaults. */
export function mergePlotlyLayout(layout: Record<string, unknown>): Record<string, unknown> {
  const clean = omitUndefined(layout);
  const title = normalizeTitle(clean.title);

  const merged: Record<string, unknown> = {
    ...plotlyLayoutDefaults,
    ...clean,
    paper_bgcolor: colors.surface,
    plot_bgcolor: colors.surfaceMuted,
    font: { ...plotlyLayoutDefaults.font, ...(clean.font as object) },
    xaxis: mergeAxis(plotlyLayoutDefaults.xaxis as Record<string, unknown>, clean.xaxis as Record<string, unknown>),
    yaxis: mergeAxis(plotlyLayoutDefaults.yaxis as Record<string, unknown>, clean.yaxis as Record<string, unknown>),
    hoverlabel: {
      ...plotlyLayoutDefaults.hoverlabel,
      ...(clean.hoverlabel as object),
      font: {
        ...plotlyLayoutDefaults.hoverlabel.font,
        ...((clean.hoverlabel as { font?: object })?.font),
      },
    },
  };

  if (title) merged.title = title;

  for (const key of Object.keys(clean)) {
    if (/^[xy]axis\d+$/.test(key)) {
      merged[key] = mergeAxis(
        plotlyLayoutDefaults.xaxis as Record<string, unknown>,
        clean[key] as Record<string, unknown>,
      );
    }
  }

  return merged;
}
