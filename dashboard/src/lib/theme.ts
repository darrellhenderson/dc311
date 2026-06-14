/** Shared design tokens for UI (Tailwind) and Plotly charts. */

export const fonts = {
  sans: 'Inter, Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const colors = {
  primary: '#171717',
  primaryDeep: '#0a0a0a',
  surface: '#ffffff',
  surfaceMuted: '#f3f4f6',
  border: '#e5e7eb',
  text: '#111827',
  textMuted: '#6b7280',
  success: '#2ecc71',
  warning: '#e67e22',
  danger: '#e74c3c',
  /** Mid-dark red for SLA legend swatches (between danger and primaryDeep). */
  dangerDeep: '#7b1e1e',
} as const;

/** Categorical series colors aligned with the dashboard palette. */
export const CATEGORICAL_COLORS = [
  '#3b6ea5', '#d4883c', '#3d9e5f', '#c44e52', '#7b68a6',
  '#8c6b5a', '#c75b9b', '#6b7280', '#9ca33b', '#2ba8b8',
  '#8eb8d8', '#e8b87a', '#7bc99a', '#e89a9a', '#b8a8cc',
] as const;

export const plotlyChartTitleFont = { family: fonts.mono, size: 12, color: colors.textMuted } as const;
export const plotlyAxisTitleFont = { family: fonts.mono, size: 11, color: colors.textMuted } as const;
export const plotlyAxisTickFont = { family: fonts.mono, size: 11, color: colors.textMuted } as const;

export const plotlyLayoutDefaults = {
  paper_bgcolor: colors.surface,
  plot_bgcolor: colors.surfaceMuted,
  font: { family: fonts.mono, size: 13, color: colors.text },
  margin: { t: 50, b: 40, l: 40, r: 20 },
  xaxis: {
    gridcolor: colors.border,
    linecolor: colors.border,
    tickfont: plotlyAxisTickFont,
  },
  yaxis: {
    gridcolor: colors.border,
    linecolor: colors.border,
    tickfont: plotlyAxisTickFont,
  },
  hoverlabel: {
    bgcolor: colors.surface,
    bordercolor: colors.border,
    font: { family: fonts.mono, size: 12, color: colors.text },
  },
} as const;
