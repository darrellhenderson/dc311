/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

declare module 'react-plotly.js' {
  import { Component } from 'react';
  interface PlotParams {
    data: object[];
    layout?: object;
    config?: object;
    useResizeHandler?: boolean;
    style?: React.CSSProperties;
  }
  export default class Plot extends Component<PlotParams> {}
}
