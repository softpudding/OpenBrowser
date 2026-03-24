import { describe, test, expect } from 'bun:test';
import {
  buildHitTestVisibilityHelpersScript,
  getHitTestSamplePoints,
  pickTopLayerCandidate,
} from '../../utils/hit-test-visibility';

describe('hit-test visibility helpers', () => {
  test('getHitTestSamplePoints deduplicates and clamps tiny rect samples', () => {
    const points = getHitTestSamplePoints(
      { x: -5, y: -3, width: 4, height: 4 },
      100,
      80,
    );

    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(5);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(100);
      expect(point.y).toBeLessThan(80);
    }
  });

  test('pickTopLayerCandidate prefers higher z-index first', () => {
    const winner = pickTopLayerCandidate([
      { zIndex: 10, domOrder: 5, id: 'low' },
      { zIndex: 50, domOrder: 1, id: 'high' },
      { zIndex: 20, domOrder: 9, id: 'mid' },
    ]);

    expect(winner?.id).toBe('high');
  });

  test('pickTopLayerCandidate breaks z-index ties by later dom order', () => {
    const winner = pickTopLayerCandidate([
      { zIndex: 20, domOrder: 1, id: 'first' },
      { zIndex: 20, domOrder: 3, id: 'later' },
    ]);

    expect(winner?.id).toBe('later');
  });

  test('buildHitTestVisibilityHelpersScript includes modal-aware helpers', () => {
    const script = buildHitTestVisibilityHelpersScript();

    expect(script).toContain('getActiveTopLayerRoot');
    expect(script).toContain('.modal-overlay');
    expect(script).toContain('getElementHitTestVisibility');
    expect(script).toContain('resolveTopLayerRoot');
    expect(script).toContain('hasVisibleSiblingContent');
  });

  test('buildHitTestVisibilityHelpersScript treats input placeholders as related hit targets', () => {
    const script = buildHitTestVisibilityHelpersScript();

    expect(script).toContain('INPUT_PLACEHOLDER_TOKEN_REGEX');
    expect(script).toContain('isTextInputControl');
    expect(script).toContain('getInputSurfaceRoot');
    expect(script).toContain('isPlaceholderCoverForInput');
    expect(script).toContain('isPlaceholderCoverForInput(hit, target)');
  });
});
