import type { Map as MaplibreMap } from 'maplibre-gl';

/** Geographic framing for the default DC-centered view. */
export const REQUEST_FLOW_MAP_BOUNDS = {
  west: -77.13,
  east: -76.89,
  south: 38.79,
  north: 39.03,
} as const;

/** Default view center; slightly SW of bounds midpoint to offset the bottom-left HUD. */
export const REQUEST_FLOW_MAP_CENTER = {
  lat: (REQUEST_FLOW_MAP_BOUNDS.south + REQUEST_FLOW_MAP_BOUNDS.north) / 2 - 0.004,
  lon: (REQUEST_FLOW_MAP_BOUNDS.west + REQUEST_FLOW_MAP_BOUNDS.east) / 2 - 0.008,
} as const;

export const REQUEST_FLOW_MAP_ZOOM = {
  mobile: 10.75,
  desktop: 11.05,
} as const;

/** Closer zoom when centering on a saved street address. */
export const REQUEST_FLOW_ADDRESS_ZOOM = {
  mobile: 13.5,
  desktop: 14,
} as const;

/** Ward-level zoom when no street address is saved. */
export const REQUEST_FLOW_WARD_ZOOM = {
  mobile: 12.25,
  desktop: 12.55,
} as const;

/** Approximate ward centers for map framing when only a ward is known. */
export const WARD_MAP_CENTERS: Record<string, { lat: number; lon: number }> = {
  'Ward 1': { lat: 38.9098, lon: -77.0174 },
  'Ward 2': { lat: 38.9175, lon: -76.9850 },
  'Ward 3': { lat: 38.9220, lon: -77.0420 },
  'Ward 4': { lat: 38.9480, lon: -77.0160 },
  'Ward 5': { lat: 38.8990, lon: -76.9850 },
  'Ward 6': { lat: 38.8810, lon: -76.9980 },
  'Ward 7': { lat: 38.8810, lon: -76.9450 },
  'Ward 8': { lat: 38.8600, lon: -76.9930 },
};

export function getWardMapCenter(ward: string): { lat: number; lon: number } | null {
  return WARD_MAP_CENTERS[ward] ?? null;
}

/** Nearest ward center for a geocoded point — used when saving a street address. */
export function lookupWardFromCoordinates(lat: number, lon: number): string | null {
  let bestWard: string | null = null;
  let bestDistance = Infinity;
  for (const [ward, center] of Object.entries(WARD_MAP_CENTERS)) {
    const dLat = lat - center.lat;
    const dLon = lon - center.lon;
    const distance = dLat * dLat + dLon * dLon;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestWard = ward;
    }
  }
  return bestWard;
}

export function isWardApproxSavedAddress(address: string | null | undefined): boolean {
  return address?.startsWith('Near Ward ') ?? false;
}

export interface RequestFlowMapView {
  lat: number;
  lon: number;
  zoom: number;
}

/** Default citywide framing, or a saved-address view when coordinates are provided. */
export function resolveRequestFlowMapView(
  savedLocation: { lat: number; lon: number; address?: string } | null,
  isMobile: boolean,
): RequestFlowMapView {
  if (savedLocation) {
    const wardApprox = savedLocation.address?.startsWith('Near Ward ') ?? false;
    const zoom = wardApprox
      ? (isMobile ? REQUEST_FLOW_WARD_ZOOM.mobile : REQUEST_FLOW_WARD_ZOOM.desktop)
      : (isMobile ? REQUEST_FLOW_ADDRESS_ZOOM.mobile : REQUEST_FLOW_ADDRESS_ZOOM.desktop);
    return {
      lat: savedLocation.lat,
      lon: savedLocation.lon,
      zoom,
    };
  }
  return {
    lat: REQUEST_FLOW_MAP_CENTER.lat,
    lon: REQUEST_FLOW_MAP_CENTER.lon,
    zoom: isMobile ? REQUEST_FLOW_MAP_ZOOM.mobile : REQUEST_FLOW_MAP_ZOOM.desktop,
  };
}

/** Low-value place and road labels to hide on the request-flow map. */
const HIDDEN_LABEL_LAYER_IDS = [
  'place_hamlet',
  'place_suburbs',
  'place_villages',
  'place_town',
  'place_country_1',
  'place_country_2',
  'place_continent',
  'place_state',
  'waterway_label',
  'roadname_minor',
  'roadname_sec',
  'place_city_dot_r2',
  'place_city_dot_r4',
  'place_city_dot_r7',
  'place_city_dot_z7',
  'poi_stadium',
  'poi_park',
] as const;

/** Secondary city names only appear when zoomed in past the default view. */
const ELEVATED_MINZOOM_LAYER_IDS: Record<string, number> = {
  place_city_r5: 12,
  place_city_r6: 12,
};

/** Trims Carto Positron labels so suburban/out-of-district clutter stays out of the way. */
export function applyReducedMapLabels(map: MaplibreMap): void {
  const layerIds = new Set(map.getStyle().layers.map((layer) => layer.id));

  for (const layerId of HIDDEN_LABEL_LAYER_IDS) {
    if (!layerIds.has(layerId)) continue;
    map.setLayoutProperty(layerId, 'visibility', 'none');
  }

  for (const [layerId, minZoom] of Object.entries(ELEVATED_MINZOOM_LAYER_IDS)) {
    if (!layerIds.has(layerId)) continue;
    map.setLayoutProperty(layerId, 'minzoom', minZoom);
  }
}

export function configureRequestFlowBasemap(map: MaplibreMap): void {
  let labelsApplied = false;

  const apply = () => {
    if (labelsApplied) return;
    try {
      if (!map.isStyleLoaded()) return;
      applyReducedMapLabels(map);
      labelsApplied = true;
    } catch {
      // Ignore races while Carto tiles finish loading.
    }
  };

  if (map.isStyleLoaded()) {
    apply();
  } else {
    map.once('load', apply);
  }
}

const MAP_INTERACTION_EVENTS: readonly string[] = [];

export interface RequestFlowMapInteractionHandlers {
  onStart?: () => void;
  onEnd?: () => void;
}

/** Notifies when the basemap pan/zoom gesture begins and ends. */
export function bindRequestFlowMapInteraction(
  map: MaplibreMap,
  handlers: RequestFlowMapInteractionHandlers,
): () => void {
  let active = false;

  const onStart = () => {
    if (active) return;
    active = true;
    handlers.onStart?.();
  };
  const onEnd = () => {
    if (!active) return;
    active = false;
    handlers.onEnd?.();
  };

  for (const event of MAP_INTERACTION_EVENTS) {
    map.on(event, event.endsWith('start') ? onStart : onEnd);
  }

  return () => {
    for (const event of MAP_INTERACTION_EVENTS) {
      map.off(event, event.endsWith('start') ? onStart : onEnd);
    }
  };
}
