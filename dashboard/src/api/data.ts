import {
  DashboardData,
  DataManifest,
  DateRangePreset,
  LoadProgress,
  RollupFile,
  ShardFile,
} from './dataTypes';
import { hydrateRows } from '../lib/hydrate';
import { mergeRollups } from '../lib/rollups';
import { markPerf, measurePerf } from '../lib/perf';

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${DATA_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** Returns shard IDs to load for the given date range preset. */
export function shardsForPreset(manifest: DataManifest, preset: DateRangePreset): string[] {
  const sorted = [...manifest.shards].sort((a, b) => a.id.localeCompare(b.id));
  if (preset === 'full') return sorted.map((s) => s.id);

  const windowMs = manifest.defaults.windowDays * 86400000;
  const cutoff = Date.now() - windowMs;
  return sorted.filter((s) => s.maxDate >= cutoff).map((s) => s.id);
}

export async function fetchManifest(): Promise<DataManifest> {
  markPerf('data:manifest:start');
  const manifest = await fetchJson<DataManifest>('manifest.json', { cache: 'no-store' });
  markPerf('data:manifest:end');
  measurePerf('data:manifest:start', 'data:manifest:end', 'data-manifest');
  return manifest;
}

/** Loads monthly shards and rollups in parallel, then hydrates rows. */
export async function fetchDashboardData(
  preset: DateRangePreset,
  onProgress?: (p: LoadProgress) => void,
): Promise<DashboardData> {
  markPerf('data:load:start');
  const manifest = await fetchManifest();
  const shardIds = shardsForPreset(manifest, preset);
  const shardMetas = manifest.shards.filter((s) => shardIds.includes(s.id));

  let loaded = 0;
  const results = await Promise.all(
    shardMetas.map(async (meta) => {
      const [shard, rollup] = await Promise.all([
        fetchJson<ShardFile>(meta.file),
        fetchJson<RollupFile>(meta.rollupFile),
      ]);
      loaded += 1;
      onProgress?.({ loaded, total: shardMetas.length, currentShard: meta.id });
      return { shard, rollup, id: meta.id };
    }),
  );

  onProgress?.({ loaded: shardMetas.length, total: shardMetas.length, currentShard: '' });

  const allRows = results.flatMap((r) => r.shard.rows);
  const rows = hydrateRows(allRows, manifest.dictionaries);
  const rollups = mergeRollups(results.map((r) => r.rollup), manifest.dictionaries);

  markPerf('data:load:end');
  measurePerf('data:load:start', 'data:load:end', 'data-load');

  return {
    manifest,
    rows,
    loadedShards: results.map((r) => r.id),
    monthlyRollups: results.map((r) => r.rollup),
    rollups,
  };
}

/** Loads all monthly rollup shards for the overview timeline (no row hydration). */
export async function fetchRollupTimeline(): Promise<RollupFile[]> {
  const manifest = await fetchManifest();
  const sorted = [...manifest.shards].sort((a, b) => a.id.localeCompare(b.id));
  return Promise.all(sorted.map((meta) => fetchJson<RollupFile>(meta.rollupFile)));
}
