import { describe, expect, test } from 'bun:test';

import {
  getRecordingAnnotationMessage,
  resolveRecordingKeyframeAnnotationTarget,
} from '../recording/keyframe-annotation';

describe('recording keyframe annotation', () => {
  test('resolves click annotations from element bbox', () => {
    expect(
      resolveRecordingKeyframeAnnotationTarget('click', {
        element: {
          bbox: { x: 12, y: 24, width: 80, height: 28 },
        },
      }),
    ).toEqual({
      bbox: { x: 12, y: 24, width: 80, height: 28 },
      intendedAction: 'click',
      message: 'This is the element the user just clicked.',
    });
  });

  test('resolves input-like annotations from change events', () => {
    expect(
      resolveRecordingKeyframeAnnotationTarget('change', {
        element: {
          bbox: { x: 5, y: 8, width: 160, height: 34 },
        },
      }),
    ).toEqual({
      bbox: { x: 5, y: 8, width: 160, height: 34 },
      intendedAction: 'keyboard_input',
      message: 'This is the element the user just typed into.',
    });
  });

  test('resolves submit annotations from form bbox', () => {
    expect(
      resolveRecordingKeyframeAnnotationTarget('submit', {
        form: {
          bbox: { x: 40, y: 100, width: 320, height: 120 },
        },
      }),
    ).toEqual({
      bbox: { x: 40, y: 100, width: 320, height: 120 },
      intendedAction: 'keyboard_input',
      message: 'This is the form the user just submitted.',
    });
  });

  test('returns null when bbox is missing or invalid', () => {
    expect(
      resolveRecordingKeyframeAnnotationTarget('click', {
        element: { bbox: { x: 0, y: 0, width: 0, height: 20 } },
      }),
    ).toBeNull();
    expect(resolveRecordingKeyframeAnnotationTarget('tab_ready', {})).toBeNull();
  });

  test('formats human-readable messages', () => {
    expect(getRecordingAnnotationMessage('click')).toBe(
      'This is the element the user just clicked.',
    );
    expect(getRecordingAnnotationMessage('change')).toBe(
      'This is the element the user just typed into.',
    );
    expect(getRecordingAnnotationMessage('submit')).toBe(
      'This is the form the user just submitted.',
    );
  });
});
