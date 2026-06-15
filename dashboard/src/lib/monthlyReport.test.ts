import { describe, expect, it, vi, afterEach } from 'vitest';
import { DataDictionaries, DataShardMeta, RollupFile, SlaRollupRow } from '../api/dataTypes';
import { ProcessedRequest } from './dataProcessing';
import {
  computeBacklogSnapshot,
  computeCategorySlaBandCounts,
  computeCategoryReportingReadiness,
  computeCategorySlaBandMoMScore,
  categorySlaBandMoMVerdict,
  computeCategorySlaForMonth,
  computeCohortDisposition,
  computeCohortSettling,
  computeCumulativeResolutionCurve,
  computeCohortFlow,
  computeDailyVolumeByCategory,
  computeMonthlyScorecard,
  detectNotables,
  findPrevMonth,
  findYoyMonth,
  formatFiledScorecardKpi,
  formatResolvedScorecardKpi,
  formatCategorySlaBandAccessibleSummary,
  formatCategorySlaBandsScorecardKpi,
  formatSlaScorecardKpi,
  formatScorecardKpi,
  getAvailableMonths,
  getLatestCompleteMonth,
} from './monthlyReport';

function mockDicts(): DataDictionaries {
  return {
    serviceTypes: ['Pothole', 'Tree trim'],
    categories: ['Sanitation & Dumping', 'Trees & Canopy'],
    agencies: ['DPW'],
    statuses: ['Open', 'Closed'],
    wards: ['Ward 1', 'Ward 2'],
    dayOfWeek: ['Monday'],
    ageBuckets: ['< 1 week', '1–4 weeks', '1–2 months', '2–3 months'],
    zipcodes: [],
    cities: [],
    states: [],
    serviceTypeCodes: [],
    serviceCodes: [],
    priorities: [],
  };
}

function mockSlaRow(overrides: Partial<SlaRollupRow> & { serviceType: number; category: number }): SlaRollupRow {
  const total = overrides.total ?? 100;
  const missed = overrides.missed_sla_count ?? 0;
  const overdue = overrides.open_past_sla_count ?? 0;
  return {
    agency: 0,
    sla_days: 7,
    closed: overrides.closed ?? total - overdue,
    met_sla_count: overrides.met_sla_count ?? total - missed - overdue,
    median_resolution: 3,
    p99_resolution: 10,
    pct_resolved: 90,
    pct_met_sla: ((total - missed - overdue) / total) * 100,
    ...overrides,
    total,
    missed_sla_count: missed,
    open_past_sla_count: overdue,
  };
}

function mockRollup(
  month: string,
  overrides: Partial<{
    sla: SlaRollupRow[];
    categoryBreakdown: Array<{ c: number; open: number; resolved: number }>;
    wardVolume: Array<{ w: number; open: number; resolved: number }>;
    typeCounts: Array<{ st: number; open: number; resolved: number }>;
  }> = {},
): RollupFile {
  const categoryBreakdown = overrides.categoryBreakdown ?? [{ c: 0, open: 10, resolved: 90 }];
  return {
    month,
    sla: overrides.sla ?? [mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 2, open_past_sla_count: 1 })],
    explorer: {
      categoryBreakdown,
      dayOfWeek: [],
      wardVolume: overrides.wardVolume ?? [],
      typeCounts: overrides.typeCounts ?? [{ st: 0, open: 10, resolved: 90 }],
      weeklyVolume: [],
    },
  };
}

function mockShard(id: string): DataShardMeta {
  return { id, file: `${id}.json`, rollupFile: `rollups/${id}.json`, rowCount: 100, minDate: 0, maxDate: 0 };
}

function mockOpenRequest(ageDays: number, month = '2025-05'): ProcessedRequest {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, mon - 1, 15);
  return {
    SERVICEREQUESTID: '1',
    ADDDATE: date.toISOString().slice(0, 10),
    RESOLUTIONDATE: null,
    SERVICEDUEDATE: '2025-04-25',
    SERVICEORDERDATE: null,
    INSPECTIONDATE: null,
    CREATED: null,
    EDITED: null,
    SERVICECODE: 0,
    SERVICECODEDESCRIPTION: 'Pothole',
    SERVICETYPECODEDESCRIPTION: null,
    ORGANIZATIONACRONYM: 'DDOT',
    SERVICEORDERSTATUS: 'Open',
    STATUS_CODE: null,
    PRIORITY: null,
    SERVICECALLCOUNT: null,
    INSPECTIONFLAG: null,
    INSPECTORNAME: null,
    STREETADDRESS: '1 St',
    CITY: null,
    STATE: null,
    ZIPCODE: null,
    DETAILS: null,
    WARD: '1',
    LATITUDE: null,
    LONGITUDE: null,
    date,
    week: new Date(year, mon - 1, 14),
    hour: 12,
    dayOfWeek: 'Tuesday',
    category: 'Sanitation & Dumping',
    is_open: true,
    is_closed: false,
    age_days: ageDays,
    resolution_days: null,
    age_bucket: ageDays < 7 ? '< 1 week' : '1–4 weeks',
  };
}

