export type MouseButton = 'left' | 'right' | 'middle';
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';
export type TabAction = 'open' | 'close' | 'switch' | 'list';

export interface BaseCommand {
  type: string;
  command_id?: string;
  timestamp?: number;
}

export interface MouseMoveCommand extends BaseCommand {
  type: 'mouse_move';
  dx: number;
  dy: number;
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
}

export interface TabCommand extends BaseCommand {
  type: 'tab';
  action: TabAction;
  url?: string;
  tab_id?: number;
}

export interface GetTabsCommand extends BaseCommand {
  type: 'get_tabs';
}

export type Command = 
  | MouseMoveCommand
  | MouseClickCommand
  | MouseScrollCommand
  | KeyboardTypeCommand
  | KeyboardPressCommand
  | ScreenshotCommand
  | TabCommand
  | GetTabsCommand;

export interface CommandResponse {
  success: boolean;
  command_id?: string;
  message?: string;
  error?: string;
  data?: any;
  timestamp: number;
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