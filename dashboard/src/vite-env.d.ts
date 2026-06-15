/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

declare module 'react-plotly.js' {
  import { Component } from 'react';
  import type { PlotMouseEvent } from 'plotly.js';
  interface PlotParams {
    data: object[];
    layout?: object;
    config?: object;
    useResizeHandler?: boolean;
    style?: React.CSSProperties;
    onHover?: (event: Readonly<PlotMouseEvent>) => void;
    onUnhover?: (event: Readonly<PlotMouseEvent>) => void;
  }
  export default class Plot extends Component<PlotParams> {}
}
