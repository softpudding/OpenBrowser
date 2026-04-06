import { describe, expect, test } from 'bun:test';

import { shouldIgnoreRecordingClickTarget } from '../recording/recording-event-filter';

describe('recording event filter', () => {
  test('ignores root html and body click targets', () => {
    expect(shouldIgnoreRecordingClickTarget({ tagName: 'HTML' })).toBe(true);
    expect(shouldIgnoreRecordingClickTarget({ tagName: 'body' })).toBe(true);
  });

  test('keeps meaningful element click targets', () => {
    expect(shouldIgnoreRecordingClickTarget({ tagName: 'div' })).toBe(false);
    expect(shouldIgnoreRecordingClickTarget({ tagName: 'button' })).toBe(false);
    expect(shouldIgnoreRecordingClickTarget(null)).toBe(false);
  });
});
