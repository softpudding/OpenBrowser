/**
 * Accessibility Tree Extraction via Chrome DevTools Protocol
 *
 * Uses CDP Accessibility.getFullAXTree() to extract semantic information
 * about interactive elements on the page. This provides the AI agent with
 * structured context about what elements are available for interaction.
 *
 * Key Features:
 * - Filters to leaf nodes only (actual interactive elements)
 * - Generates CSS selectors for each element
 * - Returns role, name, selector, and bounds for each element
 */

import { debuggerSessionManager } from './debugger-manager';
import { CdpCommander } from './cdp-commander';

export interface AccessibilityNode {
  role: string;
  name: string;
  selector: string;
  index: number;
  href?: string;
  value?: string;
  placeholder?: string;
  input_type?: string;
  checked?: boolean;
  disabled?: boolean;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Result of accessibility tree extraction
 */
export interface AccessibilityTreeResult {
  elements: AccessibilityNode[];
  pageInfo: {
    url: string;
    title: string;
    totalElements: number;
  };
}

/**
 * Interactive roles that the AI agent can interact with
 * These are the leaf node types we want to extract
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'slider',
  'spinbutton',
  'searchbox',
  'switch',
  'option',
  'treeitem',
  'cell',
  'gridcell',
  'rowheader',
  'columnheader',
  'heading', // for navigation
  'listitem',
  'dialog',
]);

/**
 * CDP Accessibility.AXNode structure (simplified)
 */
interface CdpAxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value: string };
  name?: { value: string };
  value?: { value: any };
  description?: { value: string };
  properties?: Array<{ name: string; value: { value: any } }>;
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

function isFocusable(node: CdpAxNode): boolean {
  if (!node.properties) return false;
  const focusableProp = node.properties.find((p) => p.name === 'focusable');
  return focusableProp?.value?.value === true;
}

/**
 * Map accessibility role to CSS selector for querySelectorAll
 */
function getRoleToSelector(role: string): string {
  const tagMap: Record<string, string> = {
    button:
      'button, [role="button"], input[type="button"], input[type="submit"]',
    link: 'a, [role="link"]',
    textbox:
      'input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="tel"], input[type="url"], textarea, [role="textbox"]',
    searchbox: 'input[type="search"], [role="searchbox"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    combobox: 'select, [role="combobox"]',
    menuitem: '[role="menuitem"]',
    tab: '[role="tab"]',
    listitem: 'li, [role="listitem"]',
    treeitem: '[role="treeitem"]',
    heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
    dialog: '[role="dialog"]',
  };
  return tagMap[role] || `[role="${role}"]`;
}

/**
 * Extract accessibility tree from a page using CDP
 *
 * @param tabId Target tab ID
 * @param conversationId Session ID for debugger lifecycle management
 * @param maxElements Maximum number of elements to return (default: 50)
 * @returns Accessibility tree result with elements and page info
 */
