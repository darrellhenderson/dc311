import { describe, expect, it } from 'vitest';
import {
  buildSharePathContent,
  formatWardGapHero,
  isGenerousDeadline,
  isSlowerWardGap,
  resolveSharePath,
  selectSharePath,
  SHARE_PATH_THRESHOLDS,
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

  it('classifies generous_deadline when SLA is far out and compliance is high', () => {
    const estimate = baseEstimate({
      p25: 21, p50: 46, p75: 80, pct_met_sla: 100, sla_days: 389,
    });
    expect(isGenerousDeadline(estimate)).toBe(true);
    expect(selectSharePath({
      serviceType: 'Roadway Repair',
      ward: null,
      estimate,
      citywideEstimate: null,
    }).id).toBe('generous_deadline');
  });

  it('formats generous_deadline support copy', () => {
    const content = resolveSharePath({
      serviceType: 'Roadway Repair',
      ward: null,
      estimate: baseEstimate({
        p25: 21, p50: 46, p75: 80, pct_met_sla: 100, sla_days: 389,
      }),
      citywideEstimate: null,
    });
    expect(content.id).toBe('generous_deadline');
    expect(content.heroPrimary).toBe('21–80 days');
    expect(content.supportLine).toBe('Easy to hit 100% when the deadline is over a year.');
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

  it('uses range layout for perceptibly_slow and compliance for delays_common', () => {
    const slow = resolveSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 88 }),
      citywideEstimate: null,
    });
    expect(slow.id).toBe('perceptibly_slow');
    expect(slow.layout).toBe('range');
    expect(slow.heroLabel).toBe('Typically');
    expect(slow.supportLine).toContain('Perceptibly slow');

    const delays = resolveSharePath({
      serviceType: 'Pothole',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 96 }),
      citywideEstimate: null,
    });
    expect(delays.id).toBe('delays_common');
    expect(delays.layout).toBe('compliance');
    expect(delays.supportLine).toBe('Most requests are resolved on time, but delays are common.');
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

  it('classifies wide_range when IQR is large relative to median', () => {
    const estimate = baseEstimate({
      p25: 5,
      p50: 10,
      p75: 30,
      pct_met_sla: 96,
    });
    expect(selectSharePath({
      serviceType: 'Sidewalk Repair',
      ward: null,
      estimate,
      citywideEstimate: null,
    }).id).toBe('wide_range');
  });

  it('formats wide_range support copy', () => {
    const content = resolveSharePath({
      serviceType: 'Public Space Inspection',
      ward: 'Ward 4',
      estimate: baseEstimate({ p25: 2, p50: 8, p75: 18, pct_met_sla: 96 }),
      citywideEstimate: null,
    });
    expect(content.id).toBe('wide_range');
    expect(content.supportLine).toBe('Outcomes vary wildly. They keep you on your toes.');
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
  it('builds ward_gap headline and share line', () => {
    const content = resolveSharePath({
      serviceType: 'Scheduled Yard Waste',
      ward: 'Ward 6',
      estimate: baseEstimate({ p50: 17, p25: 10, p75: 25 }),
      citywideEstimate: baseEstimate({ p50: 11 }),
    });
    expect(content.id).toBe('ward_gap');
    expect(content.heroLabel).toBe('In Ward 6');
    expect(content.heroPrimary).toBe('6 days longer');
    expect(content.supportLine).toBe('17 days in Ward 6. Citywide? 11.');
    expect(content.shareLine).toContain('6 days longer');
    expect(content.shareLine).toContain('17 days here, 11 citywide');
  });

  it('builds promise_broken severe support line', () => {
    const selection = selectSharePath({
      serviceType: 'Trash Collection - Missed',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 34 }),
      citywideEstimate: null,
    });
    const content = buildSharePathContent(selection, {
      serviceType: 'Trash Collection - Missed',
      ward: null,
      estimate: baseEstimate({ pct_met_sla: 34 }),
      citywideEstimate: null,
    });
    expect(content.heroPrimary).toBe('Only 34% on time');
    expect(content.supportLine).toContain('only delivers 34%');
  });
});

describe('SHARE_PATH_THRESHOLDS', () => {
  it('uses 80/95/99 SLA bands for share paths', () => {
    expect(SHARE_PATH_THRESHOLDS.promiseBrokenBelow).toBe(80);
    expect(SHARE_PATH_THRESHOLDS.barelyAcceptableAt).toBe(95);
    expect(SHARE_PATH_THRESHOLDS.reliableAt).toBe(99);
  });
});
