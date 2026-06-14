import { describe, expect, it } from 'vitest';
import {
  buildCategoryArticle,
  computeCherryPickSensitivity,
  computeCategoryMonthlySlaSummary,
  computeCategoryMonthlySlaFromRollups,
  computeMonthlySlaSummary,
  computeOverviewHeadline,
  findSloPitfalls,
  orderCategoryMonthlySla,
  selectComplianceComparisonCases,
  selectPerceptibilityChartCategories,
  slaVerdictLabel,
  slaScoreColor,
  slaTone,
} from './overviewAnalytics';
import { colors } from './theme';
import { ProcessedRequest, SLARow } from './dataProcessing';
import { RollupFile } from '../api/dataTypes';

function mockProcessedRequest(overrides: Partial<ProcessedRequest>): ProcessedRequest {
  return {
    SERVICEREQUESTID: '1',
    ADDDATE: '2025-04-15',
    RESOLUTIONDATE: '2025-04-20',
    SERVICEDUEDATE: '2025-04-25',
    SERVICEORDERDATE: null,
    INSPECTIONDATE: null,
    CREATED: null,
    EDITED: null,
    SERVICECODE: 0,
    SERVICECODEDESCRIPTION: 'Pothole',
    SERVICETYPECODEDESCRIPTION: null,
    ORGANIZATIONACRONYM: 'DDOT',
    SERVICEORDERSTATUS: 'Closed',
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
    category: 'Roads & Vehicle Infrastructure',
    is_open: false,
    is_closed: true,
    age_days: 5,
    resolution_days: 5,
    age_bucket: '< 1 week',
    ...overrides,
  };
}

function mockRollup(month: string, overrides: Partial<{
  total: number;
  closed: number;
  met: number;
  missed: number;
  overdue: number;
  open: number;
  resolved: number;
}>): RollupFile {
  const total = overrides.total ?? 100;
  const closed = overrides.closed ?? 80;
  const met = overrides.met ?? 70;
  const missed = overrides.missed ?? 5;
  const overdue = overrides.overdue ?? 3;
  const open = overrides.open ?? 20;
  const resolved = overrides.resolved ?? 80;

  return {
    month,
    sla: [{
      serviceType: 0,
      category: 0,
      agency: 0,
      sla_days: 7,
      total,
      closed,
      met_sla_count: met,
      missed_sla_count: missed,
      open_past_sla_count: overdue,
      median_resolution: 3,
      p99_resolution: 10,
      pct_resolved: (closed / total) * 100,
      pct_met_sla: ((total - missed - overdue) / total) * 100,
    }],
    explorer: {
      categoryBreakdown: [{ c: 0, open, resolved }],
      dayOfWeek: [],
      wardVolume: [],
      typeCounts: [{ st: 0, open, resolved }],
      weeklyVolume: [],
    },
  };
}

describe('slaTone', () => {
  it('maps thresholds to success, warning, danger', () => {
    expect(slaTone(99)).toBe('success');
    expect(slaTone(95)).toBe('warning');
    expect(slaTone(94.9)).toBe('danger');
  });
});

describe('slaVerdictLabel', () => {
  it('maps SLO bands to plain-language verdicts', () => {
    expect(slaVerdictLabel(99)).toEqual({ label: 'Meeting expectations', tone: 'success' });
    expect(slaVerdictLabel(95)).toEqual({ label: 'Slipping below expectations', tone: 'warning' });
    expect(slaVerdictLabel(85)).toEqual({ label: 'Well below expectations', tone: 'danger' });
    expect(slaVerdictLabel(70)).toEqual({ label: 'Critically below expectations', tone: 'danger' });
  });

  it('switches verdicts at 99%, 95%, and 80% boundaries', () => {
    expect(slaVerdictLabel(98.9).label).toBe('Slipping below expectations');
    expect(slaVerdictLabel(94.9).label).toBe('Well below expectations');
    expect(slaVerdictLabel(79.9).label).toBe('Critically below expectations');
  });
});

describe('slaScoreColor', () => {
  it('maps thresholds to success, warning, and severity gradient', () => {
    expect(slaScoreColor(99)).toBe(colors.success);
    expect(slaScoreColor(95)).toBe(colors.warning);
    expect(slaScoreColor(94.9)).toBe(colors.danger);
    expect(slaScoreColor(50)).toBe('#4e1e19');
    expect(slaScoreColor(30)).toBe(colors.primaryDeep);
    expect(slaScoreColor(20)).toBe(colors.primaryDeep);
  });
});

