export type MacOSControlOperation =
  | "permissions"
  | "open_app"
  | "focus_app"
  | "quit_app"
  | "list_apps"
  | "get_accessibility_tree"
  | "get_app_state"
  | "click_element"
  | "set_element_value"
  | "perform_element_action"
  | "move_mouse"
  | "click"
  | "drag"
  | "scroll"
  | "type_text"
  | "press_key"
  | "screenshot";

export interface MacOSControlInput {
  operation: MacOSControlOperation;
  app?: string;
  text?: string;
  key?: string;
  modifiers?: readonly ("command" | "control" | "option" | "shift")[];
  x?: number;
  y?: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  button?: "left" | "right" | "center";
  clicks?: number;
  durationMs?: number;
  steps?: number;
  deltaX?: number;
  deltaY?: number;
  path?: string;
  depth?: number;
  maxElements?: number;
  value?: string;
  waitMs?: number;
  elementIndex?: number;
  action?: string;
  includeScreenshot?: boolean;
}

export interface NativeCommandResult {
  stdout: string;
  stderr: string;
}

export type NativeCommandRunner = (
  command: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs: number },
) => Promise<NativeCommandResult>;

export interface MacOSPermissionStatus {
  accessibility: boolean | null;
  automation: boolean | null;
  screenRecording: boolean | null;
  requested: boolean;
  guidance?: string;
}

export interface MacOSControlOptions {
  cwd?: string;
  maxAccessibilityDepth?: number;
  maxAccessibilityElements?: number;
  platform?: NodeJS.Platform;
  requestPermissionsOnInit?: boolean;
  runner?: NativeCommandRunner;
  timeoutMs?: number;
}

export interface AccessibilityLimits {
  depth: number;
  maxElements: number;
}