function mockClosedRequest(resolutionDays: number, month = '2025-05'): ProcessedRequest {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, mon - 1, 15);
  return {
    ...mockOpenRequest(0),
    is_open: false,
    is_closed: true,
    age_days: resolutionDays,
    resolution_days: resolutionDays,
    date,
    ADDDATE: date.toISOString().slice(0, 10),
    SERVICEORDERSTATUS: 'Closed',
  };
}

describe('getAvailableMonths', () => {
  it('returns shard ids sorted descending', () => {
    expect(getAvailableMonths([
      mockShard('2025-04'),
      mockShard('2025-06'),
      mockShard('2025-05'),
    ])).toEqual(['2025-06', '2025-05', '2025-04']);
  });
});

describe('getLatestCompleteMonth', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the latest shard when it is not the current calendar month', () => {
    expect(getLatestCompleteMonth([mockShard('2020-01'), mockShard('2020-02')])).toBe('2020-02');
  });

  it('skips the in-progress calendar month when it is the latest shard', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 15)); // June 2025

    expect(getLatestCompleteMonth([
      mockShard('2025-06'),
      mockShard('2025-05'),
    ])).toBe('2025-05');
  });

  it('returns empty string when no shards exist', () => {
    expect(getLatestCompleteMonth([])).toBe('');
  });
});

describe('findPrevMonth and findYoyMonth', () => {
  const rollups = [
    mockRollup('2024-05'),
    mockRollup('2025-04'),
    mockRollup('2025-05'),
  ];

  it('finds the prior calendar month rollup', () => {
    expect(findPrevMonth(rollups, '2025-05')?.month).toBe('2025-04');
    expect(findPrevMonth(rollups, '2025-04')?.month).toBe('2024-05');
    expect(findPrevMonth(rollups, '2024-05')).toBeNull();
  });

  it('finds the same month one year earlier', () => {
    expect(findYoyMonth(rollups, '2025-05')?.month).toBe('2024-05');
    expect(findYoyMonth(rollups, '2025-04')).toBeNull();
  });
});

describe('computeMonthlyScorecard', () => {
  const dicts = mockDicts();

  it('computes SLA compliance using total minus failures', () => {
    const current = mockRollup('2025-05', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 5, open_past_sla_count: 3 })],
      categoryBreakdown: [{ c: 0, open: 20, resolved: 80 }],
    });

    const scorecard = computeMonthlyScorecard(current, null, null, dicts);

    expect(scorecard.pctMetSla).toBe(92);
    expect(scorecard.pctMetSlaClosedOnly).toBeCloseTo(94.8, 1);
    expect(scorecard.totalFiled).toBe(100);
    expect(scorecard.totalResolved).toBe(80);
    expect(scorecard.netBacklogChange).toBe(20);
    expect(scorecard.medianResolutionDays).toBe(3);
    expect(scorecard.immatureCohort).toBe(false);
  });

  it('flags provisional cohorts on the scorecard', () => {
    const current = mockRollup('2025-05', {
      sla: [mockSlaRow({
        serviceType: 0,
        category: 0,
        total: 100,
        met_sla_count: 45,
        missed_sla_count: 5,
        open_past_sla_count: 5,
      })],
      categoryBreakdown: [{ c: 0, open: 50, resolved: 50 }],
    });

    const scorecard = computeMonthlyScorecard(current, null, null, dicts);

    expect(scorecard.immatureCohort).toBe(true);
  });

  it('includes MoM and YoY deltas when comparison rollups exist', () => {
    const prev = mockRollup('2025-04', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 80, missed_sla_count: 2, open_past_sla_count: 0 })],
      categoryBreakdown: [{ c: 0, open: 10, resolved: 70 }],
    });
    const current = mockRollup('2025-05', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 5, open_past_sla_count: 3 })],
      categoryBreakdown: [{ c: 0, open: 20, resolved: 80 }],
    });
    const yoy = mockRollup('2024-05', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 90, missed_sla_count: 1, open_past_sla_count: 0 })],
      categoryBreakdown: [{ c: 0, open: 15, resolved: 75 }],
    });

    const scorecard = computeMonthlyScorecard(current, prev, yoy, dicts);

    expect(scorecard.deltas.pctMetSla).toEqual({ absolute: -5.5, direction: 'down', formatted: '-5.5 pts' });
    expect(scorecard.deltas.totalFiled).toEqual({ absolute: 20, direction: 'up', formatted: '+20' });
    expect(scorecard.yoyDeltas?.totalFiled).toEqual({ absolute: 10, direction: 'up', formatted: '+10' });
  });
});