describe('computeMonthlySlaSummary', () => {
  it('aggregates per-month compliance and flags immature cohorts', () => {
    const months = computeMonthlySlaSummary([
      mockRollup('2025-06', { total: 100, missed: 2, overdue: 1, open: 10, resolved: 90 }),
      mockRollup('2025-07', { total: 100, missed: 10, overdue: 5, open: 50, resolved: 50 }),
    ]);

    expect(months).toHaveLength(2);
    expect(months[0].pctMetSla).toBe(97);
    expect(months[0].immatureCohort).toBe(false);
    expect(months[1].immatureCohort).toBe(true);
  });
});

describe('computeCategoryMonthlySlaFromRollups', () => {
  it('aggregates filing-month SLA compliance by category from rollups', () => {
    const dicts = {
      serviceTypes: ['Pothole', 'Bus stop'],
      categories: ['Roads & Vehicle Infrastructure', 'Transit'],
      agencies: ['DDOT'],
      statuses: [],
      wards: [],
      dayOfWeek: [],
      ageBuckets: [],
      zipcodes: [],
      cities: [],
      states: [],
      serviceTypeCodes: [],
      serviceCodes: [],
      priorities: [],
    };

    const rows = computeCategoryMonthlySlaFromRollups([
      {
        month: '2025-06',
        sla: [{
          serviceType: 0,
          category: 0,
          agency: 0,
          sla_days: 7,
          total: 10,
          closed: 8,
          met_sla_count: 8,
          missed_sla_count: 2,
          open_past_sla_count: 0,
          median_resolution: 3,
          p99_resolution: 10,
          pct_resolved: 80,
          pct_met_sla: 80,
        }],
        explorer: {
          categoryBreakdown: [{ c: 0, open: 2, resolved: 8 }],
          dayOfWeek: [],
          wardVolume: [],
          typeCounts: [],
          weeklyVolume: [],
        },
      },
    ], dicts, new Set(['Pothole']));

    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('Roads & Vehicle Infrastructure');
    expect(rows[0].months[0].pctMetSla).toBe(80);
    expect(rows[0].months[0].failures).toBe(2);
  });
});

describe('computeCategoryMonthlySlaSummary', () => {
  it('groups filing-month SLA compliance by category', () => {
    const requests: ProcessedRequest[] = [
      mockProcessedRequest({
        SERVICEREQUESTID: '1',
        SERVICECODEDESCRIPTION: 'Pothole',
        category: 'Roads & Vehicle Infrastructure',
      }),
      mockProcessedRequest({
        SERVICEREQUESTID: '2',
        ADDDATE: '2025-05-10',
        RESOLUTIONDATE: null,
        SERVICEDUEDATE: '2025-05-12',
        SERVICECODEDESCRIPTION: 'Bus stop',
        ORGANIZATIONACRONYM: 'WMATA',
        SERVICEORDERSTATUS: 'Open',
        STREETADDRESS: '2 St',
        WARD: '2',
        date: new Date(2025, 4, 10),
        week: new Date(2025, 4, 4),
        hour: 9,
        dayOfWeek: 'Saturday',
        category: 'Transit',
        is_open: true,
        is_closed: false,
        age_days: 20,
        resolution_days: null,
        age_bucket: '1–4 weeks',
      }),
    ];

    const rows = computeCategoryMonthlySlaSummary(requests);
    expect(rows).toHaveLength(2);
    expect(rows[0].months).toHaveLength(2);
    expect(rows.find((r) => r.category === 'Transit')?.months[1].failures).toBe(1);
  });
});

describe('computeOverviewHeadline', () => {
  it('sums across months for full-year KPIs', () => {
    const headline = computeOverviewHeadline([
      mockRollup('2025-06', { total: 200, missed: 4, overdue: 2, open: 20, resolved: 180 }),
      mockRollup('2025-07', { total: 300, missed: 6, overdue: 3, open: 30, resolved: 270 }),
    ]);

    expect(headline.total).toBe(500);
    expect(headline.failures).toBe(15);
    expect(headline.errorBudgetAt99).toBe(5);
  });
});

