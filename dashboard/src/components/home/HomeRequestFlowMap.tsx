import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProcessedRequest } from '../../lib/dataProcessing';
import { SavedLocation } from '../../lib/homePreferences';
import { resolveRequestFlowMapView } from '../../lib/requestFlowMapStyle';
import {
  playheadFromHourIndex,
  hourIndexFromPlayhead,
  RequestFlowTimeline,
  RequestFlowTimelineResult,
  requestFlowHudAt,
  resolveMarkerUpdateScope,
  collectRequestFlowWiggleDots,
  advanceRequestFlowOverlaySessions,
  createRequestFlowOverlaySessions,
  resetRequestFlowOverlaySessions,
  markerColorAtPlayhead,
  markerSizeAt,
  SIM_MS_PER_REAL_MS,
  updateRequestFlowMarkers,
  syncRequestFlowVisibleIndex,
  advanceChunkedMarkerSync,
  REQUEST_FLOW_CHUNKED_SYNC_SIZE,
  type ChunkedMarkerSyncState,
  type RequestFlowOverlaySessions,
} from '../../lib/homeRequestFlowMap';
import { createRequestFlowMarkerBuffers, type RequestFlowMarkerBuffers } from '../../lib/requestFlowMapLayers';
import RequestFlowTimelineWorker from '../../workers/requestFlowTimeline.worker?worker';
import { useIsMobile } from '../../hooks/useBreakpoint';
import RequestFlowPlot, { RequestFlowPlotHandle } from './RequestFlowPlot';
import RequestFlowShapeSwatch from './RequestFlowShapeSwatch';
import type { RequestFlowWiggleDot } from '../../lib/homeRequestFlowMap';
import {
  categoryShapeIcon,
  REQUEST_FLOW_DEADLINE_LEGEND_GLYPH,
  REQUEST_FLOW_LEGEND_CATEGORIES,
  REQUEST_FLOW_SHAPE_LEGEND_COLOR,
  requestFlowSpriteIndex,
} from '../../lib/requestFlowCategoryShapes';
import { colors } from '../../lib/theme';

const REQUEST_FLOW_ON_TIME_COLOR = REQUEST_FLOW_SHAPE_LEGEND_COLOR;
const REQUEST_FLOW_PAST_DUE_COLOR = colors.warning;

const DESKTOP_FRAME_INTERVAL_MS = 1000 / 30;
const MOBILE_FRAME_INTERVAL_MS = 1000 / 20;
const HUD_INTERVAL_MS = 100;
const INITIAL_YEAR_PROGRESS = 0.25;
/** Full marker syncs above this count are spread across frames. */
const CHUNKED_MARKER_SYNC_MIN = REQUEST_FLOW_CHUNKED_SYNC_SIZE;

function computeRequestFlowMapHeight(isMobile: boolean): number {
  if (typeof window === 'undefined') return 520;
  return isMobile ? 420 : Math.min(Math.round(window.innerHeight * 0.72), 720);
}

function getFullscreenElement(): Element | null {
  return document.fullscreenElement
    ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
    ?? null;
}

async function enterFullscreen(element: HTMLElement): Promise<void> {
  if (element.requestFullscreen) {
    await element.requestFullscreen();
    return;
  }
  const webkit = element as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  if (webkit.webkitRequestFullscreen) {
    await webkit.webkitRequestFullscreen();
  }
}

async function leaveFullscreen(): Promise<void> {
  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  const webkit = document as Document & { webkitExitFullscreen?: () => Promise<void> };
  if (webkit.webkitExitFullscreen) {
    await webkit.webkitExitFullscreen();
  }
}

interface RequestFlowHudRefs {
  labelEl: HTMLParagraphElement | null;
  liveEl: HTMLSpanElement | null;
  progressEl: HTMLDivElement | null;
  scrubberEl: HTMLInputElement | null;
  playButtonEl: HTMLButtonElement | null;
  compactOpenEl: HTMLSpanElement | null;
  compactFiledEl: HTMLSpanElement | null;
  compactResolvedEl: HTMLSpanElement | null;
  expandedOpenEl: HTMLSpanElement | null;
  expandedFiledEl: HTMLSpanElement | null;
  expandedResolvedEl: HTMLSpanElement | null;
}

function applyPositiveStatTone(
  element: HTMLSpanElement | null,
  value: number,
  positiveClass: string,
  baseClass: string,
) {
  if (!element) return;
  element.className = `${baseClass} ${value > 0 ? positiveClass : 'request-flow-map-hud__stat-value--idle'}`;
}