describe('computeCategorySlaForMonth', () => {
  it('computes per-category SLA and MoM delta', () => {
    const dicts = mockDicts();
    const prev = mockRollup('2025-04', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 0, open_past_sla_count: 0 })],
    });
    const current = mockRollup('2025-05', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 8, open_past_sla_count: 0 })],
    });

    const rows = computeCategorySlaForMonth(current, prev, dicts);

    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('Sanitation & Dumping');
    expect(rows[0].pctMetSla).toBe(92);
    expect(rows[0].prevPctMetSla).toBe(100);
    expect(rows[0].delta).toBe(-8);
    expect(rows[0].tone).toBe('danger');
  });
});

describe('computeCategorySlaBandCounts', () => {
  it('counts categories by SLA band', () => {
    const dicts: DataDictionaries = {
      ...mockDicts(),
      serviceTypes: ['Pothole', 'Tree trim', 'Road crack'],
      categories: ['Sanitation & Dumping', 'Trees & Canopy', 'Roads & Transport'],
    };
    const rollup = mockRollup('2025-05', {
      sla: [
        mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 0, open_past_sla_count: 0 }),
        mockSlaRow({ serviceType: 1, category: 1, total: 100, missed_sla_count: 4, open_past_sla_count: 0 }),
        mockSlaRow({ serviceType: 2, category: 2, total: 100, missed_sla_count: 8, open_past_sla_count: 0 }),
      ],
    });

    expect(computeCategorySlaBandCounts(rollup, dicts)).toEqual({
      success: 1,
      warning: 1,
      danger: 1,
      total: 3,
      settling: 0,
    });
  });

  it('excludes immature categories from bands and counts them as settling', () => {
    const dicts: DataDictionaries = {
      ...mockDicts(),
      serviceTypes: ['Pothole', 'Tree trim'],
      categories: ['Sanitation & Dumping', 'Trees & Canopy'],
    };
    const rollup = mockRollup('2025-05', {
      sla: [
        mockSlaRow({
          serviceType: 0,
          category: 0,
          total: 100,
          met_sla_count: 99,
          missed_sla_count: 0,
          open_past_sla_count: 0,
          closed: 99,
        }),
        mockSlaRow({
          serviceType: 1,
          category: 1,
          total: 100,
          met_sla_count: 70,
          missed_sla_count: 10,
          open_past_sla_count: 10,
        }),
      ],
    });

    expect(computeCategorySlaBandCounts(rollup, dicts)).toEqual({
      success: 1,
      warning: 0,
      danger: 0,
      total: 1,
      settling: 1,
    });
  });
});

describe('computeCategoryReportingReadiness', () => {
  it('computes outcome-known share and immaturity per category', () => {
    const dicts: DataDictionaries = {
      ...mockDicts(),
      serviceTypes: ['Pothole', 'Tree trim'],
      categories: ['Sanitation & Dumping', 'Trees & Canopy'],
    };
    const rollup = mockRollup('2025-05', {
      sla: [
        mockSlaRow({
          serviceType: 0,
          category: 0,
          total: 100,
          met_sla_count: 70,
          missed_sla_count: 10,
          open_past_sla_count: 10,
        }),
        mockSlaRow({
          serviceType: 1,
          category: 1,
          total: 100,
          met_sla_count: 96,
          missed_sla_count: 2,
          open_past_sla_count: 1,
        }),
      ],
    });

    expect(computeCategoryReportingReadiness(rollup, dicts)).toEqual([
      {
        category: 'Sanitation & Dumping',
        total: 100,
        pctSlaOutcomeKnown: 90,
        immatureCohort: true,
        openWithin: 10,
      },
      {
        category: 'Trees & Canopy',
        total: 100,
        pctSlaOutcomeKnown: 99,
        immatureCohort: false,
        openWithin: 1,
      },
    ]);
  });
});

