import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  buildSharePathContent,
  formatWardGapHero,
  isGenerousDeadline,
  isSlowerWardGap,
  resolveSharePath,
  selectSharePath,
  SHARE_PATH_THRESHOLDS,
  truncateServiceType,
  validateSharePathCoherence,
} from './sharePaths';
import { EstimateResult } from './estimateData';

const baseEstimate = (
  overrides: Partial<EstimateResult> = {},
): EstimateResult => ({
  n: 100,
  p25: 3,
  p50: 5,
  p75: 7,
  p90: 14,
  sla_days: 21,
  pct_met_sla: 94,
  ...overrides,
});

describe('truncateServiceType', () => {
  it('returns short names unchanged', () => {
    expect(truncateServiceType('Pothole')).toBe('Pothole');
  });

  it('truncates at a word boundary when possible', () => {
    const long = 'Lost/Stolen Compost Bin, Broken Compost Bin or Opt-Out';
    const result = truncateServiceType(long);
    expect(result.endsWith('\u2026')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(39);
    expect(result).not.toMatch(/Opt-\u2026$/);
  });
});

describe('isSlowerWardGap', () => {
  it('returns true when ward is 1.5x slower with 3+ day gap', () => {
    expect(isSlowerWardGap(15, 5)).toBe(true);
  });

  it('returns false for faster wards', () => {
    expect(isSlowerWardGap(2, 10)).toBe(false);
  });
});

describe('selectSharePath priority', () => {
  const citywide = baseEstimate({ p50: 5 });

  it('prefers ward_gap for slower wards', () => {
    const ward = baseEstimate({ p50: 14, p25: 10, p75: 18 });
    expect(selectSharePath({
      serviceType: 'Pothole',
      ward: 'Ward 7',
      estimate: ward,
      citywideEstimate: citywide,
    }).id).toBe('ward_gap');
  });

  it('does not use ward_gap for faster wards', () => {
    const ward = baseEstimate({ p50: 2, p25: 1, p75: 3, pct_met_sla: 96 });
    expect(selectSharePath({
      serviceType: 'Pothole',
      ward: 'Ward 2',
      estimate: ward,
      citywideEstimate: citywide,
    }).id).not.toBe('ward_gap');
  });

  it('prefers promise_broken over generous_deadline', () => {
    const estimate = baseEstimate({ p50: 45, pct_met_sla: 40, sla_days: 389 });
    expect(selectSharePath({
      serviceType: 'Roadway Repair',
      ward: null,
      estimate,
      citywideEstimate: null,
    }).id).toBe('promise_broken');
  });

  it('classifies generous_deadline when SLA is far out, regardless of median wait', () => {
    const longWaitEstimate = baseEstimate({
      p25: 21, p50: 46, p75: 80, pct_met_sla: 100, sla_days: 389,
    });
    expect(isGenerousDeadline(longWaitEstimate)).toBe(true);
    expect(selectSharePath({
      serviceType: 'Roadway Repair',
      ward: null,
      estimate: longWaitEstimate,
      citywideEstimate: null,
    }).id).toBe('generous_deadline');
  });

  it('classifies generous_deadline for long SLA even when compliance is modest', () => {
    const estimate = baseEstimate({
      p25: 1, p50: 2.7, p75: 7, pct_met_sla: 88.3, sla_days: 259,
    });
    expect(isGenerousDeadline(estimate)).toBe(true);
    const content = resolveSharePath({
      serviceType: 'Tree Pruning',
      ward: 'Ward 6',
      estimate,
      citywideEstimate: baseEstimate({ p50: 5.2 }),
    });
    expect(content.id).toBe('generous_deadline');
    expect(content.layout).toBe('compliance');
    expect(content.sentenceLead).toBe('Tree Pruning requests met the deadline');
    expect(content.heroPrimary).toBe('88% of the time.');
    expect(content.supportLine).toBe('The city gave itself 259 days.');
    expect(content.shareLine).toBe(
      'Tree Pruning requests met the deadline 88% of the time. The city gave itself 259 days.',
    );
  });

  it('formats generous_deadline with compliance copy when typical wait is fast', () => {
    const content = resolveSharePath({
      serviceType: 'Tree Planting',
      ward: null,
      estimate: baseEstimate({
        p25: 1, p50: 2, p75: 20, pct_met_sla: 100, sla_days: 710,
      }),
      citywideEstimate: null,
    });
    expect(content.id).toBe('generous_deadline');
    expect(content.layout).toBe('compliance');
    expect(content.sentenceLead).toBe('Tree Planting requests met the deadline');
    expect(content.heroPrimary).toBe('100% of the time.');
    expect(content.supportLine).toBe('The deadline is over 2 years.');
  });

  it('formats generous_deadline read-aloud copy when typical wait is slow', () => {
    const content = resolveSharePath({
      serviceType: 'Roadway Repair',
      ward: null,
      estimate: baseEstimate({
        p25: 21, p50: 46, p75: 80, pct_met_sla: 100, sla_days: 389,
      }),
      citywideEstimate: null,
    });
    expect(content.id).toBe('generous_deadline');
    expect(content.layout).toBe('range');
    expect(content.sentenceLead).toBe('Roadway Repair usually takes');
    expect(content.heroPrimary).toBe('21–80 days.');
    expect(content.supportLine).toBe(
      'Easy to hit 100% of your deadlines if you give yourself over a year.',
    );
    expect(content.shareLine).toBe(
      'Roadway Repair usually takes 21–80 days. Easy to hit 100% of your deadlines if you give yourself over a year.',
    );
  });

  it('prefers generous_deadline over long_wait', () => {
    const estimate = baseEstimate({ p50: 45, pct_met_sla: 96, sla_days: 120 });
    expect(selectSharePath({
      serviceType: 'Tree Removal',
      ward: null,
      estimate,
      citywideEstimate: null,
    }).id).toBe('generous_deadline');
  });

  it('classifies 79% SLA as promise_broken and 80% as perceptibly_slow', () => {
    const broken = baseEstimate({ pct_met_sla: 79 });
    const slow = baseEstimate({ pct_met_sla: 80 });
    expect(selectSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: broken,
      citywideEstimate: null,
    }).id).toBe('promise_broken');
    expect(selectSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: slow,
      citywideEstimate: null,
    }).id).toBe('perceptibly_slow');
  });

  it('classifies 94% as perceptibly_slow, 96% as delays_common, 99% as reliable', () => {
    const slow = baseEstimate({ pct_met_sla: 94 });
    const delays = baseEstimate({ pct_met_sla: 96 });
    const reliable = baseEstimate({ pct_met_sla: 99 });
    expect(selectSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: slow,
      citywideEstimate: null,
    }).id).toBe('perceptibly_slow');
    expect(selectSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: delays,
      citywideEstimate: null,
    }).id).toBe('delays_common');
    expect(selectSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: reliable,
      citywideEstimate: null,
    }).id).toBe('reliable');
  });

  it('uses soft support for delays_common from 95% up', () => {
    for (const pct of [95, 96, 98]) {
      const content = resolveSharePath({
        serviceType: 'Alley Cleaning',
        ward: 'Ward 2',
        estimate: baseEstimate({ pct_met_sla: pct }),
        citywideEstimate: null,
      });
      expect(content.id).toBe('delays_common');
      expect(content.supportLine).toBe('Perceptibly close \u2014 not quite perfect.');
    }
  });

  it('uses disappointed support for perceptibly_slow below 95%', () => {
    const at94 = resolveSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 94 }),
      citywideEstimate: null,
    });
    expect(at94.id).toBe('perceptibly_slow');
    expect(at94.supportLine).toBe('Usually fine on a 21-day deadline \u2014 until you are in the 6%.');

    const at88 = resolveSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 88 }),
      citywideEstimate: null,
    });
    expect(at88.supportLine).toBe('Sounds okay, but why set a deadline if you are not going to meet it?');

    const at82 = resolveSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 82 }),
      citywideEstimate: null,
    });
    expect(at82.supportLine).toBe('That\u2019s not good enough.');
  });

  it('uses compliance layout for perceptibly_slow and delays_common', () => {
    const slow = resolveSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 88 }),
      citywideEstimate: null,
    });
    expect(slow.id).toBe('perceptibly_slow');
    expect(slow.layout).toBe('compliance');
    expect(slow.sentenceLead).toBe('Pothole requests met the deadline');
    expect(slow.heroPrimary).toBe('88% of the time.');
    expect(slow.supportLine).toBe('Sounds okay, but why set a deadline if you are not going to meet it?');

    const delays = resolveSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 96 }),
      citywideEstimate: null,
    });
    expect(delays.id).toBe('delays_common');
    expect(delays.layout).toBe('compliance');
    expect(delays.sentenceLead).toBe('Pothole requests met the deadline');
    expect(delays.heroPrimary).toBe('96% of the time.');
    expect(delays.supportLine).toBe('Perceptibly close \u2014 not quite perfect.');
  });

  it('pairs perceptibly_slow compliance punch with disappointed support', () => {
    const content = resolveSharePath({
      serviceType: 'Alley Cleaning',
      ward: 'Ward 7',
      estimate: baseEstimate({
        p25: 10,
        p50: 17,
        p75: 27,
        p90: 41,
        sla_days: 44,
        pct_met_sla: 92.7,
      }),
      citywideEstimate: null,
    });
    expect(content.id).toBe('perceptibly_slow');
    expect(content.layout).toBe('compliance');
    expect(content.heroPrimary).toBe('93% of the time.');
    expect(content.supportLine).toBe('Usually fine on a 44-day deadline \u2014 until you are in the 7%.');
    expect(content.shareLine).toBe(
      'Alley Cleaning requests met the deadline 93% of the time. Usually fine on a 44-day deadline \u2014 until you are in the 7%.',
    );
  });

  it('classifies quick_fix when p50 < 1', () => {
    const estimate = baseEstimate({ p25: 0, p50: 0.5, p75: 1, pct_met_sla: 96 });
    expect(selectSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate,
      citywideEstimate: null,
    }).id).toBe('quick_fix');
  });

  it('classifies wide_range when IQR is large and SLA compliance is unavailable', () => {
    const estimate = baseEstimate({
      p25: 5,
      p50: 10,
      p75: 30,
      sla_days: 0,
      pct_met_sla: 0,
    });
    expect(selectSharePath({
      serviceType: 'Sidewalk Repair',
      ward: null,
      estimate,
      citywideEstimate: null,
    }).id).toBe('wide_range');
  });

  it('prefers delays_common over wide_range when SLA compliance is strong', () => {
    expect(selectSharePath({
      serviceType: 'Tree Pruning',
      ward: 'Ward 4',
      estimate: baseEstimate({
        p25: 0.7,
        p50: 2.8,
        p75: 23.6,
        sla_days: 45,
        pct_met_sla: 95.2,
      }),
      citywideEstimate: baseEstimate({ p50: 5.2 }),
    }).id).toBe('delays_common');
  });

  it('formats wide_range read-aloud copy', () => {
    const content = resolveSharePath({
      serviceType: 'Public Space Inspection',
      ward: 'Ward 4',
      estimate: baseEstimate({ p25: 2, p50: 8, p75: 18, sla_days: 0, pct_met_sla: 0 }),
      citywideEstimate: null,
    });
    expect(content.id).toBe('wide_range');
    expect(content.sentenceLead).toBe('Public Space Inspection can take');
    expect(content.supportLine).toBe('Outcomes vary wildly — they keep you on your toes.');
    expect(content.shareLine).toBe(
      'Public Space Inspection can take 2–18 days. Outcomes vary wildly — they keep you on your toes.',
    );
  });
});

