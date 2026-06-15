import { describe, expect, it } from 'vitest';
import { cohortChartDays, filingDayKey, filingMonthKey } from './filingDate';

describe('filingMonthKey', () => {
  it('uses UTC to match Python shard month assignment', () => {
    expect(filingMonthKey(new Date('2025-02-01T03:00:00.000Z'))).toBe('2025-02');
    expect(filingMonthKey(new Date('2025-01-31T23:00:00.000Z'))).toBe('2025-01');
  });
});

describe('filingDayKey', () => {
  it('uses UTC calendar days', () => {
    expect(filingDayKey(new Date('2025-01-31T23:00:00.000Z'))).toBe('2025-01-31');
    expect(filingDayKey(new Date('2025-02-01T03:00:00.000Z'))).toBe('2025-02-01');
  });
});

describe('cohortChartDays', () => {
  it('extends a filing month by 120 follow-up days', () => {
    const days = cohortChartDays('2025-05');
    expect(days).toHaveLength(31 + 120);
    expect(days[0].key).toBe('2025-05-01');
    expect(days[30].key).toBe('2025-05-31');
    expect(days[31].key).toBe('2025-06-01');
    expect(days[days.length - 1].key).toBe('2025-09-28');
  });
});
