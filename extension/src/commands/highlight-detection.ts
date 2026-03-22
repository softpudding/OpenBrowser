import injectedHighlightDetectionSource from './highlight-detection.injected.js?raw';
import { buildHitTestVisibilityHelpersScript } from '../utils/hit-test-visibility';
import { buildLayoutStabilityHelpersScript } from '../utils/layout-stability';
import type { ElementType, InteractiveElement } from '../types';

export interface HighlightDetectionScriptConfig {
  elementType: ElementType;
}

export interface KeywordFilterResult {
  keywords: string[];
  elements: InteractiveElement[];
}

export function buildHighlightDetectionScript(
  config: HighlightDetectionScriptConfig,
): string {
  return `
    (async function() {
      const highlightDetectionConfig = ${JSON.stringify(config)};
      ${buildHitTestVisibilityHelpersScript()}
      ${buildLayoutStabilityHelpersScript()}
      ${injectedHighlightDetectionSource}
      return await runOpenBrowserHighlightDetection(highlightDetectionConfig);
    })();
  `;
}

export function normalizeHighlightKeywords(
  keywords?: readonly string[],
): string[] {
  return Array.from(
    new Set(
      (keywords ?? [])
        .map((keyword) => keyword.trim().toLowerCase())
        .filter((keyword) => keyword.length > 0),
    ),
  );
}

export function getHighlightKeywordHaystack(
  element: Pick<
    InteractiveElement,
    'searchText' | 'text' | 'selector' | 'tagName' | 'html'
  >,
): string {
  const primary = element.searchText?.trim().toLowerCase();
  if (primary) {
    return primary;
  }

  return [element.text, element.selector, element.tagName, element.html]
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
    .join(' ')
    .toLowerCase();
}

export function filterHighlightElementsByKeywords(
  elements: InteractiveElement[],
  keywords?: readonly string[],
): KeywordFilterResult {
  const normalizedKeywords = normalizeHighlightKeywords(keywords);
  if (normalizedKeywords.length === 0) {
    return {
      keywords: [],
      elements,
    };
  }

  return {
    keywords: normalizedKeywords,
    elements: elements.filter((element) => {
      const haystack = getHighlightKeywordHaystack(element);
      return normalizedKeywords.some((keyword) => haystack.includes(keyword));
    }),
  };
}
