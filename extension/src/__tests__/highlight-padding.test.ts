import { describe, test, expect } from 'bun:test';

// Import constants from shared constants file (no Chrome API dependencies)
import { 
  LABEL_FONT_SIZE, 
  LABEL_PADDING, 
  LABEL_HEIGHT 
} from '../commands/label-constants';
import { 
  BASE_FONT_SIZE, 
  BASE_LABEL_PADDING 
} from '../commands/visual-highlight';

/**
 * TDD Tests for Padding Consistency
 * Bug: BASE_LABEL_PADDING is 4, should be 5 to match LABEL_PADDING
 * Label height = 16 (font) + 5 (padding) * 2 = 26px
 */

describe('Padding Consistency', () => {
  describe('Collision Detection Constants (background/index.ts)', () => {
    test('should have LABEL_HEIGHT of 26px', () => {
      expect(LABEL_HEIGHT).toBe(26);
    });

    test('should have LABEL_PADDING of 5px', () => {
      expect(LABEL_PADDING).toBe(5);
    });

    test('should have LABEL_FONT_SIZE of 16px', () => {
      expect(LABEL_FONT_SIZE).toBe(16);
    });
  });

  describe('Visual Drawing Constants (visual-highlight.ts)', () => {
    test('should have BASE_LABEL_PADDING of 5px', () => {
      expect(BASE_LABEL_PADDING).toBe(5);
    });

    test('should have BASE_FONT_SIZE of 16px', () => {
      expect(BASE_FONT_SIZE).toBe(16);
    });

    test('should calculate label height consistently', () => {
      const expectedLabelHeight = BASE_FONT_SIZE + BASE_LABEL_PADDING * 2;
      expect(expectedLabelHeight).toBe(26);
    });
  });

  describe('Cross-file Consistency', () => {
    test('LABEL_PADDING and BASE_LABEL_PADDING should be equal', () => {
      expect(LABEL_PADDING).toBe(BASE_LABEL_PADDING);
    });

    test('label heights should match between collision and drawing', () => {
      const collisionLabelHeight = LABEL_FONT_SIZE + LABEL_PADDING * 2;
      const visualLabelHeight = BASE_FONT_SIZE + BASE_LABEL_PADDING * 2;
      
      expect(collisionLabelHeight).toBe(visualLabelHeight);
      expect(collisionLabelHeight).toBe(26);
    });
  });
});