/** Writes HUD numbers directly so playback does not re-render the overlay. */
function updateRequestFlowHudDom(
  refs: RequestFlowHudRefs,
  timeline: RequestFlowTimeline,
  playheadMs: number,
  playing: boolean,
  minimized: boolean,
) {
  const hud = requestFlowHudAt(timeline, playheadMs);
  if (refs.labelEl) refs.labelEl.textContent = hud.label;
  if (refs.liveEl) refs.liveEl.classList.toggle('opacity-0', !playing);

  const progressPct = timeline.endMs > timeline.startMs
    ? ((playheadMs - timeline.startMs) / (timeline.endMs - timeline.startMs)) * 100
    : 100;
  if (refs.progressEl) refs.progressEl.style.width = `${progressPct}%`;
  if (refs.scrubberEl) refs.scrubberEl.value = String(hud.hourIndex);

  const atEnd = playheadMs >= timeline.endMs;
  if (refs.playButtonEl) {
    const ariaLabel = playing
      ? 'Pause animation'
      : atEnd
        ? 'Replay animation'
        : 'Play animation';
    refs.playButtonEl.setAttribute('aria-label', ariaLabel);
  }

  if (minimized) {
    if (refs.compactOpenEl) refs.compactOpenEl.textContent = hud.openCount.toLocaleString();
    if (refs.compactFiledEl) refs.compactFiledEl.textContent = `+${hud.filedCount.toLocaleString()}`;
    if (refs.compactResolvedEl) refs.compactResolvedEl.textContent = `−${hud.resolvedCount.toLocaleString()}`;
    applyPositiveStatTone(
      refs.compactFiledEl,
      hud.filedCount,
      'request-flow-map-hud__stat-compact-value--filed',
      'request-flow-map-hud__stat-compact-value',
    );
    applyPositiveStatTone(
      refs.compactResolvedEl,
      hud.resolvedCount,
      'request-flow-map-hud__stat-compact-value--resolved',
      'request-flow-map-hud__stat-compact-value',
    );
    return;
  }

  if (refs.expandedOpenEl) refs.expandedOpenEl.textContent = hud.openCount.toLocaleString();
  if (refs.expandedFiledEl) refs.expandedFiledEl.textContent = `+${hud.filedCount.toLocaleString()}`;
  if (refs.expandedResolvedEl) refs.expandedResolvedEl.textContent = `−${hud.resolvedCount.toLocaleString()}`;
  applyPositiveStatTone(
    refs.expandedFiledEl,
    hud.filedCount,
    'request-flow-map-hud__stat-value--filed',
    'request-flow-map-hud__stat-value',
  );
  applyPositiveStatTone(
    refs.expandedResolvedEl,
    hud.resolvedCount,
    'request-flow-map-hud__stat-value--resolved',
    'request-flow-map-hud__stat-value',
  );
}

interface HomeRequestFlowMapProps {
  rows: ProcessedRequest[];
  /** Pauses playback when the Home tab is hidden but still mounted. */
  isActive?: boolean;
  savedLocation?: SavedLocation | null;
}

function cancelChunkedSyncRaf(ref: React.MutableRefObject<number>) {
  if (!ref.current) return;
  cancelAnimationFrame(ref.current);
  ref.current = 0;
}

