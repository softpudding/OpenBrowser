export type MouseButton = 'left' | 'right' | 'middle';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';
export type TabAction =
  | 'open'
  | 'close'
  | 'switch'
  | 'list'
  | 'init'
  | 'refresh'
  | 'view'
  | 'back'
  | 'forward';
export type DialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload';
export type DialogAction = 'accept' | 'dismiss';

export interface BaseCommand {
  type: string;
  command_id?: string;
  timestamp?: number;
  tab_id?: number;
  conversation_id?: string; // For multi-session support
}

export interface MouseMoveCommand extends BaseCommand {
  type: 'mouse_move';
  x: number;
  y: number;
  duration?: number;
}

export interface MouseClickCommand extends BaseCommand {
  type: 'mouse_click';
  button?: MouseButton;
  double?: boolean;
  count?: number;
}

export interface MouseScrollCommand extends BaseCommand {
  type: 'mouse_scroll';
  direction: ScrollDirection;
  amount: number;
}

export interface ResetMouseCommand extends BaseCommand {
  type: 'reset_mouse';
}

export interface KeyboardTypeCommand extends BaseCommand {
  type: 'keyboard_type';
  text: string;
}

export interface KeyboardPressCommand extends BaseCommand {
  type: 'keyboard_press';
  key: string;
  modifiers?: string[];
}

export interface ScreenshotCommand extends BaseCommand {
  type: 'screenshot';
  tab_id?: number;
  include_cursor?: boolean;
  quality?: number;
  include_visual_mouse?: boolean;
}

export interface TabCommand extends BaseCommand {
  type: 'tab';
  action: TabAction;
  url?: string;
  tab_id?: number;
}

export interface GetTabsCommand extends BaseCommand {
  type: 'get_tabs';
  managed_only?: boolean;
}

export interface JavascriptExecuteCommand extends BaseCommand {
  type: 'javascript_execute';
  script: string;
  return_by_value?: boolean;
  await_promise?: boolean;
  timeout?: number;
}

export interface CleanupSessionCommand extends BaseCommand {
  type: 'cleanup_session';
  conversation_id: string;
}

export interface HandleDialogCommand extends BaseCommand {
  type: 'handle_dialog';
  action: DialogAction; // 'accept' or 'dismiss'
  prompt_text?: string; // Required for prompt dialogs
}

export interface GroundedElement {
  id: number;
  type: string;
  text: string;
  selector: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  attributes?: Record<string, any>;
}

export interface GetGroundedElementsCommand extends BaseCommand {
  type: 'get_grounded_elements';
  max_elements?: number;
  include_hidden?: boolean;
}

export interface GetAccessibilityTreeCommand extends BaseCommand {
  type: 'get_accessibility_tree';
  max_elements?: number;
}

// Visual interaction commands
export interface HighlightElementsCommand extends BaseCommand {
  type: 'highlight_elements';
  element_type?: ElementType; // Single element type for stable pagination
  page?: number; // 1-indexed page number for collision-aware pagination
  keywords?: string[]; // Keywords list to filter elements by detected semantic text (no pagination needed when provided)
}

export interface ClickElementCommand extends BaseCommand {
  type: 'click_element';
  /** Element ID from highlight response (short opaque string) */
  element_id: string;
  /**
   * Target tab ID (optional - auto-resolved from conversation if not provided)
   * Note: Required in Python models, but optional here as extension auto-resolves it
   */
  tab_id?: number;
}

export interface HoverElementCommand extends BaseCommand {
  type: 'hover_element';
  /** Element ID from highlight response (short opaque string) */
  element_id: string;
  /**
   * Target tab ID (optional - auto-resolved from conversation if not provided)
   * Note: Required in Python models, but optional here as extension auto-resolves it
   */
  tab_id?: number;
}

export interface ScrollElementCommand extends BaseCommand {
  type: 'scroll_element';
  /** Element ID from highlight response (short opaque string). If not provided, scrolls the entire page */
  element_id?: string;
  direction?: ScrollDirection;
  /** Scroll amount relative to page/element height (0.5 = half page, 1.0 = full page) */
  scroll_amount?: number;
  /**
   * Target tab ID (optional - auto-resolved from conversation if not provided)
   * Note: Required in Python models, but optional here as extension auto-resolves it
   */
  tab_id?: number;
}

export type SwipeDirection = 'next' | 'prev';

export interface SwipeElementCommand extends BaseCommand {
  type: 'swipe_element';
  /** Element ID from highlight response (short opaque string) */
  element_id: string;
  direction?: SwipeDirection;
  /** Number of swipe steps for carousel/swiper interactions */
  swipe_count?: number;
  /**
   * Target tab ID (optional - auto-resolved from conversation if not provided)
   * Note: Required in Python models, but optional here as extension auto-resolves it
   */
  tab_id?: number;
}

