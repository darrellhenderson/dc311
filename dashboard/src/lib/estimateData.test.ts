import { describe, expect, it } from 'vitest';
import {
  buildEstimateLookup,
  buildEstimateSearchParams,
  buildEstimateShareImagePath,
  buildEstimateShareUrl,
  buildShareClipboard,
  buildShareText,
  CITYWIDE_WARD_VALUE,
  decodeWardFromUrl,
  encodeWardForUrl,
  confidenceVerdict,
  formatResolutionLine,
  formatSampleSubline,
  generateOutcomeSentences,
  generateWaitContext,
  getQuickPickServiceTypes,
  getWardComparison,
  getWardStandoutTypes,
  lookupEstimate,
  looksLikeTicketId,
  normalizeTicketId,
  parseEstimateSearchParams,
  personalVerdict,
  typeOnlySummary,
  resolveTabFromSearchParams,
  searchServiceTypes,
  stripEstimateSearchParams,
} from './estimateData';
import { DataManifest } from '../api/dataTypes';

function makeManifest(estimates: DataManifest['estimates']): DataManifest {
  return {
    version: 'test',
    builtAt: '2026-01-01T00:00:00Z',
    totalRows: 100,
    shards: [],
    dictionaries: {
      serviceTypes: ['Pothole', 'Sidewalk Repair', 'Illegal Dumping', 'Abandoned Bicycle'],
      agencies: [],
      statuses: [],
      wards: ['Ward 1', 'Ward 2'],
      categories: [],
      dayOfWeek: [],
      ageBuckets: [],
      zipcodes: [],
      cities: [],
      states: [],
      serviceTypeCodes: [],
      serviceCodes: [],
      priorities: [],
    },
    categoryMap: {
      Pothole: 'Roads & Vehicle Infrastructure',
      'Sidewalk Repair': 'Pedestrian Infrastructure',
      'Illegal Dumping': 'Sanitation',
      'Abandoned Bicycle': 'Transportation',
    },
    defaults: { windowDays: 90 },
    estimates,
  };
}

describe('buildEstimateLookup', () => {
  it('indexes citywide and ward rows', () => {
    const manifest = makeManifest([
      { st: 0, w: null, n: 100, p25: 2, p50: 4, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 },
      { st: 0, w: 0, n: 40, p25: 3, p50: 6, p75: 9, p90: 16, sla_days: 21, pct_met_sla: 90 },
    ]);
    const lookup = buildEstimateLookup(manifest);
    expect(lookup.get('Pothole')?.p50).toBe(4);
    expect(lookup.get('Pothole|Ward 1')?.p50).toBe(6);
  });
});

describe('lookupEstimate', () => {
  const manifest = makeManifest([
    { st: 0, w: null, n: 100, p25: 2, p50: 4, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 },
    { st: 0, w: 0, n: 10, p25: 3, p50: 6, p75: 9, p90: 16, sla_days: 21, pct_met_sla: 90 },
    { st: 0, w: 1, n: 50, p25: 1, p50: 3, p75: 5, p90: 10, sla_days: 21, pct_met_sla: 96 },
  ]);
  const lookup = buildEstimateLookup(manifest);

  it('returns citywide when no ward selected', () => {
    const result = lookupEstimate(lookup, 'Pothole', null);
    expect(result?.estimate.p50).toBe(4);
    expect(result?.citywideEstimate.p50).toBe(4);
    expect(result?.usedWardFallback).toBe(false);
  });

  it('falls back to citywide when ward sample is too small', () => {
    const result = lookupEstimate(lookup, 'Pothole', 'Ward 1');
    expect(result?.estimate.p50).toBe(4);
    expect(result?.usedWardFallback).toBe(true);
  });

  it('uses ward estimate when sample is large enough', () => {
    const result = lookupEstimate(lookup, 'Pothole', 'Ward 2');
    expect(result?.estimate.p50).toBe(3);
    expect(result?.citywideEstimate.p50).toBe(4);
    expect(result?.usedWardFallback).toBe(false);
  });

  it('returns null for unknown service type', () => {
    expect(lookupEstimate(lookup, 'Unknown', null)).toBeNull();
  });
});

describe('confidenceVerdict', () => {
  it('maps compliance rate to verdict labels', () => {
    expect(confidenceVerdict(96).label).toBe('Usually meets the city\'s deadline');
    expect(confidenceVerdict(85).label).toBe('Sometimes misses the deadline');
    expect(confidenceVerdict(70).label).toBe('Often misses the city\'s deadline');
  });
});

