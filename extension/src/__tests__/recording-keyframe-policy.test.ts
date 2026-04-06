import { describe, expect, test } from 'bun:test';

import {
  getRecordingKeyframeWaitForRender,
  shouldCaptureRecordingKeyframe,
  shouldDiscardPostCaptureRecordingKeyframe,
} from '../recording/keyframe-policy';

describe('recording keyframe policy', () => {
  test('captures keyframes for click and submit actions', () => {
    expect(shouldCaptureRecordingKeyframe('click')).toBe(true);
    expect(shouldCaptureRecordingKeyframe('submit')).toBe(true);
    expect(shouldCaptureRecordingKeyframe('tab_ready')).toBe(false);
  });

  test('uses shorter render wait for action-timed keyframes', () => {
    expect(getRecordingKeyframeWaitForRender('click')).toBe(60);
    expect(getRecordingKeyframeWaitForRender('submit')).toBe(60);
    expect(getRecordingKeyframeWaitForRender('tab_ready')).toBe(180);
  });

  test('discards post-capture action keyframes that drift to another url', () => {
    expect(
      shouldDiscardPostCaptureRecordingKeyframe(
        'click',
        {
          page: { url: 'https://www.zhihu.com/' },
          tab: { url: 'https://www.zhihu.com/' },
        },
        {
          url: 'https://www.zhihu.com/question/123',
        },
      ),
    ).toBe(true);
  });

  test('keeps action keyframes on the same page', () => {
    expect(
      shouldDiscardPostCaptureRecordingKeyframe(
        'click',
        {
          page: { url: 'https://www.zhihu.com/' },
        },
        {
          url: 'https://www.zhihu.com/',
        },
      ),
    ).toBe(false);
  });
});