export async function getAccessibilityTree(
  tabId: number,
  conversationId: string,
  maxElements: number = 50,
): Promise<AccessibilityTreeResult> {
  console.log(
    `[A11y] 🌲 getAccessibilityTree: tabId=${tabId}, maxElements=${maxElements}`,
  );

  const attached = await debuggerSessionManager.attachDebugger(
    tabId,
    conversationId,
  );
  if (!attached) {
    console.error('[A11y] ❌ Failed to attach debugger');
    throw new Error('[Accessibility] Failed to attach debugger');
  }
  console.log('[A11y] ✅ Debugger attached');

  const cdp = new CdpCommander(tabId);

  try {
    try {
      await cdp.sendCommand('Accessibility.enable', {});
    } catch (e) {
      console.log('[A11y] ℹ️ Accessibility domain already enabled');
    }

    const result: any = await cdp.sendCommand(
      'Accessibility.getFullAXTree',
      {},
    );
    const nodes: CdpAxNode[] = result?.nodes || [];
    console.log(`[A11y] 📊 AX tree: ${nodes.length} total nodes`);

    let pageInfo = { url: '', title: '', totalElements: 0 };
    try {
      const pageResult: any = await cdp.sendCommand('Runtime.evaluate', {
        expression: '({url: window.location.href, title: document.title})',
        returnByValue: true,
      });
      if (pageResult?.result?.value) {
        pageInfo.url = pageResult.result.value.url || '';
        pageInfo.title = pageResult.result.value.title || '';
        console.log(`[A11y] 📄 Page: "${pageInfo.title}" - ${pageInfo.url}`);
      }
    } catch (e) {
      console.warn('[A11y] ⚠️ Failed to get page info');
    }

    const nodeMap = new Map<string, CdpAxNode>();
    const childCount = new Map<string, number>();
    for (const node of nodes) {
      nodeMap.set(node.nodeId, node);
      if (node.parentId) {
        childCount.set(node.parentId, (childCount.get(node.parentId) || 0) + 1);
      }
    }

    const interactiveNodes: CdpAxNode[] = nodes.filter((node) => {
      if (node.ignored) return false;
      const role = node.role?.value?.toLowerCase() || '';
      const name = node.name?.value || '';
      const focusable = isFocusable(node);
      const hasInteractiveRole = INTERACTIVE_ROLES.has(role);
      if (!focusable && !hasInteractiveRole) return false;
      if (!name && role !== 'checkbox' && role !== 'radio' && role !== 'switch')
        return false;
      return true;
    });

    pageInfo.totalElements = interactiveNodes.length;
    console.log(
      `[A11y] 🎯 Found ${interactiveNodes.length} interactive elements`,
    );

    const elements: AccessibilityNode[] = [];

    for (let i = 0; i < Math.min(interactiveNodes.length, maxElements); i++) {
      const node = interactiveNodes[i];
      const role = node.role?.value?.toLowerCase() || 'unknown';
      const name = node.name?.value || '';
      const shortName = name.length > 40 ? name.substring(0, 40) + '...' : name;

      console.log(
        `\n[A11y] ═══ Element #${i}: [${role}] "${shortName}" (backendDOMNodeId=${node.backendDOMNodeId})`,
      );

      let selector = '';
      let index = 0;
      let bounds: AccessibilityNode['bounds'] = undefined;
      let selectorType = '?';
      let attrMap: Record<string, string> | null = null;
      let domNode: any = null;
      if (node.backendDOMNodeId) {
        try {
          domNode = await cdp.sendCommand('DOM.describeNode', {
            backendNodeId: node.backendDOMNodeId,
            depth: 0,
          });
          if (domNode?.node) {
            const dom = domNode.node;
            const nodeName = dom.nodeName?.toLowerCase() || '?';
            console.log(`[A11y]   DOM: <${nodeName}>`);

            const attrs = (dom.attributes || []) as string[];
            attrMap = {};
            for (let j = 0; j < attrs.length; j += 2) {
              attrMap[attrs[j]] = attrs[j + 1];
            }

            if (attrMap['id']) {
              selector = '#' + CSS.escape(attrMap['id']);
              index = 0;
              selectorType = 'ID';
              console.log(`[A11y]   ✅ SELECTOR (ID): ${selector}`);
            } else if (attrMap['name']) {
              selector = `[name="${CSS.escape(attrMap['name'])}"]`;
              index = 0;
              selectorType = 'NAME';
              console.log(`[A11y]   ✅ SELECTOR (name): ${selector}`);
            } else if (attrMap['data-testid']) {
              selector = `[data-testid="${CSS.escape(attrMap['data-testid'])}"]`;
              index = 0;
              selectorType = 'TESTID';
              console.log(`[A11y]   ✅ SELECTOR (data-testid): ${selector}`);
            } else if (dom.nodeName) {
              const roleSelector = getRoleToSelector(role);
              const escapedName = name
                .replace(/\\/g, '\\\\\\\\')
                .replace(/'/g, "\\\\'")
                .replace(/\n/g, ' ');
              const searchName = escapedName.substring(0, 80);

              console.log(`[A11y]   🔍 Calculating index via DOM query...`);
              console.log(`[A11y]   🔍 roleSelector="${roleSelector}"`);
              console.log(
                `[A11y]   🔍 searchName="${searchName.substring(0, 50)}..."`,
              );

              const indexExpression = `(() => {
                const all = document.querySelectorAll('${roleSelector}');
                console.log('[A11y-INNER] Found', all.length, 'elements for: ${roleSelector}');
                for (let i = 0; i < all.length; i++) {
                  const el = all[i];
                  const text = (el.textContent || '').trim().substring(0, 200);
                  if (text.includes('${searchName}')) {
                    console.log('[A11y-INNER] MATCH idx=' + i + ' text="' + text.substring(0, 40) + '..."');
                    return i;
                  }
                }
                for (let i = 0; i < all.length; i++) {
                  const el = all[i];
                  const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
                  if (aria.includes('${searchName}')) {
                    console.log('[A11y-INNER] MATCH idx=' + i + ' aria="' + aria.substring(0, 40) + '..."');
                    return i;
                  }
                }
                console.log('[A11y-INNER] NO MATCH, returning 0');
                return 0;
              })()`;

              const indexResult: any = await cdp.sendCommand(
                'Runtime.evaluate',
                {
                  expression: indexExpression,
                  returnByValue: true,
                },
              );

              index = indexResult?.result?.value ?? 0;
              selector = roleSelector;
              selectorType = 'QSA';
              console.log(
                `[A11y]   ✅ SELECTOR (qsa): index=${index}, selector="${selector}"`,
              );
            }

            if (domNode.contentSize) {
              bounds = {
                x: domNode.contentSize.x || 0,
                y: domNode.contentSize.y || 0,
                width: domNode.contentSize.width || 0,
                height: domNode.contentSize.height || 0,
              };
            }
          }
        } catch (e) {
          selector = getRoleToSelector(role);
          selectorType = 'FALLBACK-ERR';
          console.warn(
            `[A11y]   ⚠️ DOM.describeNode FAILED, fallback: ${selector}`,
          );
        }
      } else {
        selector = getRoleToSelector(role);
        selectorType = 'FALLBACK-NOID';
        console.log(`[A11y]   ⚠️ No backendDOMNodeId, fallback: ${selector}`);
      }

      const finalSelector = selector || `[role="${role}"]`;
      console.log(
        `[A11y]   📤 OUTPUT: type=${selectorType}, selector="${finalSelector}", index=${index}`,
      );

      const elementData: AccessibilityNode = {
        role,
        name: name.slice(0, 200),
        selector: finalSelector,
        index,
        bounds,
      };

      if (domNode?.node && attrMap) {
        if (role === 'link' && attrMap['href']) {
          elementData.href = attrMap['href'].slice(0, 500);
        }
        if (role === 'textbox' || role === 'searchbox') {
          if (attrMap['type']) elementData.input_type = attrMap['type'];
          if (attrMap['placeholder'])
            elementData.placeholder = attrMap['placeholder'].slice(0, 100);
          if (attrMap['value'])
            elementData.value = attrMap['value'].slice(0, 200);
        }
        if (role === 'checkbox' || role === 'radio') {
          if (attrMap['checked'] !== undefined)
            elementData.checked =
              attrMap['checked'] === 'true' || attrMap['checked'] === '';
        }
        if (attrMap['disabled'] !== undefined)
          elementData.disabled =
            attrMap['disabled'] === 'true' || attrMap['disabled'] === '';
      }

      elements.push(elementData);
    }

    console.log(`\n[A11y] ✅ DONE: ${elements.length} elements processed`);
    return { elements, pageInfo };
  } finally {
  }
}

/**
 * Get accessibility tree command handler
 * This is the main entry point for the get_accessibility_tree command
 */
export async function handleGetAccessibilityTree(
  tabId: number,
  conversationId: string,
  maxElements: number = 50,
): Promise<AccessibilityTreeResult> {
  return getAccessibilityTree(tabId, conversationId, maxElements);
}

export const accessibility = {
  getAccessibilityTree,
  handleGetAccessibilityTree,
};
