import { delay, normalizeKey } from "./browser-utils.js";
import { BrowserSession } from "./browser-session.js";
import type { CdpConnection } from "./cdp-connection.js";
import { pageClick } from "./page-scripts/click.js";
import { pageFill } from "./page-scripts/fill.js";
import { pageFind } from "./page-scripts/find.js";
import { pageFocus } from "./page-scripts/focus.js";
import { pageSelect } from "./page-scripts/select.js";
import type {
  ChromiumControllerOptions,
  WebActionResult,
  WebControl,
  WebPageSnapshot,
  WebSelectChoice,
  WebSnapshotOptions,
  WebTarget,
} from "./types.js";
import { assertSelectChoice, assertTarget, describeTarget } from "./web-target.js";

export class ChromiumController implements WebControl {
  private readonly session: BrowserSession;

  constructor(options: ChromiumControllerOptions) {
    this.session = new BrowserSession(options);
  }

  async navigate(
    url: string,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    const connection = await this.session.get(signal);
    await connection.send("Page.navigate", { url });
    await this.session.waitUntilReady(connection, signal);
    await delay(options.waitMs ?? 300, signal);
    return this.result({ operation: "navigate", url }, connection, options);
  }

  async snapshot(
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebPageSnapshot> {
    const connection = await this.session.get(signal);
    return this.session.snapshot(connection, options);
  }

  async click(
    target: WebTarget,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    assertTarget(target);
    const connection = await this.session.get(signal);
    const action = await this.session.evaluate<Record<string, unknown>>(
      connection,
      pageClick,
      [target],
    );
    await delay(options.waitMs ?? 500, signal);
    await this.session.waitUntilReady(connection, signal);
    return this.result({ operation: "click", ...action }, connection, options);
  }

  async fill(
    target: WebTarget,
    value: string,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    assertTarget(target);
    const connection = await this.session.get(signal);
    const action = await this.session.evaluate<Record<string, unknown>>(
      connection,
      pageFill,
      [target, value],
    );
    await delay(options.waitMs ?? 150, signal);
    return this.result({ operation: "fill", ...action }, connection, options);
  }

  async select(
    target: WebTarget,
    choice: WebSelectChoice,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    assertTarget(target);
    assertSelectChoice(choice, target);
    const connection = await this.session.get(signal);
    const action = await this.session.evaluate<Record<string, unknown>>(
      connection,
      pageSelect,
      [target, choice],
    );
    await delay(options.waitMs ?? 300, signal);
    return this.result({ operation: "select", ...action }, connection, options);
  }

  async press(
    key: string,
    target?: WebTarget,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    const connection = await this.session.get(signal);
    const normalized = normalizeKey(key);
    const focused = target
      ? await this.session.evaluate<Record<string, unknown>>(
          connection,
          pageFocus,
          [target],
        )
      : undefined;
    await dispatchKey(connection, "keyDown", normalized);
    await dispatchKey(connection, "keyUp", normalized);
    await delay(options.waitMs ?? 300, signal);
    await this.session.waitUntilReady(connection, signal);
    return this.result(
      {
        operation: "press",
        requestedKey: key,
        key: normalized.key,
        pressed: true,
        focused,
      },
      connection,
      options,
    );
  }

  async waitFor(
    target: WebTarget,
    timeoutMs: number,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    assertTarget(target);
    const connection = await this.session.get(signal);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = await this.session.evaluate<Record<string, unknown> | null>(
        connection,
        pageFind,
        [target],
      );
      if (match) {
        return this.result(
          { operation: "wait", found: true, ...match },
          connection,
          options,
        );
      }
      await delay(100, signal);
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${describeTarget(target)}`,
    );
  }

  private async result(
    action: Record<string, unknown>,
    connection: CdpConnection,
    options: WebSnapshotOptions,
  ): Promise<WebActionResult> {
    return { action, page: await this.session.snapshot(connection, options) };
  }
}

interface NormalizedKey {
  key: string;
  code: string;
  virtualKeyCode: number;
  text?: string;
}

function dispatchKey(
  connection: CdpConnection,
  type: "keyDown" | "keyUp",
  key: NormalizedKey,
): Promise<Record<string, unknown>> {
  return connection.send("Input.dispatchKeyEvent", {
    type,
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.virtualKeyCode,
    nativeVirtualKeyCode: key.virtualKeyCode,
    ...(type === "keyDown" && key.text ? { text: key.text } : {}),
  });
}