describe('computeCategorySlaBandMoMScore', () => {
  it('weights meeting gains and below losses', () => {
    const current = { success: 2, warning: 1, danger: 1, total: 4, settling: 0 };
    const prev = { success: 3, warning: 1, danger: 0, total: 4, settling: 0 };
    expect(computeCategorySlaBandMoMScore(current, prev)).toBe(-2);
  });

  it('treats slipping growth as negative', () => {
    const current = { success: 2, warning: 2, danger: 0, total: 4, settling: 0 };
    const prev = { success: 2, warning: 1, danger: 1, total: 4, settling: 0 };
    expect(computeCategorySlaBandMoMScore(current, prev)).toBe(0);
  });
});

describe('categorySlaBandMoMVerdict', () => {
  it('maps scores to five verdict bands', () => {
    expect(categorySlaBandMoMVerdict(2).label).toBe('Clear improvement');
    expect(categorySlaBandMoMVerdict(1).label).toBe('Gaining ground');
    expect(categorySlaBandMoMVerdict(0).label).toBe('Holding steady');
    expect(categorySlaBandMoMVerdict(-1).label).toBe('Losing ground');
    expect(categorySlaBandMoMVerdict(-3).label).toBe('Clear setback');
  });
});

describe('formatCategorySlaBandsScorecardKpi', () => {
  const current = { success: 2, warning: 1, danger: 1, total: 4, settling: 0 };

  it('describes the mix when no prior month exists', () => {
    expect(formatCategorySlaBandsScorecardKpi(current, null)).toEqual({
      value: '2 · 1 · 1',
      detail: '4 with SLA data',
      tone: 'default',
    });
  });

  it('summarizes a clear setback when red bands grow', () => {
    expect(formatCategorySlaBandsScorecardKpi(current, { success: 3, warning: 1, danger: 0, total: 4, settling: 0 })).toEqual({
      value: '2 · 1 · 1',
      detail: 'Clear setback vs last month',
      tone: 'danger',
    });
  });

  it('summarizes improvement when red bands shrink', () => {
    expect(formatCategorySlaBandsScorecardKpi(current, { success: 1, warning: 1, danger: 2, total: 4, settling: 0 })).toEqual({
      value: '2 · 1 · 1',
      detail: 'Clear improvement vs last month',
      tone: 'success',
    });
  });

  it('reads steady when the mix is unchanged', () => {
    expect(formatCategorySlaBandsScorecardKpi(current, current)).toEqual({
      value: '2 · 1 · 1',
      detail: 'Holding steady vs last month',
      tone: 'default',
    });
  });

  it('notes settling categories alongside MoM judgment', () => {
    expect(formatCategorySlaBandsScorecardKpi(
      { success: 2, warning: 1, danger: 1, total: 4, settling: 2 },
      { success: 3, warning: 1, danger: 0, total: 4, settling: 0 },
    )).toEqual({
      value: '2 · 1 · 1',
      detail: '2 settling · Clear setback vs last month',
      tone: 'warning',
    });
  });

  it('notes settling categories when no prior month exists', () => {
    expect(formatCategorySlaBandsScorecardKpi(
      { success: 2, warning: 1, danger: 0, total: 3, settling: 1 },
      null,
    )).toEqual({
      value: '2 · 1 · 0',
      detail: '1 settling',
      tone: 'warning',
    });
  });
});

describe('formatCategorySlaBandAccessibleSummary', () => {
  it('lists each band in plain language', () => {
    expect(formatCategorySlaBandAccessibleSummary({ success: 2, warning: 1, danger: 1, total: 4, settling: 0 }))
      .toBe('2 meeting expectations, 1 slipping, 1 below expectations');
  });

  it('includes the MoM verdict when prior counts are provided', () => {
    const current = { success: 2, warning: 1, danger: 1, total: 4, settling: 0 };
    const prev = { success: 3, warning: 1, danger: 0, total: 4, settling: 0 };
    expect(formatCategorySlaBandAccessibleSummary(current, prev))
      .toBe('2 meeting expectations, 1 slipping, 1 below expectations. Clear setback vs last month.');
  });
});

