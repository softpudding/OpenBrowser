import { describe, expect, test } from 'bun:test';

import { getLabelDimensions, getLabelTextWidth } from '../utils/label-geometry';

describe('label-geometry', () => {
  test('measures wide glyphs wider than narrow glyphs', () => {
    expect(getLabelTextWidth('III')).toBeLessThan(getLabelTextWidth('WWW'));
    expect(getLabelTextWidth('111')).toBeLessThan(getLabelTextWidth('MQH'));
  });

  test('allocates enough width for measured label text plus padding', () => {
    const dimensions = getLabelDimensions('MQH');

    expect(dimensions.width).toBe(dimensions.textWidth + dimensions.padding * 2);
  });
});
