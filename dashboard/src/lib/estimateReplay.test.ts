import { describe, expect, it } from 'vitest';
import {
  buildReplayPrompt,
} from './estimateReplay';
import { LookupEstimateResult } from './estimateData';

const baseEstimate = {
  n: 100,
  p25: 2,
  p50: 4,
  p75: 7,
  p90: 14,
  sla_days: 21,
  pct_met_sla: 94,
};

function makeLookup(overrides: Partial<LookupEstimateResult> = {}): LookupEstimateResult {
  return {
    estimate: baseEstimate,
    citywideEstimate: baseEstimate,
    wardEstimate: null,
    usedWardFallback: false,
    ...overrides,
  };
}

describe('buildReplayPrompt', () => {
  it('prompts citywide users to add ward and suggests other types', () => {
    const prompt = buildReplayPrompt({
      serviceType: 'Pothole',
      ward: null,
      lookup: makeLookup(),
      wardStandouts: [],
      citywideExploreTypes: ['Illegal Dumping', 'Abandoned Vehicle'],
      category: 'Roads',
    });
    expect(prompt?.promptLine).toContain('Add your ward');
    expect(prompt?.suggestTypes).toEqual(['Illegal Dumping', 'Abandoned Vehicle']);
  });

  it('skips exploration for quick-fix types when ward is set', () => {
    const prompt = buildReplayPrompt({
      serviceType: 'Missed Trash',
      ward: 'Ward 1',
      lookup: makeLookup({
        estimate: { ...baseEstimate, p50: 0.5, p25: 0, p75: 1 },
        wardEstimate: { ...baseEstimate, p50: 0.5, p25: 0, p75: 1 },
      }),
      wardStandouts: ['Illegal Dumping'],
      citywideExploreTypes: [],
      category: 'Sanitation',
    });
    expect(prompt).toBeNull();
  });

  it('suggests ward standouts when ward is slower than citywide', () => {
    const prompt = buildReplayPrompt({
      serviceType: 'Pothole',
      ward: 'Ward 7',
      lookup: makeLookup({
        estimate: { ...baseEstimate, p50: 12, p25: 8, p75: 16 },
        wardEstimate: { ...baseEstimate, p50: 12, p25: 8, p75: 16 },
        citywideEstimate: { ...baseEstimate, p50: 4 },
      }),
      wardStandouts: ['Pothole', 'Illegal Dumping', 'Abandoned Vehicle'],
      citywideExploreTypes: [],
      category: 'Roads',
    });
    expect(prompt?.promptLine).toContain('slower than citywide');
    expect(prompt?.suggestTypes).toEqual(['Illegal Dumping', 'Abandoned Vehicle']);
  });

  it('suggests estimable types when the current type has no closed history', () => {
    const prompt = buildReplayPrompt({
      serviceType: 'Bee Treatment and Inspection (DOH)',
      ward: null,
      lookup: null,
      wardStandouts: [],
      citywideExploreTypes: ['Illegal Dumping', 'Pothole'],
      category: 'Health',
    });
    expect(prompt?.promptLine).toContain('No closed requests yet');
    expect(prompt?.suggestTypes).toEqual(['Illegal Dumping', 'Pothole']);
  });

  it('suggests ward standouts when the current type has no closed history in a ward', () => {
    const prompt = buildReplayPrompt({
      serviceType: 'Bee Treatment and Inspection (DOH)',
      ward: 'Ward 3',
      lookup: null,
      wardStandouts: ['Pothole', 'Illegal Dumping'],
      citywideExploreTypes: [],
      category: 'Health',
    });
    expect(prompt?.promptLine).toContain('Ward 3');
    expect(prompt?.suggestTypes).toEqual(['Pothole', 'Illegal Dumping']);
  });
});