describe('detectNotables', () => {
  const dicts = mockDicts();

  it('returns empty when no prior month exists', () => {
    expect(detectNotables(mockRollup('2025-05'), null, dicts)).toEqual([]);
  });

  it('flags a category crossing below 95%', () => {
    const prev = mockRollup('2025-04', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 4, open_past_sla_count: 0 })],
    });
    const current = mockRollup('2025-05', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 8, open_past_sla_count: 0 })],
    });

    const notables = detectNotables(current, prev, dicts);

    expect(notables.some((n) => n.kind === 'sla_crossed_threshold' && n.severity === 'danger')).toBe(true);
    expect(notables[0].sentence).toContain('crossing below 95%');
  });

  it('ignores SLA drops smaller than 3 points when no threshold is crossed', () => {
    const prev = mockRollup('2025-04', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 0, open_past_sla_count: 0 })],
    });
    const current = mockRollup('2025-05', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 100, missed_sla_count: 2, open_past_sla_count: 0 })],
    });

    const notables = detectNotables(current, prev, dicts);

    expect(notables.some((n) => n.kind === 'sla_drop')).toBe(false);
  });

  it('flags volume spikes above 30% with sufficient volume', () => {
    const prev = mockRollup('2025-04', {
      categoryBreakdown: [{ c: 0, open: 10, resolved: 100 }],
      typeCounts: [{ st: 0, open: 10, resolved: 100 }],
    });
    const current = mockRollup('2025-05', {
      categoryBreakdown: [{ c: 0, open: 10, resolved: 140 }],
      typeCounts: [{ st: 0, open: 10, resolved: 140 }],
    });

    const notables = detectNotables(current, prev, dicts);

    expect(notables.some((n) => n.kind === 'volume_spike')).toBe(true);
  });

  it('flags backlog growth above 10%', () => {
    const prev = mockRollup('2025-04', {
      categoryBreakdown: [{ c: 0, open: 100, resolved: 50 }],
    });
    const current = mockRollup('2025-05', {
      categoryBreakdown: [{ c: 0, open: 120, resolved: 50 }],
    });

    const notables = detectNotables(current, prev, dicts);

    expect(notables.some((n) => n.kind === 'backlog_growth')).toBe(true);
  });

  it('returns at most four notables sorted by severity', () => {
    const prev = mockRollup('2025-04', {
      sla: [
        mockSlaRow({ serviceType: 0, category: 0, total: 200, missed_sla_count: 4, open_past_sla_count: 0 }),
        mockSlaRow({ serviceType: 1, category: 1, total: 200, missed_sla_count: 4, open_past_sla_count: 0 }),
      ],
      categoryBreakdown: [
        { c: 0, open: 50, resolved: 150 },
        { c: 1, open: 50, resolved: 150 },
      ],
      typeCounts: [
        { st: 0, open: 50, resolved: 150 },
        { st: 1, open: 50, resolved: 150 },
      ],
    });
    const current = mockRollup('2025-05', {
      sla: [
        mockSlaRow({ serviceType: 0, category: 0, total: 200, missed_sla_count: 20, open_past_sla_count: 0 }),
        mockSlaRow({ serviceType: 1, category: 1, total: 200, missed_sla_count: 20, open_past_sla_count: 0 }),
      ],
      categoryBreakdown: [
        { c: 0, open: 80, resolved: 200 },
        { c: 1, open: 80, resolved: 200 },
      ],
      typeCounts: [
        { st: 0, open: 80, resolved: 200 },
        { st: 1, open: 80, resolved: 200 },
      ],
    });

    const notables = detectNotables(current, prev, dicts);

    expect(notables.length).toBeLessThanOrEqual(4);
    expect(notables[0].severity).toBe('danger');
  });
});

describe('computeBacklogSnapshot', () => {
  it('buckets open tickets by day and computes delta', () => {
    const snapshot = computeBacklogSnapshot(
      [
        mockOpenRequest(5),
        mockOpenRequest(5),
        mockOpenRequest(20),
      ],
      2,
    );

    expect(snapshot.total).toBe(3);
    expect(snapshot.buckets.find((b) => b.label === '5')?.count).toBe(2);
    expect(snapshot.buckets.find((b) => b.label === '20')?.count).toBe(1);
    expect(snapshot.delta).toBe(1);
  });

  it('rolls tail ages into a final day+ bucket', () => {
    const snapshot = computeBacklogSnapshot([mockOpenRequest(200)], null);

    expect(snapshot.buckets.some((b) => b.label.endsWith('+'))).toBe(true);
  });
});

