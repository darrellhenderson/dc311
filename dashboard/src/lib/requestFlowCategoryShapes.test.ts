import { describe, expect, it } from 'vitest';
import {
  categoryShapeIcon,
  REQUEST_FLOW_CATEGORY_ASCII,
  REQUEST_FLOW_LEGEND_CATEGORIES,
} from './requestFlowCategoryShapes';

describe('requestFlowCategoryShapes', () => {
  it('maps known categories to expected ascii glyphs', () => {
    expect(categoryShapeIcon('Transit')).toBe('&');
    expect(categoryShapeIcon('Traffic Safety')).toBe('$');
    expect(categoryShapeIcon('Roads & Vehicle Infrastructure')).toBe('#');
    expect(categoryShapeIcon('Unknown Category')).toBe('x');
  });

  it('does not use bracket or paren glyphs', () => {
    const forbidden = /^[{}[\]()<>]$/;
    for (const glyph of Object.values(REQUEST_FLOW_CATEGORY_ASCII)) {
      expect(glyph).not.toMatch(forbidden);
    }
  });

  it('covers every legend category', () => {
    for (const category of REQUEST_FLOW_LEGEND_CATEGORIES) {
      expect(REQUEST_FLOW_CATEGORY_ASCII[category]).toBeTruthy();
    }
  });

  it('assigns a unique glyph to every legend category', () => {
    const glyphs = REQUEST_FLOW_LEGEND_CATEGORIES.map((category) => categoryShapeIcon(category));
    expect(new Set(glyphs).size).toBe(REQUEST_FLOW_LEGEND_CATEGORIES.length);
  });
});