describe('selectPerceptibilityChartCategories', () => {
  it('picks high performers and struggling resident-facing categories', () => {
    const catSummary = [
      { category: 'Sanitation & Dumping', pct_met_sla: 99.5, total: 50000, missed: 0, overdue: 0, good: 50000 },
      { category: 'City Services & Info', pct_met_sla: 99.2, total: 30000, missed: 0, overdue: 0, good: 30000 },
      { category: 'Pedestrian Infrastructure', pct_met_sla: 92, total: 8000, missed: 500, overdue: 140, good: 7360 },
      { category: 'Transit', pct_met_sla: 88, total: 4000, missed: 300, overdue: 180, good: 3520 },
      { category: 'Public Space & Parks', pct_met_sla: 90, total: 3500, missed: 200, overdue: 150, good: 3150 },
      { category: 'Traffic Safety', pct_met_sla: 97, total: 2000, missed: 40, overdue: 20, good: 1940 },
      { category: 'Cycling & Micromobility', pct_met_sla: 99.8, total: 1000, missed: 0, overdue: 0, good: 1000 },
      { category: 'Roads & Vehicle Infrastructure', pct_met_sla: 85, total: 12000, missed: 1000, overdue: 800, good: 10200 },
    ];

    const selected = selectPerceptibilityChartCategories(catSummary);
    expect(selected.slice(0, 2)).toEqual(['Sanitation & Dumping', 'City Services & Info']);
    expect(selected).toContain('Pedestrian Infrastructure');
    expect(selected).toContain('Public Space & Parks');
    expect(selected).not.toContain('Transit');
    expect(selected).not.toContain('Roads & Vehicle Infrastructure');
    expect(selected).not.toContain('Cycling & Micromobility');
  });
});

describe('orderCategoryMonthlySla', () => {
  it('preserves the requested category order', () => {
    const rows = [
      { category: 'Transit', months: [] },
      { category: 'Sanitation & Waste', months: [] },
    ];
    expect(orderCategoryMonthlySla(rows, ['Sanitation & Waste', 'Transit']).map((r) => r.category)).toEqual([
      'Sanitation & Waste',
      'Transit',
    ]);
  });
});

describe('selectComplianceComparisonCases', () => {
  it('returns misleading divergences and aligned comparators', () => {
    const cases = selectComplianceComparisonCases([
      {
        SERVICECODEDESCRIPTION: 'Masking Type',
        category: 'Transit',
        agency: 'DDOT',
        sla_days: 7,
        total: 200,
        closed: 50,
        met_sla_count: 50,
        missed_sla_count: 0,
        open_past_sla_count: 0,
        median_resolution: 4,
        p99_resolution: 8,
        pct_resolved: 25,
        pct_met_sla: 100,
      },
      {
        SERVICECODEDESCRIPTION: 'Honest Type',
        category: 'Sanitation & Dumping',
        agency: 'DPW',
        sla_days: 3,
        total: 500,
        closed: 480,
        met_sla_count: 470,
        missed_sla_count: 10,
        open_past_sla_count: 0,
        median_resolution: 2,
        p99_resolution: 5,
        pct_resolved: 96,
        pct_met_sla: 94,
      },
    ]);

    expect(cases.some((c) => c.kind === 'misleading' && c.serviceType === 'Masking Type')).toBe(true);
    expect(cases.some((c) => c.kind === 'aligned' && c.serviceType === 'Honest Type')).toBe(true);
    expect(cases.find((c) => c.serviceType === 'Masking Type')?.pctMetSlaClosedOnly).toBe(100);
  });

  it('excludes service types with misleading SLA structure', () => {
    const cases = selectComplianceComparisonCases([
      {
        SERVICECODEDESCRIPTION: 'Roadway Repair',
        category: 'Roads & Vehicle Infrastructure',
        agency: 'DDOT',
        sla_days: 386,
        total: 5000,
        closed: 500,
        met_sla_count: 500,
        missed_sla_count: 0,
        open_past_sla_count: 0,
        median_resolution: 90,
        p99_resolution: 200,
        pct_resolved: 10,
        pct_met_sla: 100,
      },
      {
        SERVICECODEDESCRIPTION: 'Honest Type',
        category: 'Sanitation & Dumping',
        agency: 'DPW',
        sla_days: 3,
        total: 500,
        closed: 480,
        met_sla_count: 470,
        missed_sla_count: 10,
        open_past_sla_count: 0,
        median_resolution: 2,
        p99_resolution: 5,
        pct_resolved: 96,
        pct_met_sla: 94,
      },
    ]);

    expect(cases.some((c) => c.serviceType === 'Roadway Repair')).toBe(false);
  });

  it('returns at most six cases, prioritizing misleading divergences', () => {
    const rows: SLARow[] = Array.from({ length: 10 }, (_, i) => ({
      SERVICECODEDESCRIPTION: `Misleading ${i}`,
      category: 'Transit',
      agency: 'DDOT',
      sla_days: 7,
      total: 1000 - i,
      closed: 200,
      met_sla_count: 200,
      missed_sla_count: 0,
      open_past_sla_count: 0,
      median_resolution: 4,
      p99_resolution: 8,
      pct_resolved: 20,
      pct_met_sla: 100,
    }));

    rows.push({
      SERVICECODEDESCRIPTION: 'Aligned Type',
      category: 'Sanitation & Dumping',
      agency: 'DPW',
      sla_days: 3,
      total: 500,
      closed: 480,
      met_sla_count: 470,
      missed_sla_count: 10,
      open_past_sla_count: 0,
      median_resolution: 2,
      p99_resolution: 5,
      pct_resolved: 96,
      pct_met_sla: 94,
    });

    const cases = selectComplianceComparisonCases(rows);
    expect(cases).toHaveLength(6);
    expect(cases.every((c) => c.kind === 'misleading')).toBe(true);
  });
});