describe('computeCohortDisposition', () => {
  it('splits a filing month into disposition buckets', () => {
    const rollup = mockRollup('2025-05', {
      sla: [mockSlaRow({
        serviceType: 0,
        category: 0,
        total: 100,
        met_sla_count: 70,
        missed_sla_count: 10,
        open_past_sla_count: 5,
      })],
      categoryBreakdown: [{ c: 0, open: 20, resolved: 80 }],
    });

    const buckets = computeCohortDisposition(rollup);
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.count]));

    expect(byKey.met).toBe(70);
    expect(byKey.missed).toBe(10);
    expect(byKey.open_overdue).toBe(5);
    expect(byKey.open_within).toBe(15);
    expect(buckets.some((b) => b.key === 'no_sla')).toBe(false);
  });
});

describe('computeCohortSettling', () => {
  const dicts = mockDicts();

  it('builds summary and SLA comparison lines', () => {
    const rollup = mockRollup('2025-05', {
      sla: [mockSlaRow({
        serviceType: 0,
        category: 0,
        total: 100,
        met_sla_count: 70,
        missed_sla_count: 10,
        open_past_sla_count: 5,
        sla_days: 14,
      })],
      categoryBreakdown: [{ c: 0, open: 20, resolved: 80 }],
    });

    const settling = computeCohortSettling(rollup, dicts);

    expect(settling.pctClosed).toBe(80);
    expect(settling.pctOpenWithin).toBe(15);
    expect(settling.pctMetSla).toBe(85);
    expect(settling.pctMetSlaClosedOnly).toBeCloseTo(73.7, 1);
    expect(settling.summaryLine).toContain('80% closed');
    expect(settling.summaryLine).toContain('15% still within SLA');
    expect(settling.summaryLine).toContain('SLA% may shift until');
    expect(settling.slaComparisonLine).toContain('Headline 85% met SLA');
    expect(settling.slaComparisonLine).toContain('Closed-only 73.7%');
    expect(settling.slaOutcomeKnownLine).toBe('85% closed or past SLA deadline');
  });

  it('omits stability date when the cohort is fully closed', () => {
    const rollup = mockRollup('2025-05', {
      sla: [mockSlaRow({ serviceType: 0, category: 0, total: 100, open_past_sla_count: 0 })],
      categoryBreakdown: [{ c: 0, open: 0, resolved: 100 }],
    });

    const settling = computeCohortSettling(rollup, dicts);

    expect(settling.stableAfterLabel).toBeNull();
    expect(settling.summaryLine).not.toContain('SLA% may shift');
  });
});

function mockRequestOnDay(day: number, category: string, month = '2025-05'): ProcessedRequest {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, mon - 1, day, 12, 0, 0);
  return {
    ...mockOpenRequest(1, month),
    date,
    category,
  };
}

describe('computeDailyVolumeByCategory', () => {
  it('aggregates filing volume by day and category for one month', () => {
    const chart = computeDailyVolumeByCategory([
      mockRequestOnDay(1, 'Sanitation & Dumping'),
      mockRequestOnDay(1, 'Trees & Canopy'),
      mockRequestOnDay(2, 'Sanitation & Dumping'),
      mockRequestOnDay(2, 'Sanitation & Dumping'),
    ], '2025-05');

    expect(chart.dayLabels).toHaveLength(31);
    expect(chart.dayLabels[0]).toBe('May 1');
    expect(chart.traces).toHaveLength(2);
    expect(chart.traces[0].name).toBe('Sanitation & Dumping');
    expect(chart.traces[0].y[0]).toBe(1);
    expect(chart.traces[0].y[1]).toBe(2);
    expect(chart.traces[1].name).toBe('Trees & Canopy');
    expect(chart.traces[1].y[0]).toBe(1);
  });

  it('excludes rows outside the UTC filing month', () => {
    const chart = computeDailyVolumeByCategory([
      {
        ...mockOpenRequest(1, '2025-01'),
        date: new Date('2025-02-01T03:00:00.000Z'),
        category: 'Sanitation & Dumping',
      },
    ], '2025-01');

    expect(chart.traces.reduce((sum, trace) => sum + trace.y.reduce((a, b) => a + b, 0), 0)).toBe(0);
  });
});