describe('generateWaitContext', () => {
  const estimate = { n: 100, p25: 2, p50: 4, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 };

  it('describes early wait as typical', () => {
    expect(generateWaitContext(2, estimate)).toBe(
      'Your request is well within the typical range \u2014 no action needed.',
    );
  });

  it('describes above-median wait', () => {
    expect(generateWaitContext(5, estimate)).toContain('taking longer than average');
  });

  it('warns when past p90 but before SLA', () => {
    expect(generateWaitContext(16, estimate)).toContain('past what\'s typical');
    expect(generateWaitContext(16, estimate)).toContain('deadline is in');
  });

  it('warns when past deadline', () => {
    expect(generateWaitContext(25, estimate)).toContain('past the city\'s deadline');
    expect(generateWaitContext(25, estimate)).toContain('311.dc.gov');
  });
});

describe('generateOutcomeSentences', () => {
  const citywideEstimate = { n: 100, p25: 3, p50: 5, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 };
  const wardEstimate = { n: 50, p25: 10, p50: 14, p75: 18, p90: 22, sla_days: 21, pct_met_sla: 88 };

  it('returns no sentences when ward comparison is shown', () => {
    const sentences = generateOutcomeSentences({
      estimate: wardEstimate,
      citywideEstimate,
      wardEstimate,
      ward: 'Ward 7',
      usedWardFallback: false,
    });
    expect(sentences).toHaveLength(0);
  });

  it('returns no sentences when ward median exceeds citywide', () => {
    const modestWard = { ...wardEstimate, p50: 6 };
    const sentences = generateOutcomeSentences({
      estimate: modestWard,
      citywideEstimate,
      wardEstimate: modestWard,
      ward: 'Ward 7',
      usedWardFallback: false,
    });
    expect(sentences).toHaveLength(0);
  });

  it('returns no sentences without ward estimate', () => {
    const sentences = generateOutcomeSentences({
      estimate: citywideEstimate,
      citywideEstimate,
      ticket: {
        id: '25-001',
        serviceType: 'Pothole',
        ward: 'Ward 1',
        filedDate: new Date('2026-05-01'),
        isOpen: true,
        isClosed: false,
        markerDays: 10,
      },
    });
    expect(sentences).toHaveLength(0);
  });
});

describe('getWardComparison', () => {
  const citywideEstimate = { n: 100, p25: 3, p50: 5, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 };
  const wardEstimate = { n: 50, p25: 10, p50: 14, p75: 18, p90: 22, sla_days: 21, pct_met_sla: 88 };

  it('returns comparison when ward median exceeds 1.5× citywide', () => {
    const comparison = getWardComparison({
      estimate: wardEstimate,
      citywideEstimate,
      wardEstimate,
      ward: 'Ward 7',
      usedWardFallback: false,
    });
    expect(comparison?.ward).toBe('Ward 7');
    expect(comparison?.wardMedian).toBe(14);
    expect(comparison?.citywideMedian).toBe(5);
    expect(comparison?.direction).toBe('slower');
  });

  it('returns comparison when ward median exceeds the faster threshold', () => {
    const fastWard = { n: 50, p25: 1, p50: 2, p75: 3, p90: 5, sla_days: 21, pct_met_sla: 96 };
    const comparison = getWardComparison({
      estimate: fastWard,
      citywideEstimate,
      wardEstimate: fastWard,
      ward: 'Ward 2',
      usedWardFallback: false,
    });
    expect(comparison?.direction).toBe('faster');
    expect(comparison?.wardMedian).toBe(2);
  });

  it('returns null when ward data is insufficient', () => {
    expect(getWardComparison({
      estimate: citywideEstimate,
      citywideEstimate,
      ward: 'Ward 7',
      usedWardFallback: true,
    })).toBeNull();
  });

  it('returns comparison when ward and citywide medians are similar', () => {
    const similarWard = { n: 50, p25: 4, p50: 5, p75: 7, p90: 10, sla_days: 21, pct_met_sla: 94 };
    const comparison = getWardComparison({
      estimate: similarWard,
      citywideEstimate,
      wardEstimate: similarWard,
      ward: 'Ward 3',
      usedWardFallback: false,
    });
    expect(comparison?.ward).toBe('Ward 3');
    expect(comparison?.wardMedian).toBe(5);
    expect(comparison?.citywideMedian).toBe(5);
  });
});