describe('formatWardGapHero', () => {
  it('uses extra days when the gap is modest', () => {
    expect(formatWardGapHero(17, 11)).toBe('6 days longer');
  });

  it('uses a multiplier when the ward is dramatically slower', () => {
    expect(formatWardGapHero(21, 5)).toBe('4× longer');
  });
});

describe('buildSharePathContent', () => {
  it('builds ward_gap read-aloud copy', () => {
    const content = resolveSharePath({
      serviceType: 'Scheduled Yard Waste',
      ward: 'Ward 6',
      estimate: baseEstimate({ p50: 17, p25: 10, p75: 25 }),
      citywideEstimate: baseEstimate({ p50: 11 }),
    });
    expect(content.id).toBe('ward_gap');
    expect(content.sentenceLead).toBe('Scheduled Yard Waste requests in Ward 6 take');
    expect(content.heroPrimary).toBe('17 days.');
    expect(content.supportLine).toBe('Citywide? 11 days.');
    expect(content.shareLine).toBe(
      'Scheduled Yard Waste requests in Ward 6 take 17 days. Citywide? 11 days.',
    );
  });

  it('builds promise_broken read-aloud copy', () => {
    const selection = selectSharePath({
      serviceType: 'Trash Collection - Missed',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 34, sla_days: 2 }),
      citywideEstimate: null,
    });
    const content = buildSharePathContent(selection, {
      serviceType: 'Trash Collection - Missed',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 34, sla_days: 2 }),
      citywideEstimate: null,
    });
    expect(content.sentenceLead).toBe('Trash Collection - Missed requests met the deadline');
    expect(content.heroPrimary).toBe('34% of the time.');
    expect(content.supportLine).toBe('The city promised 2 days.');
    expect(content.shareLine).toBe(
      'Trash Collection - Missed requests met the deadline 34% of the time. The city promised 2 days.',
    );
  });

  it('builds promise_broken moderate copy without repeating the hit rate', () => {
    const content = buildSharePathContent(
      {
        id: 'promise_broken',
        layout: 'compliance',
        tone: 'danger',
        promiseTier: 'moderate',
      },
      {
        serviceType: 'DOB - Illegal Construction',
        ward: 'Ward 7',
        estimate: baseEstimate({ pct_met_sla: 65, sla_days: 6 }),
        citywideEstimate: null,
      },
    );
    expect(content.heroPrimary).toBe('65% of the time.');
    expect(content.supportLine).toBe('The city gave itself 6 days.');
    expect(content.shareLine).not.toContain('35%');
  });

  it('builds reliable read-aloud copy', () => {
    const content = resolveSharePath({
      serviceType: 'Alley Cleaning',
      ward: 'Ward 8',
      estimate: baseEstimate({ pct_met_sla: 100, sla_days: 45 }),
      citywideEstimate: null,
    });
    expect(content.sentenceLead).toBe('Alley Cleaning requests met the deadline');
    expect(content.heroPrimary).toBe('100% of the time.');
    expect(content.supportLine).toBe('45-day window — rare for DC 311.');
  });
});

