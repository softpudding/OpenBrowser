import { describe, expect, test } from 'bun:test';

import {
  getRecordingKeyframeCaptureOptions,
  getRecordingKeyframeWaitForRender,
  getRecordingPreActionCaptureOptions,
  getRecordingPreActionWaitForRender,
  isInputLikeRecordingTarget,
  shouldCaptureRecordingKeyframe,
  shouldDiscardPostCaptureRecordingKeyframe,
} from '../recording/keyframe-policy';

describe('recording keyframe policy', () => {
  test('captures keyframes for click, change, and submit actions', () => {
    expect(shouldCaptureRecordingKeyframe('click')).toBe(true);
    expect(
      shouldCaptureRecordingKeyframe('focus', {
        element: { tagName: 'input' },
      }),
    ).toBe(true);
    expect(shouldCaptureRecordingKeyframe('change')).toBe(true);
    expect(shouldCaptureRecordingKeyframe('submit')).toBe(true);
    expect(
      shouldCaptureRecordingKeyframe('focus', {
        element: { tagName: 'div' },
      }),
    ).toBe(false);
    expect(shouldCaptureRecordingKeyframe('tab_ready')).toBe(false);
  });

  test('recognizes input-like targets', () => {
    expect(isInputLikeRecordingTarget({ tagName: 'input' })).toBe(true);
    expect(isInputLikeRecordingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isInputLikeRecordingTarget({ role: 'combobox' })).toBe(true);
    expect(isInputLikeRecordingTarget({ tagName: 'div' })).toBe(false);
  });

  test('uses shorter render wait for action-timed keyframes', () => {
    expect(getRecordingKeyframeWaitForRender('click')).toBe(60);
    expect(getRecordingKeyframeWaitForRender('change')).toBe(60);
    expect(getRecordingKeyframeWaitForRender('submit')).toBe(60);
    expect(getRecordingKeyframeWaitForRender('tab_ready')).toBe(180);
  });

  test('keeps recording keyframe size limits as offline output bounds', () => {
    const options = getRecordingKeyframeCaptureOptions();

    expect(options.preferredFormat).toBe('jpeg');
    expect(options.maxOutputWidth).toBe(1920);
    expect(options.maxOutputHeight).toBe(1080);
    expect(options.warmupBeforeCapture).toBe(true);
    expect(options.settleBeforeCapture).toBe(true);
  });

  test('uses aggressive capture settings for pre-action snapshots', () => {
    const options = getRecordingPreActionCaptureOptions();

    expect(getRecordingPreActionWaitForRender()).toBe(0);
    expect(options.preferredFormat).toBe('jpeg');
    expect(options.maxOutputWidth).toBe(1920);
    expect(options.maxOutputHeight).toBe(1080);
    expect(options.warmupBeforeCapture).toBe(false);
    expect(options.settleBeforeCapture).toBe(false);
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
