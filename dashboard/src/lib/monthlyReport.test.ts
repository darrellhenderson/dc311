import { describe, expect, it, vi, afterEach } from 'vitest';
import { DataDictionaries, DataShardMeta, RollupFile, SlaRollupRow } from '../api/dataTypes';
import { ProcessedRequest } from './dataProcessing';
import {
  computeBacklogSnapshot,
  computeCategorySlaForMonth,
  computeMonthlyScorecard,
  detectNotables,
  findPrevMonth,
  findYoyMonth,
  formatKpiWithDelta,
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

function mockOpenRequest(ageBucket: string): ProcessedRequest {
  return {
    SERVICEREQUESTID: '1',
    ADDDATE: '2025-04-15',
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
    date: new Date(2025, 3, 15),
    week: new Date(2025, 3, 14),
    hour: 12,
    dayOfWeek: 'Tuesday',
    category: 'Sanitation & Dumping',
    is_open: true,
    is_closed: false,
    age_days: 5,
    resolution_days: null,
    age_bucket: ageBucket,
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
    expect(scorecard.totalFiled).toBe(100);
    expect(scorecard.totalResolved).toBe(80);
    expect(scorecard.netBacklogChange).toBe(20);
    expect(scorecard.medianResolutionDays).toBe(3);
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
  const labels = ['< 1 week', '1–4 weeks', '1–2 months', '2–3 months'];

  it('buckets open tickets by age and computes delta', () => {
    const snapshot = computeBacklogSnapshot(
      [
        mockOpenRequest('< 1 week'),
        mockOpenRequest('< 1 week'),
        mockOpenRequest('1–4 weeks'),
      ],
      2,
      labels,
    );

    expect(snapshot.total).toBe(3);
    expect(snapshot.buckets[0].count).toBe(2);
    expect(snapshot.buckets[1].count).toBe(1);
    expect(snapshot.delta).toBe(1);
  });
});

describe('formatKpiWithDelta', () => {
  it('marks SLA increases as success and decreases as danger', () => {
    expect(formatKpiWithDelta('96%', { absolute: 1.2, direction: 'up', formatted: '+1.2 pts' }, 'up')).toEqual({
      value: '96% ▲ +1.2 pts',
      tone: 'success',
    });
    expect(formatKpiWithDelta('96%', { absolute: -2, direction: 'down', formatted: '-2 pts' }, 'up')).toEqual({
      value: '96% ▼ -2 pts',
      tone: 'danger',
    });
  });

  it('marks median resolution decreases as success', () => {
    expect(formatKpiWithDelta('5d', { absolute: -1, direction: 'down', formatted: '-1d' }, 'down')).toEqual({
      value: '5d ▼ -1d',
      tone: 'success',
    });
  });

  it('returns default tone when delta is flat or missing', () => {
    expect(formatKpiWithDelta('96%', { absolute: 0, direction: 'flat', formatted: '0' }, 'up')).toEqual({
      value: '96%',
      tone: 'default',
    });
    expect(formatKpiWithDelta('96%', null, 'up')).toEqual({ value: '96%', tone: 'default' });
  });
});
