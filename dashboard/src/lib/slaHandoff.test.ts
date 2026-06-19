import { describe, expect, it } from 'vitest';
import { consumePendingSlaFilters, setPendingSlaFilters } from './slaHandoff';

describe('slaHandoff', () => {
  it('stores and consumes pending SLA filters once', () => {
    setPendingSlaFilters({ wards: ['Ward 4'], categories: ['Sanitation'] });
    expect(consumePendingSlaFilters()).toEqual({
      wards: ['Ward 4'],
      categories: ['Sanitation'],
    });
    expect(consumePendingSlaFilters()).toBeNull();
  });
});
