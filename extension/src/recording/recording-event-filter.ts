export function shouldIgnoreRecordingClickTarget(
  target: { tagName?: string | null } | null | undefined,
): boolean {
  if (!target || typeof target.tagName !== 'string') {
    return false;
  }

  const tagName = target.tagName.trim().toLowerCase();
  return tagName === 'html' || tagName === 'body';
}