function RequestFlowHudDotLegend({ variant }: { variant: 'collapsed-dots' | 'collapsed-keys' | 'expanded' }) {
  if (variant === 'collapsed-dots') {
    return (
      <span
        className="inline-flex items-center gap-1.5 shrink-0"
        aria-label="On time and past deadline"
      >
        <RequestFlowShapeSwatch shapeIcon={REQUEST_FLOW_DEADLINE_LEGEND_GLYPH} color={REQUEST_FLOW_ON_TIME_COLOR} />
        <RequestFlowShapeSwatch shapeIcon={REQUEST_FLOW_DEADLINE_LEGEND_GLYPH} color={REQUEST_FLOW_PAST_DUE_COLOR} />
      </span>
    );
  }

  if (variant === 'collapsed-keys') {
    return (
      <div
        className="request-flow-map-hud__legend-keys"
        role="list"
        aria-label="Category glyph key"
      >
        {REQUEST_FLOW_LEGEND_CATEGORIES.map((category) => (
          <span
            key={category}
            role="listitem"
            title={category}
            className="request-flow-map-hud__legend-key"
          >
            <RequestFlowShapeSwatch shapeIcon={categoryShapeIcon(category)} size={11} />
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="request-flow-map-hud__legend">
      <section className="request-flow-map-hud__legend-section">
        <h3 className="request-flow-map-hud__legend-heading">Deadline</h3>
        <ul className="request-flow-map-hud__legend-list">
          <li className="request-flow-map-hud__legend-row">
            <RequestFlowShapeSwatch shapeIcon={REQUEST_FLOW_DEADLINE_LEGEND_GLYPH} color={REQUEST_FLOW_ON_TIME_COLOR} />
            <span>On time</span>
          </li>
          <li className="request-flow-map-hud__legend-row">
            <RequestFlowShapeSwatch shapeIcon={REQUEST_FLOW_DEADLINE_LEGEND_GLYPH} color={REQUEST_FLOW_PAST_DUE_COLOR} />
            <span>Past deadline</span>
          </li>
        </ul>
      </section>
      <section className="request-flow-map-hud__legend-section">
        <h3 className="request-flow-map-hud__legend-heading">Category</h3>
        <ul className="request-flow-map-hud__legend-grid request-flow-map-hud__legend-grid--names">
          {REQUEST_FLOW_LEGEND_CATEGORIES.map((category) => (
            <li key={category} className="request-flow-map-hud__legend-row">
              <span className="request-flow-map-hud__legend-key-inline" aria-hidden="true">
                {categoryShapeIcon(category)}
              </span>
              <span className="truncate" title={category}>{category}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RequestFlowHudMediaButtons({
  playButtonRef,
  playing,
  isFullscreen,
  onPlayToggle,
  onFullscreenToggle,
}: {
  playButtonRef: React.RefObject<HTMLButtonElement>;
  playing: boolean;
  isFullscreen: boolean;
  onPlayToggle: () => void;
  onFullscreenToggle: () => void;
}) {
  return (
    <div className="request-flow-map-hud__media flex items-center gap-1 shrink-0">
      <button
        ref={playButtonRef}
        type="button"
        onClick={onPlayToggle}
        className="request-flow-map-play request-flow-map-hud__media-btn flex items-center justify-center h-7 w-7 rounded-full text-gray-700 hover:text-gray-900 transition-colors"
      >
        {playing ? (
          <span className="flex gap-[3px]" aria-hidden="true">
            <span className="block w-[3px] h-2.5 bg-current rounded-full" />
            <span className="block w-[3px] h-2.5 bg-current rounded-full" />
          </span>
        ) : (
          <span className="block w-0 h-0 border-y-[5px] border-y-transparent border-l-[7px] border-l-current ml-0.5" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
        onClick={onFullscreenToggle}
        className="request-flow-map-fullscreen request-flow-map-hud__media-btn flex items-center justify-center h-7 w-7 rounded-full text-gray-700 hover:text-gray-900 transition-colors"
      >
        {isFullscreen ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 6.5v4h-4M2.5 9.5v-4h4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.5 6.5v-4h4M13.5 9.5v4h-4M9.5 2.5h4v4M2.5 9.5h4v4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

function RequestFlowHudHeader({
  labelRef,
  liveRef,
  playButtonRef,
  playing,
  isFullscreen,
  minimized,
  onToggle,
  onPlayToggle,
  onFullscreenToggle,
}: {
  labelRef: React.RefObject<HTMLParagraphElement>;
  liveRef: React.RefObject<HTMLSpanElement>;
  playButtonRef: React.RefObject<HTMLButtonElement>;
  playing: boolean;
  isFullscreen: boolean;
  minimized: boolean;
  onToggle: () => void;
  onPlayToggle: () => void;
  onFullscreenToggle: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 min-h-5 ${minimized ? 'mb-1' : 'mb-1.5'}`}>
      <span
        ref={liveRef}
        className={`request-flow-map-live ${playing ? '' : 'opacity-0'}`}
        aria-hidden="true"
      />
      <p
        ref={labelRef}
        className={`${
          minimized ? 'text-[11px]' : 'text-[11px]'
        } font-mono font-medium text-gray-900 mb-0 tabular-nums tracking-tight whitespace-nowrap min-w-0 flex-1 truncate`}
      />
      {minimized && <RequestFlowHudDotLegend variant="collapsed-dots" />}
      <RequestFlowHudMediaButtons
        playButtonRef={playButtonRef}
        playing={playing}
        isFullscreen={isFullscreen}
        onPlayToggle={onPlayToggle}
        onFullscreenToggle={onFullscreenToggle}
      />
      <button
        type="button"
        aria-label={minimized ? 'Expand stats panel' : 'Collapse stats panel'}
        onClick={onToggle}
        className={`request-flow-map-hud__toggle ${minimized ? 'ml-0.5' : '-mr-1 -mt-0.5'}`}
      >
        {minimized ? (
          <span className="block w-2 h-2 border-t-2 border-r-2 border-current rotate-[225deg] translate-y-0.5" aria-hidden="true" />
        ) : (
          <span className="block w-2 h-2 border-b-2 border-r-2 border-current rotate-45 translate-y-[-2px]" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

function RequestFlowHudStats({
  compact = false,
  compactOpenRef,
  compactFiledRef,
  compactResolvedRef,
  expandedOpenRef,
  expandedFiledRef,
  expandedResolvedRef,
}: {
  compact?: boolean;
  compactOpenRef: React.RefObject<HTMLSpanElement>;
  compactFiledRef: React.RefObject<HTMLSpanElement>;
  compactResolvedRef: React.RefObject<HTMLSpanElement>;
  expandedOpenRef: React.RefObject<HTMLSpanElement>;
  expandedFiledRef: React.RefObject<HTMLSpanElement>;
  expandedResolvedRef: React.RefObject<HTMLSpanElement>;
}) {
  if (compact) {
    return (
      <div className="request-flow-map-hud__stats request-flow-map-hud__stats--compact">
        <span className="request-flow-map-hud__stat-compact">
          <span className="request-flow-map-hud__stat-compact-label">Open</span>
          <span ref={compactOpenRef} className="request-flow-map-hud__stat-compact-value" />
        </span>
        <span className="request-flow-map-hud__stat-compact">
          <span className="request-flow-map-hud__stat-compact-label">Filed</span>
          <span ref={compactFiledRef} className="request-flow-map-hud__stat-compact-value request-flow-map-hud__stat-compact-value--filed" />
        </span>
        <span className="request-flow-map-hud__stat-compact">
          <span className="request-flow-map-hud__stat-compact-label">Resolved</span>
          <span ref={compactResolvedRef} className="request-flow-map-hud__stat-compact-value request-flow-map-hud__stat-compact-value--resolved" />
        </span>
      </div>
    );
  }

  return (
    <div className="request-flow-map-hud__stats">
      <div className="request-flow-map-hud__stat-labels">
        <span>Open</span>
        <span>Filed 24h</span>
        <span>Resolved 24h</span>
      </div>
      <div className="request-flow-map-hud__stat-values">
        <span ref={expandedOpenRef} className="request-flow-map-hud__stat-value" />
        <span ref={expandedFiledRef} className="request-flow-map-hud__stat-value request-flow-map-hud__stat-value--filed" />
        <span ref={expandedResolvedRef} className="request-flow-map-hud__stat-value request-flow-map-hud__stat-value--resolved" />
      </div>
    </div>
  );
}

export default function HomeRequestFlowMap({
  rows,
  isActive = true,
  savedLocation = null,
}: HomeRequestFlowMapProps) {
  const isMobile = useIsMobile();
  const mapView = useMemo(
    () => resolveRequestFlowMapView(savedLocation, isMobile),
    [savedLocation, isMobile],
  );
  const baseFrameIntervalMs = isMobile ? MOBILE_FRAME_INTERVAL_MS : DESKTOP_FRAME_INTERVAL_MS;
  const [mapHeight, setMapHeight] = useState(() => computeRequestFlowMapHeight(isMobile));

  useEffect(() => {
    setMapHeight(computeRequestFlowMapHeight(isMobile));
    const onResize = () => setMapHeight(computeRequestFlowMapHeight(isMobile));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isMobile]);

  const [prepared, setPrepared] = useState<RequestFlowTimelineResult | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [hudMinimized, setHudMinimized] = useState(true);
  const [touchScrubVisible, setTouchScrubVisible] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenHeight, setFullscreenHeight] = useState(0);
  const plotRef = useRef<RequestFlowPlotHandle | null>(null);
  const markerBuffersRef = useRef<RequestFlowMarkerBuffers | null>(null);
  const culledRef = useRef<Uint8Array | null>(null);
  const overlaySessionsRef = useRef<RequestFlowOverlaySessions | null>(null);
  const lastPaintPlayheadRef = useRef(0);
  const lastOverlayIndicesRef = useRef<Set<number>>(new Set());
  const timelineRef = useRef<RequestFlowTimeline | null>(null);
  const playingRef = useRef(playing);
  const hudMinimizedRef = useRef(hudMinimized);
  const scrubbingRef = useRef(false);
  const mapInteractionDepthRef = useRef(0);
  const resumePlaybackRef = useRef(false);
  const resumeAfterInactiveRef = useRef(true);
  const suspendRestylesRef = useRef(false);
  const forceFullMarkerUpdateRef = useRef(true);
  const chunkedSyncRef = useRef<ChunkedMarkerSyncState | null>(null);
  const chunkedSyncRafRef = useRef(0);
  const wiggleOverlayIndicesRef = useRef<Set<number>>(new Set());
  const wiggleHandoffRef = useRef<Map<number, RequestFlowWiggleDot>>(new Map());
  const wiggleHandoffListRef = useRef<RequestFlowWiggleDot[]>([]);
  const hudLabelRef = useRef<HTMLParagraphElement>(null);
  const hudLiveRef = useRef<HTMLSpanElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLInputElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const compactOpenRef = useRef<HTMLSpanElement>(null);
  const compactFiledRef = useRef<HTMLSpanElement>(null);
  const compactResolvedRef = useRef<HTMLSpanElement>(null);
  const expandedOpenRef = useRef<HTMLSpanElement>(null);
  const expandedFiledRef = useRef<HTMLSpanElement>(null);
  const expandedResolvedRef = useRef<HTMLSpanElement>(null);
  playingRef.current = playing;
  hudMinimizedRef.current = hudMinimized;

  const getHudRefs = useCallback((): RequestFlowHudRefs => ({
    labelEl: hudLabelRef.current,
    liveEl: hudLiveRef.current,
    progressEl: progressRef.current,
    scrubberEl: scrubberRef.current,
    playButtonEl: playButtonRef.current,
    compactOpenEl: compactOpenRef.current,
    compactFiledEl: compactFiledRef.current,
    compactResolvedEl: compactResolvedRef.current,
    expandedOpenEl: expandedOpenRef.current,
    expandedFiledEl: expandedFiledRef.current,
    expandedResolvedEl: expandedResolvedRef.current,
  }), []);

  const paintPlayhead = useCallback((
    playheadMs: number,
    updateHud: boolean,
    pulseNowMs: number = performance.now(),
  ) => {
    const timeline = timelineRef.current;
    const buffers = markerBuffersRef.current;
    if (!timeline || !buffers) return;

    const previousPlayheadMs = lastPaintPlayheadRef.current;
    if (playheadMs < previousPlayheadMs) {
      culledRef.current?.fill(0);
      if (overlaySessionsRef.current) {
        resetRequestFlowOverlaySessions(overlaySessionsRef.current);
      }
    }

    const updateScope = resolveMarkerUpdateScope(
      previousPlayheadMs,
      playheadMs,
      forceFullMarkerUpdateRef.current,
    );
    forceFullMarkerUpdateRef.current = false;

    let visualsChanged = false;
    const pulseClock = {
      phaseMs: pulseNowMs,
      playing: playingRef.current && !scrubbingRef.current,
      previousPlayheadMs,
      overlaySessions: overlaySessionsRef.current ?? undefined,
    };

    const runChunkedSync = (): boolean => {
      if (!chunkedSyncRef.current) {
        chunkedSyncRef.current = { cursor: 0, playheadMs, pulseClock };
      }
      const state = chunkedSyncRef.current;
      const result = advanceChunkedMarkerSync(
        timeline,
        state,
        buffers,
        culledRef.current ?? undefined,
      );
      if (result.done) {
        chunkedSyncRef.current = null;
        if (playheadMs !== state.playheadMs) {
          const catchUp = updateRequestFlowMarkers(
            timeline,
            playheadMs,
            buffers.sizes,
            buffers.colors,
            buffers.opacities,
            buffers.customdata,
            culledRef.current ?? undefined,
            pulseClock,
            playheadMs < state.playheadMs ? 'all' : 'active',
            state.playheadMs,
            buffers,
          );
          return result.visualsChanged || catchUp.visualsChanged;
        }
      }
      return result.visualsChanged;
    };

    if (chunkedSyncRef.current) {
      visualsChanged = runChunkedSync();
    } else if (updateScope === 'all' && timeline.geometry.count >= CHUNKED_MARKER_SYNC_MIN) {
      visualsChanged = runChunkedSync();
    } else {
      const result = updateRequestFlowMarkers(
        timeline,
        playheadMs,
        buffers.sizes,
        buffers.colors,
        buffers.opacities,
        buffers.customdata,
        culledRef.current ?? undefined,
        pulseClock,
        updateScope,
        previousPlayheadMs,
        buffers,
      );
      visualsChanged = result.visualsChanged;
    }

    lastPaintPlayheadRef.current = playheadMs;
    if (visualsChanged) {
      plotRef.current?.paintMarkers();
    }

    if (chunkedSyncRef.current) {
      if (!chunkedSyncRafRef.current) {
        chunkedSyncRafRef.current = requestAnimationFrame(() => {
          chunkedSyncRafRef.current = 0;
          paintPlayhead(playheadRef.current, false, performance.now());
        });
      }
    } else {
      cancelChunkedSyncRaf(chunkedSyncRafRef);
    }

    if (!pulseClock.playing || scrubbingRef.current) {
      plotRef.current?.syncWiggleOverlay([]);
      lastOverlayIndicesRef.current.clear();
    }

    if (updateHud) {
      updateRequestFlowHudDom(
        getHudRefs(),
        timeline,
        playheadMs,
        playingRef.current,
        hudMinimizedRef.current,
      );
    }
  }, [getHudRefs]);

  const paintWiggleFrame = useCallback((playheadMs: number, pulseNowMs: number) => {
    const timeline = timelineRef.current;
    const buffers = markerBuffersRef.current;
    if (!timeline || !buffers || !playingRef.current || scrubbingRef.current) return;

    const clampedPlayhead = Math.max(timeline.startMs, Math.min(playheadMs, timeline.endMs));
    const pulseClock = {
      phaseMs: pulseNowMs,
      playing: true,
      overlaySessions: overlaySessionsRef.current ?? undefined,
    };
    const endedIndices = overlaySessionsRef.current
      ? advanceRequestFlowOverlaySessions(
        timeline,
        playheadMs,
        buffers.sizes,
        pulseClock,
      )
      : [];
    const dots = collectRequestFlowWiggleDots(
      timeline,
      playheadMs,
      buffers.sizes,
      pulseClock,
    );

    const sessions = overlaySessionsRef.current;
    const lockedRadiusAt = (index: number, fallback: number): number => {
      const locked = sessions?.lockedRadius[index] ?? 0;
      return locked > 0 ? locked : fallback;
    };

    const overlayIndices = wiggleOverlayIndicesRef.current;
    overlayIndices.clear();
    const handoffByIndex = wiggleHandoffRef.current;
    handoffByIndex.clear();
    let canvasDirty = false;

    const hideStaleMarker = (index: number): boolean => {
      if (buffers.sizes[index] === 0 && buffers.opacities[index] === 0) return false;
      buffers.sizes[index] = 0;
      buffers.opacities[index] = 0;
      syncRequestFlowVisibleIndex(buffers, index);
      return true;
    };

    const queueHandoff = (index: number) => {
      if (overlayIndices.has(index) || handoffByIndex.has(index)) return;
      const point = timeline.displayPoints[index];
      const size = lockedRadiusAt(index, markerSizeAt(point, clampedPlayhead));
      if (size <= 0) return;
      handoffByIndex.set(index, {
        index,
        lon: point.lon,
        lat: point.lat,
        diameterPx: size * 2,
        color: markerColorAtPlayhead(point, playheadMs, pulseClock, index),
        offsetX: 0,
        shapeIcon: point.shapeIcon,
      });
    };

    for (let i = 0; i < dots.length; i += 1) {
      const index = dots[i].index;
      overlayIndices.add(index);
      if (buffers.opacities[index] !== 0) {
        buffers.opacities[index] = 0;
        syncRequestFlowVisibleIndex(buffers, index);
        canvasDirty = true;
      }
    }

    const restoreCanvasMarker = (index: number, withHandoff = false) => {
      const point = timeline.displayPoints[index];
      const frozenPlayhead = sessions?.frozenPlayheadMs[index] ?? clampedPlayhead;
      const size = lockedRadiusAt(index, markerSizeAt(point, frozenPlayhead));
      if (size <= 0) {
        if (hideStaleMarker(index)) canvasDirty = true;
        return;
      }
      const nextColor = markerColorAtPlayhead(point, playheadMs, pulseClock, index);
      const wasHiddenForOverlay = buffers.opacities[index] === 0;
      if (
        buffers.sizes[index] === size
        && buffers.opacities[index] === 1
        && buffers.colors[index] === nextColor
      ) {
        return;
      }
      buffers.sizes[index] = size;
      buffers.opacities[index] = 1;
      buffers.colors[index] = nextColor;
      buffers.spriteKeyIndices[index] = requestFlowSpriteIndex(
        point.shapeIndex,
        nextColor === REQUEST_FLOW_PAST_DUE_COLOR,
      );
      syncRequestFlowVisibleIndex(buffers, index);
      canvasDirty = true;
      if (withHandoff && wasHiddenForOverlay) {
        queueHandoff(index);
      }
    };

    for (const index of endedIndices) {
      restoreCanvasMarker(index, true);
    }

    for (const index of lastOverlayIndicesRef.current) {
      if (overlayIndices.has(index)) continue;
      restoreCanvasMarker(index, true);
    }

    const handoffList = wiggleHandoffListRef.current;
    handoffList.length = 0;
    handoffByIndex.forEach((dot) => handoffList.push(dot));
    plotRef.current?.syncWiggleOverlay(dots, handoffList, canvasDirty);
    const previousOverlay = lastOverlayIndicesRef.current;
    previousOverlay.clear();
    overlayIndices.forEach((index) => previousOverlay.add(index));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPrepared(null);
    setMapReady(false);
    markerBuffersRef.current = null;
    culledRef.current = null;
    overlaySessionsRef.current = null;
    lastOverlayIndicesRef.current = new Set();
    lastPaintPlayheadRef.current = 0;
    timelineRef.current = null;
    forceFullMarkerUpdateRef.current = true;
    chunkedSyncRef.current = null;
    cancelChunkedSyncRaf(chunkedSyncRafRef);

    const worker = new RequestFlowTimelineWorker();
    worker.onmessage = (event: MessageEvent<{ result: RequestFlowTimelineResult }>) => {
      if (cancelled) return;
      setPrepared(event.data.result);
      worker.terminate();
    };
    worker.onerror = () => {
      if (cancelled) return;
      import('../../lib/homeRequestFlowMap').then(({ prepareRequestFlowTimeline }) => {
        if (cancelled) return;
        setPrepared(prepareRequestFlowTimeline(rows));
      });
      worker.terminate();
    };
    worker.postMessage({ rows });

    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [rows]);

  const timeline = prepared?.hasData ? prepared.timeline : null;
  const hourCount = timeline?.hourCount ?? 0;

  useEffect(() => {
    if (!timeline) return;
    timelineRef.current = timeline;
    const initialPlayheadMs = timeline.startMs
      + INITIAL_YEAR_PROGRESS * (timeline.endMs - timeline.startMs);
    playheadRef.current = initialPlayheadMs;
    lastPaintPlayheadRef.current = initialPlayheadMs;
    markerBuffersRef.current = createRequestFlowMarkerBuffers(timeline);
    culledRef.current = new Uint8Array(timeline.displayPoints.length);
    overlaySessionsRef.current = createRequestFlowOverlaySessions(timeline.displayPoints.length);
    lastOverlayIndicesRef.current = new Set();
    scrubbingRef.current = false;
    forceFullMarkerUpdateRef.current = true;
    chunkedSyncRef.current = null;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setPlaying(false);
      playingRef.current = false;
      playheadRef.current = timeline.endMs;
      lastPaintPlayheadRef.current = timeline.endMs;
      paintPlayhead(timeline.endMs, true);
      setMapReady(true);
      return;
    }

    setPlaying(true);
    playingRef.current = true;
    paintPlayhead(initialPlayheadMs, true);
    setMapReady(true);
  }, [timeline, paintPlayhead]);

  useEffect(() => {
    if (!timeline || !playing) return undefined;

    let raf = 0;
    let lastSimTick = performance.now();
    let lastPaintTick = performance.now();
    let lastHudPaint = 0;

    const tick = (now: number) => {
      if (document.visibilityState === 'hidden') {
        cancelChunkedSyncRaf(chunkedSyncRafRef);
        return;
      }

      const frameIntervalMs = baseFrameIntervalMs;
      const syncInProgress = chunkedSyncRef.current !== null;

      if (
        !scrubbingRef.current
        && !syncInProgress
        && now - lastSimTick >= frameIntervalMs
      ) {
        const delta = now - lastSimTick;
        lastSimTick = now;
        const nextPlayhead = playheadRef.current + delta * SIM_MS_PER_REAL_MS;
        if (nextPlayhead >= timeline.endMs) {
          playheadRef.current = timeline.startMs;
          forceFullMarkerUpdateRef.current = true;
          chunkedSyncRef.current = null;
          cancelChunkedSyncRaf(chunkedSyncRafRef);
          lastOverlayIndicesRef.current.clear();
          if (overlaySessionsRef.current) {
            resetRequestFlowOverlaySessions(overlaySessionsRef.current);
          }
          plotRef.current?.syncWiggleOverlay([]);
          paintPlayhead(timeline.startMs, true, now);
          lastPaintTick = now;
          lastHudPaint = now;
        } else {
          playheadRef.current = nextPlayhead;
        }
      } else if (scrubbingRef.current) {
        lastSimTick = now;
        lastPaintTick = now;
      }

      if (
        !scrubbingRef.current
        && playingRef.current
      ) {
        paintWiggleFrame(playheadRef.current, now);
      }

      if (
        !scrubbingRef.current
        && now - lastPaintTick >= frameIntervalMs
      ) {
        const updateHud = now - lastHudPaint >= HUD_INTERVAL_MS;
        if (updateHud) {
          lastHudPaint = now;
        }
        paintPlayhead(playheadRef.current, updateHud, now);
        lastPaintTick = now;
      }

      raf = requestAnimationFrame(tick);
    };

    const resumeAfterHidden = () => {
      if (document.visibilityState !== 'visible' || !playingRef.current) return;
      const now = performance.now();
      lastSimTick = now;
      lastPaintTick = now;
      if (chunkedSyncRef.current) {
        paintPlayhead(playheadRef.current, false, now);
      }
      if (!raf) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', resumeAfterHidden);
    return () => {
      document.removeEventListener('visibilitychange', resumeAfterHidden);
      cancelAnimationFrame(raf);
    };
  }, [timeline, paintPlayhead, paintWiggleFrame, playing, baseFrameIntervalMs]);

  useEffect(() => {
    if (isActive) {
      if (resumeAfterInactiveRef.current) {
        playingRef.current = true;
        setPlaying(true);
      }
      return undefined;
    }

    resumeAfterInactiveRef.current = playingRef.current;
    playingRef.current = false;
    setPlaying(false);
    cancelChunkedSyncRaf(chunkedSyncRafRef);
    lastOverlayIndicesRef.current.clear();
    plotRef.current?.syncWiggleOverlay([]);
    paintPlayhead(playheadRef.current, true);
    return undefined;
  }, [isActive, paintPlayhead]);

  const pauseForExplore = useCallback(() => {
    if (mapInteractionDepthRef.current === 0) {
      resumePlaybackRef.current = playingRef.current;
      suspendRestylesRef.current = true;
      playingRef.current = false;
      if (resumePlaybackRef.current) {
        setPlaying(false);
      }
    }
    mapInteractionDepthRef.current += 1;
  }, []);

  const resumeAfterExplore = useCallback(() => {
    if (mapInteractionDepthRef.current === 0) return;
    mapInteractionDepthRef.current -= 1;
    if (mapInteractionDepthRef.current > 0) return;
    suspendRestylesRef.current = false;
    playingRef.current = resumePlaybackRef.current;
    paintPlayhead(playheadRef.current, true);
    if (resumePlaybackRef.current) {
      setPlaying(true);
    }
  }, [paintPlayhead]);

  const handleMapInteractionStart = useCallback(() => {
    pauseForExplore();
  }, [pauseForExplore]);

  const handleMapInteractionEnd = useCallback(() => {
    resumeAfterExplore();
  }, [resumeAfterExplore]);

  const handleScrub = useCallback((nextIndex: number) => {
    if (!timeline) return;
    forceFullMarkerUpdateRef.current = true;
    chunkedSyncRef.current = null;
    const nextPlayhead = playheadFromHourIndex(timeline, nextIndex);
    playheadRef.current = nextPlayhead;
    paintPlayhead(nextPlayhead, true);
  }, [timeline, paintPlayhead]);

  const handleScrubPointerDown = useCallback(() => {
    scrubbingRef.current = true;
    pauseForExplore();
    const endScrub = () => {
      scrubbingRef.current = false;
      resumeAfterExplore();
      window.removeEventListener('pointerup', endScrub);
      window.removeEventListener('pointercancel', endScrub);
    };
    window.addEventListener('pointerup', endScrub);
    window.addEventListener('pointercancel', endScrub);
  }, [pauseForExplore, resumeAfterExplore]);

  const handleScrubPointerUp = useCallback(() => {
    scrubbingRef.current = false;
    resumeAfterExplore();
  }, [resumeAfterExplore]);

  const handlePlayToggle = useCallback(() => {
    if (!timeline) return;
    setPlaying((prev) => {
      if (prev) {
        playingRef.current = false;
        lastOverlayIndicesRef.current.clear();
        plotRef.current?.syncWiggleOverlay([]);
        paintPlayhead(playheadRef.current, true);
        return false;
      }
      if (playheadRef.current >= timeline.endMs) {
        playheadRef.current = timeline.startMs;
        forceFullMarkerUpdateRef.current = true;
        chunkedSyncRef.current = null;
        paintPlayhead(timeline.startMs, true);
      }
      playingRef.current = true;
      return true;
    });
  }, [timeline, paintPlayhead]);

  const handlePointerLeave = useCallback(() => {
    setTouchScrubVisible(false);
  }, []);

  useEffect(() => {
    if (!touchScrubVisible) return undefined;

    const onDocumentTouch = (event: TouchEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setTouchScrubVisible(false);
      }
    };

    document.addEventListener('touchstart', onDocumentTouch, { passive: true });
    return () => document.removeEventListener('touchstart', onDocumentTouch);
  }, [touchScrubVisible]);

  const handleMapTouch = useCallback(() => {
    setTouchScrubVisible(true);
  }, []);

  const syncFullscreenHeight = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    setFullscreenHeight(frame.clientHeight);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      if (getFullscreenElement() === frame) {
        await leaveFullscreen();
      } else {
        await enterFullscreen(frame);
      }
    } catch {
      // User gesture required or fullscreen unsupported — ignore.
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      const frame = frameRef.current;
      const active = frame !== null && getFullscreenElement() === frame;
      setIsFullscreen(active);
      if (active) {
        requestAnimationFrame(syncFullscreenHeight);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, [syncFullscreenHeight]);

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const onResize = () => syncFullscreenHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isFullscreen, syncFullscreenHeight]);

  useEffect(() => {
    if (!mapReady || !timelineRef.current) return;
    updateRequestFlowHudDom(
      getHudRefs(),
      timelineRef.current,
      playheadRef.current,
      playingRef.current,
      hudMinimized,
    );
    if (scrubberRef.current) {
      scrubberRef.current.value = String(
        hourIndexFromPlayhead(timelineRef.current, playheadRef.current),
      );
    }
  }, [hudMinimized, mapReady, playing, getHudRefs]);

  if (prepared === null) {
    return (
      <figure className="article-figure my-3 -mx-4 sm:-mx-6">
        <div
          className="flex items-center justify-center border-y border-border bg-surface text-sm text-text-muted"
          style={{ height: mapHeight }}
        >
          Preparing map…
        </div>
      </figure>
    );
  }

  if (!prepared.hasData) {
    return (
      <figure className="article-figure my-3 -mx-4 sm:-mx-6">
        <div
          className="flex items-center justify-center border-y border-border bg-surface px-6 text-center text-sm text-text-muted"
          style={{ height: mapHeight }}
        >
          No geocoded requests to show on the map. Open, filed, and resolved counts in the charts
          still include every request.
        </div>
        <figcaption>
          Pan, zoom, and hover anytime; drag the timeline to jump. Blue dots are on time, orange are past deadline. Counts include all requests; dots only show geocoded requests.
        </figcaption>
      </figure>
    );
  }

  if (!mapReady || !timeline) {
    return null;
  }

  const stageHeight = isFullscreen ? fullscreenHeight || mapHeight : mapHeight;

  return (
    <figure className="article-figure my-3 -mx-4 sm:-mx-6">
      <div
        ref={frameRef}
        className={`request-flow-map-frame overflow-hidden border border-border bg-surface${
          isFullscreen ? ' request-flow-map-frame--fullscreen' : ''
        }`}
      >
        <div
          ref={shellRef}
          className="request-flow-map-shell group relative"
          onPointerLeave={handlePointerLeave}
          onTouchStart={handleMapTouch}
        >
          <div className="request-flow-map-stage relative overflow-hidden">
            <RequestFlowPlot
              timeline={timeline}
              height={stageHeight}
              isMobile={isMobile}
              mapView={mapView}
              plotRef={plotRef}
              markerBuffersRef={markerBuffersRef}
              suspendUpdatesRef={suspendRestylesRef}
              onMapInteractionStart={handleMapInteractionStart}
              onMapInteractionEnd={handleMapInteractionEnd}
              onMapReady={() => {
                paintPlayhead(playheadRef.current, false);
              }}
            />
          </div>

          <div className="request-flow-map-dock absolute bottom-3 left-3 right-3 sm:bottom-4 sm:left-4 sm:right-5 z-10">
            <div
              className={`request-flow-map-glass request-flow-map-hud self-start px-3.5 py-2.5${
                hudMinimized ? '' : ' request-flow-map-hud--expanded'
              }`}
            >
              <RequestFlowHudHeader
                labelRef={hudLabelRef}
                liveRef={hudLiveRef}
                playButtonRef={playButtonRef}
                playing={playing}
                isFullscreen={isFullscreen}
                minimized={hudMinimized}
                onToggle={() => setHudMinimized((prev) => !prev)}
                onPlayToggle={handlePlayToggle}
                onFullscreenToggle={toggleFullscreen}
              />
              <div className="request-flow-map-hud__body">
                {hudMinimized ? (
                  <>
                    <RequestFlowHudStats
                      compact
                      compactOpenRef={compactOpenRef}
                      compactFiledRef={compactFiledRef}
                      compactResolvedRef={compactResolvedRef}
                      expandedOpenRef={expandedOpenRef}
                      expandedFiledRef={expandedFiledRef}
                      expandedResolvedRef={expandedResolvedRef}
                    />
                    <RequestFlowHudDotLegend variant="collapsed-keys" />
                  </>
                ) : (
                  <>
                    <RequestFlowHudStats
                      compactOpenRef={compactOpenRef}
                      compactFiledRef={compactFiledRef}
                      compactResolvedRef={compactResolvedRef}
                      expandedOpenRef={expandedOpenRef}
                      expandedFiledRef={expandedFiledRef}
                      expandedResolvedRef={expandedResolvedRef}
                    />
                    <RequestFlowHudDotLegend variant="expanded" />
                  </>
                )}
              </div>
            </div>

            <div
              className={`request-flow-map-controls w-full ${
                touchScrubVisible ? 'request-flow-map-controls--touch-visible' : ''
              }`}
            >
              <div className="request-flow-map-glass px-3.5 py-2.5">
                <div className="relative h-1 rounded-full bg-gray-200/90 overflow-hidden">
                  <div
                    ref={progressRef}
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 request-flow-map-progress"
                  />
                  <input
                    ref={scrubberRef}
                    type="range"
                    min={0}
                    max={hourCount - 1}
                    defaultValue={hourIndexFromPlayhead(timeline, playheadRef.current)}
                    aria-label="Scrub through the year by hour"
                    onPointerDown={handleScrubPointerDown}
                    onPointerUp={handleScrubPointerUp}
                    onPointerCancel={handleScrubPointerUp}
                    onChange={(event) => handleScrub(Number(event.target.value))}
                    className="request-flow-map-scrubber absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer"
                  />
                </div>
                <div className="flex justify-between mt-2 gap-3 text-[11px] text-text-muted font-mono tabular-nums">
                  <span className="shrink-0 whitespace-nowrap">{timeline.scrubStartLabel}</span>
                  <span className="shrink-0 whitespace-nowrap text-right">{timeline.scrubEndLabel}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        Pan, zoom, and hover anytime; drag the timeline to jump. Blue dots are on time, orange are past deadline. Counts include all requests; dots only show geocoded requests.
      </figcaption>
    </figure>
  );
}