export interface KeyboardInputCommand extends BaseCommand {
  type: 'keyboard_input';
  /** Element ID from highlight response (short opaque string) */
  element_id: string;
  text: string;
  /**
   * Target tab ID (optional - auto-resolved from conversation if not provided)
   * Note: Required in Python models, but optional here as extension auto-resolves it
   */
  tab_id?: number;
}

export interface SelectElementCommand extends BaseCommand {
  type: 'select_element';
  /** Element ID from highlight response (short opaque string) */
  element_id: string;
  /** Option value(s) to select. Use string for single select, array for multi-select (<select multiple>) */
  value: string | string[];
  /**
   * Target tab ID (optional - auto-resolved from conversation if not provided)
   * Note: Required in Python models, but optional here as extension auto-resolves it
   */
  tab_id?: number;
}

export interface GetElementHtmlCommand extends BaseCommand {
  type: 'get_element_html';
  element_id: string;
  tab_id?: number; // Optional: uses active tab if not provided
}

export interface HighlightSingleElementCommand extends BaseCommand {
  type: 'highlight_single_element';
  element_id: string;
  intended_action?: 'click' | 'keyboard_input';
  tab_id?: number; // Optional: uses active tab if not provided
}

export interface GroundedElementsResponse {
  success: boolean;
  data?: {
    elements: GroundedElement[];
    pageInfo: {
      url: string;
      title: string;
      totalInteractive: number;
    };
  };
  error?: string;
  timestamp: number;
}

export type Command =
  | MouseMoveCommand
  | MouseClickCommand
  | MouseScrollCommand
  | ResetMouseCommand
  | KeyboardTypeCommand
  | KeyboardPressCommand
  | ScreenshotCommand
  | TabCommand
  | GetTabsCommand
  | JavascriptExecuteCommand
  | CleanupSessionCommand
  | HandleDialogCommand
  | GetGroundedElementsCommand
  | GetAccessibilityTreeCommand
  // Visual interaction commands
  | HighlightElementsCommand
  | ClickElementCommand
  | HoverElementCommand
  | ScrollElementCommand
  | SwipeElementCommand
  | KeyboardInputCommand
  | SelectElementCommand
  | GetElementHtmlCommand
  | HighlightSingleElementCommand;

export interface CommandResponse {
  success: boolean;
  command_id?: string;
  message?: string;
  error?: string;
  data?: any;
  timestamp: number;
  duration?: number;
  // Dialog-related fields
  dialog_opened?: boolean;
  dialog?: {
    type: DialogType;
    message: string;
    url?: string;
    needsDecision: boolean;
  };
  // Tab creation tracking
  new_tabs_created?: Array<{
    tabId: number;
    url: string;
    title?: string;
    loading?: boolean;
  }>;
}

export interface ScreenshotMetadata {
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  timestamp: number;
  tabId: number;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

// Visual interaction types
export type ElementType =
  | 'clickable'
  | 'scrollable'
  | 'inputable'
  | 'hoverable'
  | 'selectable'
  | 'any';

export type InteractionHint = 'swipable';

export interface InteractiveElement {
  id: string; // Element ID: short opaque visual-safe string for the current highlighted document (e.g. "A1H", "Q7M", "X4Y")
  type: ElementType; // Type of interactive element
  interactionHints?: InteractionHint[]; // Extra interaction hints (e.g. swipable carousel region)
  tagName: string; // HTML tag name
  selector: string; // CSS selector to find element
  html?: string; // Optional: full HTML of the element (captured at highlight time)
  text?: string; // Visible text content
  searchText?: string; // Normalized semantic search text used by keyword filtering
  fingerprint?: string; // Stable-ish identity fingerprint used to detect stale snapshot matches
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isVisible: boolean; // Is element visible
  isInViewport: boolean; // Is element in viewport
  labelPosition?: 'above' | 'below' | 'left' | 'right'; // Position of element label
}

export interface HighlightOptions {
  elementType?: ElementType; // Single type to highlight (for stable pagination)
  page?: number; // 1-indexed page number for collision-aware pagination
  scale?: number; // Device pixel ratio for coordinate scaling
  keywords?: string[]; // Keywords list to filter elements by detected semantic text (no pagination needed when provided)
}

export interface ElementActionResult {
  success: boolean;
  elementId?: string | undefined; // Made optional to support page-level operations (where no element_id is provided)
  requestedElementId?: string;
  resolvedElementId?: string;
  elementIdCorrected?: boolean;
  screenshotDataUrl?: string;
  dialogOpened?: boolean;
  dialog?: {
    type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
    message: string;
    defaultValue?: string;
  };
  // Tab creation tracking
  new_tabs_created?: Array<{
    tabId: number;
    url: string;
    title?: string;
    loading?: boolean;
  }>;
}