describe('findSloPitfalls', () => {
  it('detects lax SLA and open-ticket masking', () => {
    const pitfalls = findSloPitfalls([
      {
        SERVICECODEDESCRIPTION: 'Long SLA Type',
        category: 'City Services & Info',
        agency: 'DGS',
        sla_days: 200,
        total: 100,
        closed: 10,
        met_sla_count: 10,
        missed_sla_count: 0,
        open_past_sla_count: 0,
        median_resolution: 5,
        p99_resolution: 10,
        pct_resolved: 10,
        pct_met_sla: 100,
      },
      {
        SERVICECODEDESCRIPTION: 'Masking Type',
        category: 'Transit',
        agency: 'DDOT',
        sla_days: 7,
        total: 200,
        closed: 50,
        met_sla_count: 50,
        missed_sla_count: 0,
        open_past_sla_count: 0,
        median_resolution: 4,
        p99_resolution: 8,
        pct_resolved: 25,
        pct_met_sla: 100,
      },
    ]);

    expect(pitfalls.some((p) => p.reason === 'lax_sla')).toBe(true);
    expect(pitfalls.some((p) => p.reason === 'open_masking')).toBe(true);
  });
});

describe('computeCherryPickSensitivity', () => {
  it('computes headline vs without-top-3 delta', () => {
    const result = computeCherryPickSensitivity([
      {
        SERVICECODEDESCRIPTION: 'Big A',
        category: 'A',
        agency: '',
        sla_days: 1,
        total: 1000,
        closed: 1000,
        met_sla_count: 990,
        missed_sla_count: 10,
        open_past_sla_count: 0,
        median_resolution: 0,
        p99_resolution: 0,
        pct_resolved: 100,
        pct_met_sla: 99,
      },
      {
        SERVICECODEDESCRIPTION: 'Big B',
        category: 'A',
        agency: '',
        sla_days: 1,
        total: 800,
        closed: 800,
        met_sla_count: 792,
        missed_sla_count: 8,
        open_past_sla_count: 0,
        median_resolution: 0,
        p99_resolution: 0,
        pct_resolved: 100,
        pct_met_sla: 99,
      },
      {
        SERVICECODEDESCRIPTION: 'Big C',
        category: 'A',
        agency: '',
        sla_days: 1,
        total: 600,
        closed: 600,
        met_sla_count: 594,
        missed_sla_count: 6,
        open_past_sla_count: 0,
        median_resolution: 0,
        p99_resolution: 0,
        pct_resolved: 100,
        pct_met_sla: 99,
      },
      {
        SERVICECODEDESCRIPTION: 'Small Bad',
        category: 'B',
        agency: '',
        sla_days: 7,
        total: 100,
        closed: 100,
        met_sla_count: 50,
        missed_sla_count: 50,
        open_past_sla_count: 0,
        median_resolution: 10,
        p99_resolution: 20,
        pct_resolved: 100,
        pct_met_sla: 50,
      },
    ]);

    expect(result.headlinePct).toBeGreaterThan(result.withoutTop3Pct);
    expect(result.top3Types).toContain('Big A');
  });

  it('buildCategoryDek uses full category counts, not top-3 highlight slice', () => {
    const catSummary = [
      { category: 'City Services', total: 1000, missed: 0, overdue: 0, good: 1000, pct_met_sla: 100 },
      { category: 'Environment', total: 100, missed: 0, overdue: 0, good: 100, pct_met_sla: 100 },
      { category: 'Trees', total: 5000, missed: 100, overdue: 80, good: 4820, pct_met_sla: 96.4 },
      { category: 'Sanitation', total: 80000, missed: 15000, overdue: 8000, good: 57000, pct_met_sla: 71.3 },
      { category: 'Traffic', total: 10000, missed: 500, overdue: 300, good: 9200, pct_met_sla: 92 },
    ];

    const article = buildCategoryArticle(catSummary, [], null);

    expect(article.dek).toBe(
      'Only 2 of 5 categories clear the 99% target. 2 fall below 95%, often where volume and backlog collide.',
    );
    expect(article.paragraphs.flat().map((p) => p.text).join(' ')).toMatch(/Only .* clear the 99% target/);
  });
});
