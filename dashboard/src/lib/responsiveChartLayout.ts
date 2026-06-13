/** Responsive Plotly layout helpers — mobile reflow, not shrink. */

export const MOBILE_MAX_BAR_HEIGHT = 400;
export const MOBILE_MAP_HEIGHT = 320;
export const DESKTOP_MAP_HEIGHT = 520;

export function capChartHeight(computed: number, isMobile: boolean, mobileMax = MOBILE_MAX_BAR_HEIGHT): number {
  return isMobile ? Math.min(computed, mobileMax) : computed;
}

export function mapHeight(isMobile: boolean, desktopHeight = DESKTOP_MAP_HEIGHT): number {
  return isMobile ? MOBILE_MAP_HEIGHT : desktopHeight;
}

/** Map plot height when filling a section card (no chart chrome). */
export function mapSectionHeight(isMobile: boolean): number {
  return isMobile ? 360 : 500;
}

/** Top-left title — avoids center/overlap with legends. */
export function chartTitle(text: string) {
  return {
    text,
    x: 0,
    xanchor: 'left' as const,
    y: 1,
    yanchor: 'top' as const,
    pad: { t: 4, b: 6 },
  };
}

/** Horizontal legend tucked below the plot area. */
export function legendBelow(isMobile = false, y = -0.18) {
  return {
    orientation: 'h' as const,
    x: 0,
    xanchor: 'left' as const,
    y: isMobile ? -0.24 : y,
    yanchor: 'top' as const,
    bgcolor: 'rgba(255,255,255,0.92)',
    tracegroupgap: 6,
  };
}

export function hBarMargin(isMobile: boolean, desktopLeft = 220): { t: number; b: number; l: number; r: number } {
  return isMobile
    ? { t: 56, b: 76, l: 100, r: 20 }
    : { t: 56, b: 68, l: desktopLeft, r: 24 };
}

export function legendAbovePlot() {
  return {
    orientation: 'h' as const,
    x: 0,
    xanchor: 'left' as const,
    y: 1,
    yanchor: 'bottom' as const,
    bgcolor: 'rgba(255,255,255,0.92)',
    tracegroupgap: 6,
  };
}

export function legendInsideBottom() {
  return {
    orientation: 'h' as const,
    x: 0,
    xanchor: 'left' as const,
    y: 0,
    yanchor: 'bottom' as const,
    bgcolor: 'rgba(255,255,255,0.92)',
    tracegroupgap: 6,
  };
}


export function mapMargin(isMobile: boolean) {
  return { t: 8, b: isMobile ? 60 : 52, l: 0, r: 0 };
}

/** Map legends sit below the map, never over the tiles. */
export function mapLegend(isMobile: boolean) {
  return {
    orientation: 'h' as const,
    x: 0,
    xanchor: 'left' as const,
    y: isMobile ? -0.14 : -0.1,
    yanchor: 'top' as const,
    bgcolor: 'rgba(255,255,255,0.92)',
    font: { size: isMobile ? 9 : 10 },
    tracegroupgap: 4,
  };
}

export function serviceTypeChartMargin(isMobile: boolean) {
  return isMobile
    ? { t: 56, b: 76, l: 120, r: 20 }
    : { t: 56, b: 68, l: 220, r: 24 };
}

export function serviceTypeLegend(isMobile: boolean) {
  return legendBelow(isMobile, -0.2);
}

export function stackedBarMargin(isMobile: boolean) {
  return { t: 56, b: isMobile ? 84 : 72, l: isMobile ? 48 : 56, r: 20 };
}

export function pieMargin() {
  return { t: 48, b: 24, l: 16, r: 16 };
}
