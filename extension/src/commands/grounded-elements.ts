import { debuggerSessionManager } from './debugger-manager';
import { CdpCommander } from './cdp-commander';

// Represents a single grounded DOM element with a robust selector and metadata
export interface GroundedElement {
  tag: string;
  selector: string;
  id?: string;
  name?: string;
  dataTestId?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  text?: string;
}

// Result container returned by grounded element extraction
export interface GroundedElementsResult {
  elements: GroundedElement[];
  pageInfo: {
    url: string;
    title: string;
    totalInteractive: number;
  };
}

/**
 * Extract grounded interactive elements from a page using CDP.
 * - Generates selectors with priority: id > name > data-testid > CSS path
 * - Collects bounding boxes for each element
 * - Returns page URL, title, and total number of interactive elements discovered
 */
export async function extractGroundedElements(
  tabId: number,
  conversationId: string,
  maxElements: number = 100,
  includeHidden: boolean = false,
): Promise<GroundedElementsResult> {
  // Ensure debugger is attached for the target tab
  await debuggerSessionManager.attachDebugger(tabId, conversationId);
  const cdp = new CdpCommander(tabId);

  // JavaScript to run in the page context to extract elements
  const expression = `(function(){
    function getCssPath(el){
      if(!el) return '';
      let path = '';
      while (el && el.nodeType === 1){
        const tag = el.nodeName.toLowerCase();
        if (el.id){ path = '#' + el.id + (path ? ' > ' + path : ''); break; }
        // count index among siblings
        let sib = el;
        let index = 1;
        while ((sib = sib.previousElementSibling)) { index++; }
        const segment = tag + (index > 1 ? ':nth-child(' + index + ')' : '');
        path = segment + (path ? ' > ' + path : '');
        el = el.parentElement;
      }
      return path;
    }

    const includeHidden = ${includeHidden};
    const MAX = ${maxElements};

    // Identify interactive elements
    const isInteractive = (el)=>{
      const tag = (el && el.tagName) ? el.tagName.toUpperCase() : '';
      return tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.getAttribute('role') === 'button';
    };

    const candidates = Array.from(document.querySelectorAll('*'))
      .filter(el => {
        if (!isInteractive(el)) return false;
        if (!includeHidden && (el.offsetParent === null)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });

    const totalInteractive = candidates.length;
    const limited = candidates.slice(0, MAX);

    const elements = limited.map(el => {
      let selector = '';
      const id = el.id;
      const name = el.getAttribute('name') || '';
      const dataTestId = el.getAttribute('data-testid') || '';
      if (id) {
        selector = '#' + id;
      } else if (name) {
        selector = '[name="' + name.replace(/\\/g, '\\\\') + '"]';
      } else if (dataTestId) {
        selector = '[data-testid="' + dataTestId.replace(/\\/g, '\\\\') + '"]';
      } else {
        selector = getCssPath(el);
      }
      const bbox = el.getBoundingClientRect();
      const text = (el.textContent || '').trim().slice(0, 200);
      return {
        tag: el.tagName.toLowerCase(),
        selector,
        id: id || '',
        name: name || '',
        dataTestId: dataTestId || '',
        bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
        text
      };
    });

    const pageInfo = {
      url: document.location.href,
      title: document.title,
      totalInteractive
    };

    return { elements, pageInfo };
  })()`;

  // Execute the expression via CDP and return structured data
  const response: any = await cdp.sendCommand('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  // The result is returned as a serializable value when using returnByValue
  const value =
    response?.result?.value ?? response?.result?.returnValue ?? undefined;
  if (value && typeof value === 'object') {
    const elements: GroundedElement[] =
      (value.elements as GroundedElement[]) ?? [];
    const pageInfo = (value.pageInfo as any) ?? {
      url: '',
      title: '',
      totalInteractive: 0,
    };
    return {
      elements,
      pageInfo: {
        url: pageInfo.url ?? '',
        title: pageInfo.title ?? '',
        totalInteractive: pageInfo.totalInteractive ?? 0,
      },
    };
  }

  // Fallback empty result if evaluation did not return data as expected
  return {
    elements: [],
    pageInfo: {
      url: '',
      title: '',
      totalInteractive: 0,
    },
  };
}
