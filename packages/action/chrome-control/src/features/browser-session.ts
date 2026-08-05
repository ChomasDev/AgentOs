import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clamp, delay, endpointAvailable, fetchJson } from "./browser-utils.js";
import { CdpConnection } from "./cdp-connection.js";
import { pageFind } from "./page-scripts/find.js";
import { pageSelect } from "./page-scripts/select.js";
import { pageSnapshot } from "./page-scripts/snapshot.js";
import type {
  ChromiumControllerOptions,
  WebPageSnapshot,
  WebSnapshotOptions,
} from "./types.js";

interface DevToolsTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

const DEFAULT_HTML_CHARS = 40_000;
const DEFAULT_TEXT_CHARS = 20_000;

export class BrowserSession {
  private readonly browserApp: string;
  private readonly launch: ChromiumControllerOptions["launch"];
  private readonly profileDirectory: string;
  private readonly startupTimeoutMs: number;
  private connection?: CdpConnection;

  constructor(options: ChromiumControllerOptions) {
    this.browserApp = options.browserApp;
    this.launch = options.launch;
    this.profileDirectory =
      options.profileDirectory ??
      resolve(options.cwd, ".agent-os", "browser-profile");
    this.startupTimeoutMs = options.startupTimeoutMs;
  }

  async get(signal?: AbortSignal): Promise<CdpConnection> {
    if (this.connection?.isOpen()) return this.connection;

    const endpoint = await this.ensureDevToolsEndpoint(signal);
    const targets = await fetchJson<DevToolsTarget[]>(`${endpoint}/json/list`);
    const target =
      targets.find(
        (candidate) =>
          candidate.type === "page" && candidate.webSocketDebuggerUrl,
      ) ?? (await this.createTarget(endpoint));
    if (!target.webSocketDebuggerUrl) {
      throw new Error("Chromium did not expose a controllable page");
    }

    this.connection = await CdpConnection.connect(
      target.webSocketDebuggerUrl,
      signal,
    );
    await this.connection.send("Page.enable");
    await this.connection.send("Runtime.enable");
    return this.connection;
  }

  async snapshot(
    connection: CdpConnection,
    options: WebSnapshotOptions,
  ): Promise<WebPageSnapshot> {
    return this.evaluate<WebPageSnapshot>(connection, pageSnapshot, [
      clamp(options.maxHtmlChars ?? DEFAULT_HTML_CHARS, 1_000, 200_000),
      clamp(options.maxTextChars ?? DEFAULT_TEXT_CHARS, 1_000, 100_000),
    ]);
  }

  async waitUntilReady(
    connection: CdpConnection,
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      const state = await this.evaluate<string>(
        connection,
        () => document.readyState,
        [],
      );
      if (state === "interactive" || state === "complete") return;
      await delay(100, signal);
    }
  }

  async evaluate<T>(
    connection: CdpConnection,
    functionValue: (...args: never[]) => unknown,
    args: readonly unknown[],
  ): Promise<T> {
    const expression =
      `(() => { const pageFind = (${String(pageFind)}); ` +
      `const pageSelect = (${String(pageSelect)}); ` +
      `return (${String(functionValue)})(...${JSON.stringify(args)}); })()`;
    const result = await connection.send<{
      exceptionDetails?: { text?: string; exception?: { description?: string } };
      result?: { value?: unknown };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (!result.exceptionDetails) return result.result?.value as T;
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Page script failed",
    );
  }

  private createTarget(endpoint: string): Promise<DevToolsTarget> {
    return fetchJson<DevToolsTarget>(
      `${endpoint}/json/new?${encodeURIComponent("about:blank")}`,
      { method: "PUT" },
    );
  }

  private async ensureDevToolsEndpoint(signal?: AbortSignal): Promise<string> {
    await mkdir(this.profileDirectory, { recursive: true });
    const current = await this.readDevToolsEndpoint();
    if (current && (await endpointAvailable(current))) return current;

    await this.launch("open", this.launchArguments(), signal);
    const endpoint = await this.waitForEndpoint(signal);
    if (endpoint) return endpoint;
    throw new Error(
      `Could not connect to ${this.browserApp}. Make sure it is installed and can be opened.`,
    );
  }

  private launchArguments(): string[] {
    return [
      "-na",
      this.browserApp,
      "--args",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${this.profileDirectory}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ];
  }

  private async waitForEndpoint(signal?: AbortSignal) {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      const endpoint = await this.readDevToolsEndpoint();
      if (endpoint && (await endpointAvailable(endpoint))) return endpoint;
      await delay(100, signal);
    }
    return undefined;
  }

  private async readDevToolsEndpoint(): Promise<string | undefined> {
    try {
      const contents = await readFile(
        resolve(this.profileDirectory, "DevToolsActivePort"),
        "utf8",
      );
      const port = Number(contents.split(/\r?\n/, 1)[0]);
      if (Number.isInteger(port) && port > 0) {
        return `http://127.0.0.1:${port}`;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