describe('personalVerdict', () => {
  const estimate = { n: 100, p25: 2, p50: 4, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 };

  it('returns on-track verdict for early wait', () => {
    const v = personalVerdict(estimate, { waitDays: 2 });
    expect(v?.headline).toBe('Still on track');
    expect(v?.tone).toBe('success');
    expect(v?.detail).toContain('deadline in 19 days');
  });

  it('appends SLA deadline for warning-tone waits', () => {
    const v = personalVerdict(estimate, { waitDays: 5 });
    expect(v?.tone).toBe('warning');
    expect(v?.detail).toContain('deadline in 16 days');
  });

  it('returns deadline verdict when past SLA', () => {
    const v = personalVerdict(estimate, { waitDays: 25 });
    expect(v?.headline).toBe('Past the city\'s deadline');
    expect(v?.tone).toBe('danger');
  });

  it('returns resolved verdict for closed tickets', () => {
    const v = personalVerdict(estimate, {
      ticket: {
        id: '25-001',
        serviceType: 'Pothole',
        ward: 'Ward 1',
        filedDate: new Date('2026-05-01'),
        isOpen: false,
        isClosed: true,
        markerDays: 2,
      },
    });
    expect(v?.headline).toBe('Resolved faster than most');
  });
});

describe('typeOnlySummary', () => {
  it('returns confidence message for type-only lookup', () => {
    const summary = typeOnlySummary({ n: 100, p25: 2, p50: 4, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 96 });
    expect(summary.tone).toBe('success');
    expect(summary.message).toContain('almost always');
  });
});

describe('formatSampleSubline', () => {
  const estimate = { n: 842, p25: 2, p50: 4, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 };

  it('returns sample count and build date', () => {
    const line = formatSampleSubline(estimate, 'Jun 2026');
    expect(line).toBe('Based on 842 similar requests resolved through Jun 2026');
  });

  it('omits build date when not provided', () => {
    const line = formatSampleSubline(estimate, null);
    expect(line).toBe('Based on 842 similar requests resolved');
  });
});

describe('formatResolutionLine', () => {
  it('returns resolution stats for full-year preset', () => {
    const line = formatResolutionLine({ total: 100, closed: 85, open: 15 }, 'full');
    expect(line).toContain('85% resolved');
    expect(line).toContain('15 still open');
  });

  it('returns null for 90d preset', () => {
    expect(formatResolutionLine({ total: 100, closed: 85, open: 15 }, '90d')).toBeNull();
  });

  it('returns null when no stats', () => {
    expect(formatResolutionLine(null, 'full')).toBeNull();
  });
});

describe('stripEstimateSearchParams', () => {
  it('removes all estimate keys', () => {
    const params = new URLSearchParams('tab=sla&type=Pothole&ward=Ward+2&wait=5');
    stripEstimateSearchParams(params);
    expect(params.toString()).toBe('tab=sla');
  });

  it('leaves unrelated params untouched', () => {
    const params = new URLSearchParams('tab=estimate&foo=bar');
    stripEstimateSearchParams(params);
    expect(params.toString()).toBe('tab=estimate&foo=bar');
  });
});

describe('resolveTabFromSearchParams', () => {
  it('returns explicit tab when valid', () => {
    expect(resolveTabFromSearchParams(new URLSearchParams('tab=sla'))).toBe('sla');
  });

  it('defaults to estimate when estimate params are present without tab', () => {
    expect(resolveTabFromSearchParams(new URLSearchParams('type=Pothole&ward=Ward+4'))).toBe('estimate');
  });

  it('defaults to overview when no tab or estimate params', () => {
    expect(resolveTabFromSearchParams(new URLSearchParams(''))).toBe('overview');
  });

  it('honors explicit tab=overview even when estimate params are present', () => {
    expect(resolveTabFromSearchParams(new URLSearchParams('tab=overview&type=Pothole'))).toBe('overview');
  });

  it('defaults to estimate for invalid tab with estimate params', () => {
    expect(resolveTabFromSearchParams(new URLSearchParams('tab=invalid&type=Pothole'))).toBe('estimate');
  });

  it('defaults to overview for invalid tab without estimate params', () => {
    expect(resolveTabFromSearchParams(new URLSearchParams('tab=invalid'))).toBe('overview');
  });
});