describe('computeCumulativeResolutionCurve', () => {
  it('tracks cumulative closure by days since filing', () => {
    const curve = computeCumulativeResolutionCurve([
      mockClosedRequest(1),
      mockClosedRequest(3),
      mockClosedRequest(10),
      mockOpenRequest(5),
    ], '2025-05');

    expect(curve.days).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(curve.pctClosed[0]).toBe(0);
    expect(curve.pctClosed[1]).toBe(25);
    expect(curve.pctClosed[3]).toBe(50);
    expect(curve.pctClosed[5]).toBe(50);
    expect(curve.pctClosed[10]).toBe(75);
  });

  it('returns empty series when no cohort rows match', () => {
    expect(computeCumulativeResolutionCurve([], '2025-05')).toEqual({ days: [], pctClosed: [] });
  });
});

describe('computeCohortFlow', () => {
  const fullWindowAsOf = new Date(Date.UTC(2026, 0, 1));

  it('tracks cumulative resolved and open totals on calendar days', () => {
    const filedDate = new Date(Date.UTC(2025, 4, 15));
    const chart = computeCohortFlow([
      {
        ...mockClosedRequest(1, '2025-05'),
        date: filedDate,
      },
      {
        ...mockClosedRequest(3, '2025-05'),
        date: filedDate,
      },
      {
        ...mockOpenRequest(5, '2025-05'),
        date: filedDate,
      },
      {
        ...mockClosedRequest(2, '2025-05'),
        date: filedDate,
        category: 'Trees & Canopy',
      },
    ], '2025-05', fullWindowAsOf);

    expect(chart.hasData).toBe(true);
    expect(chart.dayLabels).toHaveLength(31 + 120);
    expect(chart.traces).toHaveLength(3);
    expect(chart.traces[0].name).toBe('Resolved');
    expect(chart.traces[1].name).toBe('Open within SLA');
    expect(chart.traces[2].name).toBe('Open past SLA');

    const day15Idx = 14;
    expect(chart.traces[0].y[day15Idx]).toBe(0);
    expect(chart.traces[1].y[day15Idx]).toBe(4);
    expect(chart.traces[2].y[day15Idx]).toBe(0);
    expect(chart.traces[0].customdata[day15Idx]).toBe(0);
    expect(chart.traces[1].customdata[day15Idx]).toBe(100);
    expect(chart.traces[0].y[day15Idx + 1]).toBe(1);
    expect(chart.traces[1].y[day15Idx + 1]).toBe(3);
    expect(chart.traces[2].y[day15Idx + 1]).toBe(0);
    expect(chart.traces[0].customdata[day15Idx + 1]).toBe(25);
    expect(chart.traces[1].customdata[day15Idx + 1]).toBe(75);
    expect(chart.traces[0].y[day15Idx + 3]).toBe(3);
    expect(chart.traces[1].y[day15Idx + 3]).toBe(1);
    expect(chart.traces[2].y[day15Idx + 3]).toBe(0);
    expect(chart.traces[0].customdata[day15Idx + 3]).toBe(75);
    expect(chart.traces[1].customdata[day15Idx + 3]).toBe(25);
  });

  it('tracks open past SLA separately from open within SLA', () => {
    const filedDate = new Date(Date.UTC(2025, 4, 15));
    const asOf = new Date(Date.UTC(2025, 4, 20));
    const chart = computeCohortFlow([
      {
        ...mockOpenRequest(5, '2025-05'),
        date: filedDate,
        SERVICEDUEDATE: '2025-05-17 12:00:00 UTC',
      },
    ], '2025-05', asOf);

    const withinIdx = chart.dayLabels.indexOf('May 17');
    const pastIdx = chart.dayLabels.indexOf('May 18');

    expect(chart.traces[1].y[withinIdx]).toBe(1);
    expect(chart.traces[2].y[withinIdx]).toBe(0);
    expect(chart.traces[1].y[pastIdx]).toBe(0);
    expect(chart.traces[2].y[pastIdx]).toBe(1);
  });

  it('counts resolutions during the post-month follow-up window', () => {
    const filedDate = new Date(Date.UTC(2025, 4, 15));
    const chart = computeCohortFlow([
      {
        ...mockClosedRequest(30, '2025-05'),
        date: filedDate,
        RESOLUTIONDATE: '2025-06-14 12:00:00 UTC',
      },
    ], '2025-05', fullWindowAsOf);

    const resolved = chart.traces[0];
    const monthEndIdx = 30;
    const followUpIdx = chart.dayLabels.indexOf('Jun 14');

    expect(followUpIdx).toBeGreaterThan(monthEndIdx);
    expect(resolved.y[monthEndIdx]).toBe(0);
    expect(resolved.y[followUpIdx]).toBe(1);
    expect(resolved.customdata[followUpIdx]).toBe(100);
  });

  it('stops at asOf and treats post-asOf closures as still open', () => {
    const filedDate = new Date(Date.UTC(2025, 4, 15));
    const asOf = new Date(Date.UTC(2025, 4, 17));
    const chart = computeCohortFlow([
      { ...mockClosedRequest(1, '2025-05'), date: filedDate },
      { ...mockClosedRequest(10, '2025-05'), date: filedDate },
    ], '2025-05', asOf);

    expect(chart.dayLabels).toHaveLength(17);
    expect(chart.traces[0].y[16]).toBe(1);
    expect(chart.traces[1].y[16]).toBe(1);
    expect(chart.traces[2].y[16]).toBe(0);
  });

  it('returns empty traces when no cohort rows match', () => {
    expect(computeCohortFlow([], '2025-05', fullWindowAsOf)).toEqual({
      dayLabels: expect.any(Array),
      xTickVals: expect.any(Array),
      xTickText: expect.any(Array),
      traces: [],
      hasData: false,
    });
  });
});