describe('SHARE_PATH_THRESHOLDS', () => {
  it('uses 80/95/99 SLA bands for share paths', () => {
    expect(SHARE_PATH_THRESHOLDS.promiseBrokenBelow).toBe(80);
    expect(SHARE_PATH_THRESHOLDS.barelyAcceptableAt).toBe(95);
    expect(SHARE_PATH_THRESHOLDS.reliableAt).toBe(99);
  });
});

describe('validateSharePathCoherence', () => {
  it('flags wait punch paired with compliance kicker', () => {
    const violations = validateSharePathCoherence({
      id: 'perceptibly_slow',
      layout: 'range',
      tone: 'warning',
      sentenceLead: 'Alley Cleaning usually takes',
      sentenceLeadParts: { beforeType: '', serviceType: 'Alley Cleaning', afterType: 'usually takes' },
      heroPrimary: '10–27 days.',
      supportLine: 'Usually fine — until you\u2019re not.',
      heroColor: '#f59e0b',
      ogTitle: 'Alley Cleaning',
      ogDescription: '',
      shareLine: '',
    });
    expect(violations).toContain('wait punch paired with compliance kicker and no deadline bridge');
    expect(violations).not.toContain('lead promises wait time but punch is a hit rate');
  });

  it('allows generous_deadline range when support bridges via deadline', () => {
    const content = resolveSharePath({
      serviceType: 'Roadway Repair',
      ward: null,
      estimate: baseEstimate({
        p25: 21, p50: 46, p75: 80, pct_met_sla: 100, sla_days: 389,
      }),
      citywideEstimate: null,
    });
    expect(validateSharePathCoherence(content)).toEqual([]);
  });

  it('finds no punch/support mismatches across manifest estimates', () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data', 'manifest.json'), 'utf-8'),
    );
    const dicts = manifest.dictionaries;
    const citywideByType: Record<number, typeof manifest.estimates[0]> = {};
    for (const row of manifest.estimates) {
      if (row.w === null) citywideByType[row.st] = row;
    }
    const rowToEstimate = (row: typeof manifest.estimates[0]) => ({
      n: row.n,
      p25: row.p25,
      p50: row.p50,
      p75: row.p75,
      p90: row.p90,
      p95: row.p95,
      sla_days: row.sla_days,
      pct_met_sla: row.pct_met_sla,
    });

    const failures: string[] = [];
    for (const row of manifest.estimates) {
      const serviceType = dicts.serviceTypes[row.st];
      if (!serviceType) continue;
      const ward = row.w === null ? null : dicts.wards[row.w] ?? null;
      const citywideRow = citywideByType[row.st];
      const content = resolveSharePath({
        serviceType,
        ward,
        estimate: rowToEstimate(row),
        citywideEstimate: citywideRow ? rowToEstimate(citywideRow) : null,
      });
      const violations = validateSharePathCoherence(content);
      if (violations.length > 0) {
        failures.push(`${serviceType} / ${ward ?? 'citywide'} (${content.id}): ${violations.join('; ')}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