describe('estimate share URL', () => {
  it('encodes ticket lookup with optional ward', () => {
    const params = buildEstimateSearchParams({ ticket: '26-00349083', ward: 'Ward 7' });
    expect(params.get('tab')).toBe('estimate');
    expect(params.get('ticket')).toBe('26-00349083');
    expect(params.get('ward')).toBe('Ward 7');
    expect(params.get('type')).toBeNull();
  });

  it('encodes service-type search with ward and wait days', () => {
    const params = buildEstimateSearchParams({
      serviceType: 'Pothole',
      ward: 'Ward 2',
      waitDays: 12,
    });
    expect(params.get('type')).toBe('Pothole');
    expect(params.get('ward')).toBe('Ward 2');
    expect(params.get('wait')).toBe('12');
    expect(params.get('ticket')).toBeNull();
  });

  it('builds a full share URL', () => {
    const url = buildEstimateShareUrl('https://example.com', '/dc311/', {
      serviceType: 'Pothole',
      waitDays: 5,
    });
    expect(url).toBe('https://example.com/dc311/?tab=estimate&type=Pothole&wait=5');
  });

  it('builds a share image path', () => {
    expect(buildEstimateShareImagePath('/', 'Pothole', 'Ward 2')).toBe(
      '/share/og/pothole--ward-2.png',
    );
    expect(buildEstimateShareImagePath('/dc311/', 'Pothole', null)).toBe(
      '/dc311/share/og/pothole--citywide.png',
    );
  });

  it('encodes citywide ward as sentinel when ticket is loaded', () => {
    const params = buildEstimateSearchParams({ ticket: '26-00349083', ward: null });
    expect(params.get('ward')).toBe(CITYWIDE_WARD_VALUE);
  });

  it('decodes citywide sentinel back to empty ward', () => {
    expect(decodeWardFromUrl(CITYWIDE_WARD_VALUE, true)).toBe('');
    expect(encodeWardForUrl('', true)).toBe(CITYWIDE_WARD_VALUE);
  });

  it('omits ward param for citywide type-only search', () => {
    const params = buildEstimateSearchParams({ serviceType: 'Pothole', ward: null });
    expect(params.get('ward')).toBeNull();
  });

  it('builds clipboard payload with message before link', () => {
    const clipboard = buildShareClipboard('https://example.com/?tab=estimate', 'Summary line.');
    expect(clipboard).toBe('Summary line.\n\nhttps://example.com/?tab=estimate');
  });

  it('round-trips parse and build', () => {
    const built = buildEstimateSearchParams({
      serviceType: 'Illegal Dumping',
      ward: 'Ward 1',
      waitDays: 8,
    });
    const parsed = parseEstimateSearchParams(built);
    expect(parsed).toEqual({
      ticket: null,
      serviceType: 'Illegal Dumping',
      ward: 'Ward 1',
      waitDays: 8,
    });
  });
});

describe('buildShareText', () => {
  const lookup = {
    estimate: { n: 500, p25: 3, p50: 5, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 },
    citywideEstimate: { n: 500, p25: 3, p50: 5, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 },
    wardEstimate: null,
    usedWardFallback: false,
  };

  it('leads with share copy for type-only lookup', () => {
    const text = buildShareText({
      serviceType: 'Pothole',
      ward: null,
      lookup,
      ticket: null,
      waitDays: null,
    });
    expect(text).toBe('Pothole: typically 3–7 days. 94% on time — perceptibly slow.');
    expect(text).not.toContain('Source:');
  });

  it('leads with verdict headline for open tickets', () => {
    const text = buildShareText({
      serviceType: 'Pothole',
      ward: null,
      lookup,
      ticket: {
        id: '25-001',
        serviceType: 'Pothole',
        ward: 'Ward 1',
        filedDate: new Date('2026-05-01'),
        isOpen: true,
        isClosed: false,
        markerDays: 12,
      },
      waitDays: null,
      personal: {
        headline: 'Taking longer than average',
        detail: 'Most similar requests resolve soon',
        tone: 'warning',
      },
    });
    expect(text).toContain('Taking longer than average');
    expect(text).toContain('#25-001');
    expect(text).toContain('open 12 days');
    expect(text.split('\n\n')).toHaveLength(1);
  });

  it('uses ward-specific share copy when ward data is available', () => {
    const wardLookup = {
      ...lookup,
      estimate: { n: 50, p25: 4, p50: 6, p75: 8, p90: 12, sla_days: 21, pct_met_sla: 88 },
      wardEstimate: { n: 50, p25: 4, p50: 6, p75: 8, p90: 12, sla_days: 21, pct_met_sla: 88 },
      usedWardFallback: false,
    };
    const text = buildShareText({
      serviceType: 'Pothole',
      ward: 'Ward 7',
      lookup: wardLookup,
      ticket: null,
      waitDays: null,
    });
    expect(text).toBe('Pothole in Ward 7: typically 4–8 days. 88% on time — perceptibly slow.');
  });

  it('uses ward_gap copy when ward median exceeds citywide threshold', () => {
    const wardLookup = {
      estimate: { n: 50, p25: 10, p50: 14, p75: 18, p90: 22, sla_days: 21, pct_met_sla: 88 },
      citywideEstimate: { n: 500, p25: 3, p50: 5, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 },
      wardEstimate: { n: 50, p25: 10, p50: 14, p75: 18, p90: 22, sla_days: 21, pct_met_sla: 88 },
      usedWardFallback: false,
    };
    const text = buildShareText({
      serviceType: 'Pothole',
      ward: 'Ward 7',
      lookup: wardLookup,
      ticket: null,
      waitDays: null,
    });
    expect(text).toContain('In Ward 7, pothole takes 3× longer');
    expect(text).toContain('14 days here, 5 citywide');
  });
});