describe('formatSlaScorecardKpi', () => {
  it('describes this-month SLA performance, not MoM', () => {
    expect(formatSlaScorecardKpi(99)).toEqual({
      value: '99%',
      detail: 'Meeting expectations',
      tone: 'success',
    });
    expect(formatSlaScorecardKpi(96.3)).toEqual({
      value: '96.3%',
      detail: 'Slipping below expectations',
      tone: 'warning',
    });
    expect(formatSlaScorecardKpi(85)).toEqual({
      value: '85%',
      detail: 'Well below expectations',
      tone: 'danger',
    });
  });

  it('defers the verdict while the cohort is still settling', () => {
    expect(formatSlaScorecardKpi(99, true)).toEqual({
      value: '99%',
      detail: 'Data still settling',
      tone: 'warning',
    });
  });
});

describe('formatResolvedScorecardKpi', () => {
  it('shows percent resolved with a this-month count breakdown', () => {
    expect(formatResolvedScorecardKpi(12946, 19407, true)).toEqual({
      value: '66.7%',
      detail: '12,946 closed · within SLA window',
      tone: 'warning',
    });
  });

  it('flags provisional cohorts when still within SLA window', () => {
    expect(formatResolvedScorecardKpi(50, 100, true)).toEqual({
      value: '50%',
      detail: '50 closed · within SLA window',
      tone: 'warning',
    });
    expect(formatResolvedScorecardKpi(75, 100, false)).toEqual({
      value: '75%',
      detail: '75 closed',
      tone: 'default',
    });
  });

  it('handles zero filings', () => {
    expect(formatResolvedScorecardKpi(0, 0)).toEqual({
      value: '0%',
      detail: 'No filings this month',
      tone: 'default',
    });
  });
});

describe('formatFiledScorecardKpi', () => {
  it('shows resolution progress for the filing cohort', () => {
    expect(formatFiledScorecardKpi(40966, 32000)).toEqual({
      value: '40,966',
      detail: '78.1% resolved, 8,966 left to go',
      tone: 'default',
    });
  });

  it('handles zero filings', () => {
    expect(formatFiledScorecardKpi(0, 0)).toEqual({
      value: '0',
      detail: 'No filings this month',
      tone: 'default',
    });
  });
});

describe('formatScorecardKpi', () => {
  it('writes volume comparisons without good/bad coloring', () => {
    expect(formatScorecardKpi('19,407', { absolute: -22814, direction: 'down', formatted: '-22814' }, 'filed')).toEqual({
      value: '19,407',
      detail: '22,814 fewer filed than last month',
      tone: 'default',
    });
  });

  it('writes median resolution comparisons', () => {
    expect(formatScorecardKpi('1.9d', { absolute: -3, direction: 'down', formatted: '-3d' }, 'median')).toEqual({
      value: '1.9d',
      detail: '3 days faster than last month',
      tone: 'success',
    });
  });

  it('handles flat or missing deltas', () => {
    expect(formatScorecardKpi('19,407', { absolute: 0, direction: 'flat', formatted: '0' }, 'filed')).toEqual({
      value: '19,407',
      detail: 'Unchanged from last month',
      tone: 'default',
    });
    expect(formatScorecardKpi('19,407', null, 'filed')).toEqual({ value: '19,407', detail: null, tone: 'default' });
  });
});
