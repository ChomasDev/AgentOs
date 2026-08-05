export interface WebPageSnapshot extends Record<string, unknown> {
  url: string;
  title: string;
  readyState: string;
  text: string;
  html: string;
  interactiveElements: readonly Record<string, unknown>[];
  textTruncated: boolean;
  htmlTruncated: boolean;
}

export interface WebActionResult extends Record<string, unknown> {
  action: Record<string, unknown>;
  page: WebPageSnapshot;
}

export interface WebTarget {
  selector?: string;
  targetText?: string;
  label?: string;
  name?: string;
}

export interface WebSnapshotOptions {
  maxHtmlChars?: number;
  maxTextChars?: number;
  waitMs?: number;
}

export interface WebSelectChoice {
  optionText?: string;
  optionValue?: string;
  optionIndex?: number;
}

export interface WebControl {
  navigate(
    url: string,
    options?: WebSnapshotOptions,
    signal?: AbortSignal,
  ): Promise<WebActionResult>;
  snapshot(
    options?: WebSnapshotOptions,
    signal?: AbortSignal,
  ): Promise<WebPageSnapshot>;
  click(
    target: WebTarget,
    options?: WebSnapshotOptions,
    signal?: AbortSignal,
  ): Promise<WebActionResult>;
  fill(
    target: WebTarget,
    value: string,
    options?: WebSnapshotOptions,
    signal?: AbortSignal,
  ): Promise<WebActionResult>;
  select(
    target: WebTarget,
    choice: WebSelectChoice,
    options?: WebSnapshotOptions,
    signal?: AbortSignal,
  ): Promise<WebActionResult>;
  press(
    key: string,
    target?: WebTarget,
    options?: WebSnapshotOptions,
    signal?: AbortSignal,
  ): Promise<WebActionResult>;
  waitFor(
    target: WebTarget,
    timeoutMs: number,
    options?: WebSnapshotOptions,
    signal?: AbortSignal,
  ): Promise<WebActionResult>;
}

export interface ChromiumControllerOptions {
  browserApp: string;
  cwd: string;
  launch: (
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
  ) => Promise<unknown>;
  profileDirectory?: string;
  startupTimeoutMs: number;
}

export type ChromeControlOperation =
  | "web_open"
  | "web_snapshot"
  | "web_click"
  | "web_fill"
  | "web_select"
  | "web_press"
  | "web_wait";

export interface ChromeControlInput {
  operation: ChromeControlOperation;
  url?: string;
  selector?: string;
  targetText?: string;
  label?: string;
  name?: string;
  value?: string;
  key?: string;
  waitMs?: number;
  maxHtmlChars?: number;
  maxTextChars?: number;
  timeoutMs?: number;
  optionText?: string;
  optionValue?: string;
  optionIndex?: number;
}

export interface ChromeCommandResult {
  stdout: string;
  stderr: string;
}

export type ChromeCommandRunner = (
  command: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs: number },
) => Promise<ChromeCommandResult>;

export interface ChromeControlOptions {
  browserApp?: string;
  browserProfileDirectory?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  runner?: ChromeCommandRunner;
  timeoutMs?: number;
  webController?: WebControl;
  webStartupTimeoutMs?: number;
}