describe('getQuickPickServiceTypes', () => {
  it('prefers common high-volume service types', () => {
    const manifest = makeManifest([
      { st: 0, w: null, n: 5000, p25: 2, p50: 4, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 },
      { st: 1, w: null, n: 100, p25: 5, p50: 10, p75: 15, p90: 20, sla_days: 30, pct_met_sla: 80 },
      { st: 2, w: null, n: 800, p25: 3, p50: 6, p75: 9, p90: 12, sla_days: 21, pct_met_sla: 90 },
      { st: 3, w: null, n: 600, p25: 4, p50: 8, p75: 12, p90: 16, sla_days: 21, pct_met_sla: 88 },
    ]);
    const picks = getQuickPickServiceTypes(manifest);
    expect(picks).toHaveLength(3);
    expect(picks[0]).toBe('Sidewalk Repair');
    expect(picks).toEqual(['Sidewalk Repair', 'Pothole', 'Illegal Dumping']);
  });
});

describe('ticket id helpers', () => {
  it('detects ticket-like input', () => {
    expect(looksLikeTicketId('25-00345678')).toBe(true);
    expect(looksLikeTicketId('pothole')).toBe(false);
  });

  it('normalizes ticket ids', () => {
    expect(normalizeTicketId('2500345678')).toBe('25-00345678');
  });
});

describe('getWardStandoutTypes', () => {
  it('returns ward types slower than citywide by threshold', () => {
    const manifest = makeManifest([
      { st: 0, w: null, n: 100, p25: 2, p50: 4, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 },
      { st: 0, w: 1, n: 50, p25: 10, p50: 12, p75: 16, p90: 20, sla_days: 21, pct_met_sla: 80 },
      { st: 1, w: null, n: 100, p25: 2, p50: 4, p75: 7, p90: 14, sla_days: 21, pct_met_sla: 94 },
      { st: 1, w: 1, n: 50, p25: 1, p50: 3, p75: 5, p90: 10, sla_days: 21, pct_met_sla: 96 },
    ]);
    expect(getWardStandoutTypes(manifest, 'Ward 2', 3)).toEqual(['Pothole']);
  });
});

describe('searchServiceTypes', () => {
  it('groups matches by category', () => {
    const groups = searchServiceTypes(
      'pot',
      ['Pothole', 'Sidewalk Repair'],
      { Pothole: 'Roads & Vehicle Infrastructure', 'Sidewalk Repair': 'Pedestrian Infrastructure' },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].types).toEqual(['Pothole']);
  });

  it('returns all service types grouped when the query is empty', () => {
    const groups = searchServiceTypes(
      '',
      ['Pothole', 'Sidewalk Repair', 'Illegal Dumping'],
      {
        Pothole: 'Roads',
        'Sidewalk Repair': 'Pedestrian',
        'Illegal Dumping': 'Sanitation',
      },
    );
    expect(groups).toHaveLength(3);
    expect(groups.flatMap((group) => group.types)).toHaveLength(3);
  });
});
