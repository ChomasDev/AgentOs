import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

interface ChromiumControllerOptions {
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

interface DevToolsTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

interface CdpMessage {
  id?: number;
  error?: { message?: string };
  result?: unknown;
}

const DEFAULT_HTML_CHARS = 40_000;
const DEFAULT_TEXT_CHARS = 20_000;

export class ChromiumController implements WebControl {
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

  async navigate(
    url: string,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    const connection = await this.getConnection(signal);
    await connection.send("Page.navigate", { url });
    await this.waitUntilReady(connection, this.startupTimeoutMs, signal);
    await delay(options.waitMs ?? 300, signal);
    return {
      action: { operation: "navigate", url },
      page: await this.readSnapshot(connection, options),
    };
  }

  async snapshot(
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebPageSnapshot> {
    return this.readSnapshot(await this.getConnection(signal), options);
  }

  async click(
    target: WebTarget,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    assertTarget(target);
    const connection = await this.getConnection(signal);
    const action = await this.evaluate<Record<string, unknown>>(
      connection,
      pageClick,
      [target],
    );
    await delay(options.waitMs ?? 500, signal);
    await this.waitUntilReady(connection, this.startupTimeoutMs, signal);
    return {
      action: { operation: "click", ...action },
      page: await this.readSnapshot(connection, options),
    };
  }

  async fill(
    target: WebTarget,
    value: string,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    assertTarget(target);
    const connection = await this.getConnection(signal);
    const action = await this.evaluate<Record<string, unknown>>(
      connection,
      pageFill,
      [target, value],
    );
    await delay(options.waitMs ?? 150, signal);
    return {
      action: { operation: "fill", ...action },
      page: await this.readSnapshot(connection, options),
    };
  }

  async select(
    target: WebTarget,
    choice: WebSelectChoice,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    assertTarget(target);
    assertSelectChoice(choice, target);
    const connection = await this.getConnection(signal);
    const action = await this.evaluate<Record<string, unknown>>(
      connection,
      pageSelect,
      [target, choice],
    );
    await delay(options.waitMs ?? 300, signal);
    return {
      action: { operation: "select", ...action },
      page: await this.readSnapshot(connection, options),
    };
  }

  async press(
    key: string,
    target?: WebTarget,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    const connection = await this.getConnection(signal);
    const normalizedKey = normalizeKey(key);
    const focused = target
      ? await this.evaluate<Record<string, unknown>>(
          connection,
          pageFocus,
          [target],
        )
      : undefined;
    await connection.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: normalizedKey.key,
      code: normalizedKey.code,
      windowsVirtualKeyCode: normalizedKey.virtualKeyCode,
      nativeVirtualKeyCode: normalizedKey.virtualKeyCode,
      ...(normalizedKey.text ? { text: normalizedKey.text } : {}),
    });
    await connection.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: normalizedKey.key,
      code: normalizedKey.code,
      windowsVirtualKeyCode: normalizedKey.virtualKeyCode,
      nativeVirtualKeyCode: normalizedKey.virtualKeyCode,
    });
    await delay(options.waitMs ?? 300, signal);
    await this.waitUntilReady(connection, this.startupTimeoutMs, signal);
    return {
      action: {
        operation: "press",
        requestedKey: key,
        key: normalizedKey.key,
        pressed: true,
        focused,
      },
      page: await this.readSnapshot(connection, options),
    };
  }

  async waitFor(
    target: WebTarget,
    timeoutMs: number,
    options: WebSnapshotOptions = {},
    signal?: AbortSignal,
  ): Promise<WebActionResult> {
    assertTarget(target);
    const connection = await this.getConnection(signal);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = await this.evaluate<Record<string, unknown> | null>(
        connection,
        pageFind,
        [target],
      );
      if (match) {
        return {
          action: { operation: "wait", found: true, ...match },
          page: await this.readSnapshot(connection, options),
        };
      }
      await delay(100, signal);
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${describeTarget(target)}`,
    );
  }

  private async getConnection(signal?: AbortSignal): Promise<CdpConnection> {
    if (this.connection?.isOpen()) {
      return this.connection;
    }
    const endpoint = await this.ensureDevToolsEndpoint(signal);
    const targets = await fetchJson<DevToolsTarget[]>(`${endpoint}/json/list`);
    let target = targets.find(
      (candidate) =>
        candidate.type === "page" && candidate.webSocketDebuggerUrl,
    );
    if (!target) {
      target = await fetchJson<DevToolsTarget>(
        `${endpoint}/json/new?${encodeURIComponent("about:blank")}`,
        { method: "PUT" },
      );
    }
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

  private async ensureDevToolsEndpoint(
    signal?: AbortSignal,
  ): Promise<string> {
    await mkdir(this.profileDirectory, { recursive: true });
    const current = await this.readDevToolsEndpoint();
    if (current && (await endpointAvailable(current))) {
      return current;
    }

    await this.launch(
      "open",
      [
        "-na",
        this.browserApp,
        "--args",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${this.profileDirectory}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      signal,
    );

    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      const endpoint = await this.readDevToolsEndpoint();
      if (endpoint && (await endpointAvailable(endpoint))) {
        return endpoint;
      }
      await delay(100, signal);
    }
    throw new Error(
      `Could not connect to ${this.browserApp}. Make sure it is installed and can be opened.`,
    );
  }

  private async readDevToolsEndpoint(): Promise<string | undefined> {
    try {
      const contents = await readFile(
        resolve(this.profileDirectory, "DevToolsActivePort"),
        "utf8",
      );
      const port = Number(contents.split(/\r?\n/, 1)[0]);
      return Number.isInteger(port) && port > 0
        ? `http://127.0.0.1:${port}`
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async waitUntilReady(
    connection: CdpConnection,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.evaluate<string>(
        connection,
        () => document.readyState,
        [],
      );
      if (state === "interactive" || state === "complete") {
        return;
      }
      await delay(100, signal);
    }
  }

  private async readSnapshot(
    connection: CdpConnection,
    options: WebSnapshotOptions,
  ): Promise<WebPageSnapshot> {
    return this.evaluate<WebPageSnapshot>(connection, pageSnapshot, [
      clamp(options.maxHtmlChars ?? DEFAULT_HTML_CHARS, 1_000, 200_000),
      clamp(options.maxTextChars ?? DEFAULT_TEXT_CHARS, 1_000, 100_000),
    ]);
  }

  private async evaluate<T>(
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
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Page script failed",
      );
    }
    return result.result?.value as T;
  }
}

class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
    }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "DevTools error"));
      } else {
        pending.resolve(message.result);
      }
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Browser connection closed"));
      }
      this.pending.clear();
    });
  }

  static connect(url: string, signal?: AbortSignal): Promise<CdpConnection> {
    return new Promise((resolvePromise, reject) => {
      const socket = new WebSocket(url);
      const onAbort = () => {
        socket.close();
        reject(signal?.reason ?? new Error("Browser connection aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      socket.addEventListener(
        "open",
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolvePromise(new CdpConnection(socket));
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          signal?.removeEventListener("abort", onAbort);
          reject(new Error("Could not connect to Chromium DevTools"));
        },
        { once: true },
      );
    });
  }

  isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

function pageSnapshot(maxHtmlChars: number, maxTextChars: number) {
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      box.width > 0 &&
      box.height > 0
    );
  };
  const selectorFor = (element: Element) => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const name = element.getAttribute("name");
    if (name) {
      return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    }
    const parts: string[] = [];
    let item: Element | null = element;
    while (item && parts.length < 5) {
      let part = item.tagName.toLowerCase();
      const siblings = item.parentElement
        ? Array.from(item.parentElement.children).filter(
            (candidate) => candidate.tagName === item?.tagName,
          )
        : [];
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(item) + 1})`;
      }
      parts.unshift(part);
      item = item.parentElement;
    }
    return parts.join(" > ");
  };
  const interactive = Array.from(
    document.querySelectorAll(
      "input,textarea,select,button,a[href],[role=button],[contenteditable=true]",
    ),
  )
    .filter(visible)
    .slice(0, 250)
    .map((element) => {
      const input = element as HTMLInputElement;
      const isPassword =
        element.tagName === "INPUT" &&
        input.type.toLowerCase() === "password";
      return {
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type"),
        id: element.id || null,
        name: element.getAttribute("name"),
        role: element.getAttribute("role"),
        label:
          element.getAttribute("aria-label") ||
          (element.id
            ? document
                .querySelector(`label[for="${CSS.escape(element.id)}"]`)
                ?.textContent?.trim()
            : null),
        placeholder: element.getAttribute("placeholder"),
        text:
          (element.textContent || element.getAttribute("value") || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300),
        value:
          "value" in input
            ? isPassword
              ? input.value
                ? "[redacted]"
                : ""
              : input.value
            : null,
        disabled: "disabled" in input ? input.disabled : false,
        options:
          element instanceof HTMLSelectElement
            ? Array.from(element.options)
                .slice(0, 100)
                .map((option, optionIndex) => ({
                  optionIndex,
                  text: option.text.replace(/\s+/g, " ").trim(),
                  value: option.value,
                  selected: option.selected,
                  disabled: option.disabled,
                }))
            : null,
      };
    });
  const text = (document.body?.innerText || "").trim();
  const safeDocument = document.documentElement?.cloneNode(true) as
    | HTMLElement
    | undefined;
  safeDocument
    ?.querySelectorAll('input[type="password" i]')
    .forEach((input) => input.setAttribute("value", "[redacted]"));
  const html = safeDocument?.outerHTML || "";
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    text: text.slice(0, maxTextChars),
    html: html.slice(0, maxHtmlChars),
    interactiveElements: interactive,
    textTruncated: text.length > maxTextChars,
    htmlTruncated: html.length > maxHtmlChars,
  };
}

function pageFind(target: WebTarget) {
  const normalize = (value: string | null | undefined) =>
    (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      box.width > 0 &&
      box.height > 0
    );
  };
  let element: Element | null = null;
  if (target.selector) {
    try {
      element = document.querySelector(target.selector);
    } catch {
      throw new Error(`Invalid CSS selector: ${target.selector}`);
    }
  } else if (target.label) {
    const wanted = normalize(target.label);
    const label = Array.from(document.querySelectorAll("label")).find(
      (candidate) => normalize(candidate.textContent) === wanted,
    );
    if (label) {
      const forId = label.getAttribute("for");
      element = forId
        ? document.getElementById(forId)
        : label.querySelector("input,textarea,select,button");
    }
  } else if (target.name) {
    element = Array.from(
      document.querySelectorAll("input,textarea,select,button"),
    ).find((candidate) => candidate.getAttribute("name") === target.name) ?? null;
  } else if (target.targetText) {
    const wanted = normalize(target.targetText);
    const candidates = Array.from(
      document.querySelectorAll(
        "button,a,[role=button],input[type=button],input[type=submit],td,div,span",
      ),
    ).filter(visible);
    element =
      candidates.find(
        (candidate) =>
          normalize(
            candidate.textContent || candidate.getAttribute("value"),
          ) === wanted,
      ) ??
      candidates.find((candidate) =>
        normalize(
          candidate.textContent || candidate.getAttribute("value"),
        ).includes(wanted),
      ) ??
      null;
  }
  if (!element || !visible(element)) return null;
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    name: element.getAttribute("name"),
    text: (element.textContent || element.getAttribute("value") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300),
  };
}

function pageClick(target: WebTarget) {
  if (target.selector) {
    let selected: Element | null;
    try {
      selected = document.querySelector(target.selector);
    } catch {
      throw new Error(`Invalid CSS selector: ${target.selector}`);
    }
    if (selected instanceof HTMLOptionElement) {
      return {
        clicked: true,
        routedToSelect: true,
        ...pageSelect(target, {}),
      };
    }
  }
  const match = pageFind(target);
  if (!match) {
    throw new Error(`No visible element matched ${JSON.stringify(target)}`);
  }
  let element: Element | null = null;
  if (target.selector) element = document.querySelector(target.selector);
  if (!element && target.label) {
    const labels = Array.from(document.querySelectorAll("label"));
    const label = labels.find(
      (item) =>
        (item.textContent || "").trim().toLowerCase() ===
        target.label?.trim().toLowerCase(),
    );
    const forId = label?.getAttribute("for");
    element = forId
      ? document.getElementById(forId)
      : label?.querySelector("input,textarea,select,button") ?? null;
  }
  if (!element && target.name) {
    element =
      Array.from(
        document.querySelectorAll("input,textarea,select,button"),
      ).find((item) => item.getAttribute("name") === target.name) ?? null;
  }
  if (!element && target.targetText) {
    const wanted = target.targetText.replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = Array.from(
      document.querySelectorAll(
        "button,a,[role=button],input[type=button],input[type=submit],td,div,span",
      ),
    );
    element =
      candidates.find(
        (item) =>
          (item.textContent || item.getAttribute("value") || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase() === wanted,
      ) ??
      candidates.find((item) =>
        (item.textContent || item.getAttribute("value") || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase()
          .includes(wanted),
      ) ??
      null;
  }
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Matched element cannot be clicked`);
  }
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  element.click();
  return { clicked: true, ...match };
}

function pageSelect(target: WebTarget, choice: WebSelectChoice) {
  const normalize = (value: string | null | undefined) =>
    (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  let element: Element | null = null;
  let optionFromSelector: HTMLOptionElement | null = null;
  if (target.selector) {
    try {
      element = document.querySelector(target.selector);
    } catch {
      throw new Error(`Invalid CSS selector: ${target.selector}`);
    }
    if (element instanceof HTMLOptionElement) {
      optionFromSelector = element;
      element = element.parentElement;
    }
  } else if (target.label) {
    const wanted = normalize(target.label);
    const labels = Array.from(document.querySelectorAll("label"));
    const label =
      labels.find(
        (candidate) => normalize(candidate.textContent) === wanted,
      ) ??
      labels.find((candidate) =>
        normalize(candidate.textContent).includes(wanted),
      );
    const forId = label?.getAttribute("for");
    element = forId
      ? document.getElementById(forId)
      : label?.querySelector("select") ?? null;
  } else if (target.name) {
    element =
      Array.from(document.querySelectorAll("select")).find(
        (candidate) => candidate.getAttribute("name") === target.name,
      ) ?? null;
  } else if (target.targetText) {
    const wanted = normalize(target.targetText);
    element =
      Array.from(document.querySelectorAll("select")).find((candidate) =>
        Array.from(candidate.options).some((option) =>
          normalize(option.text).includes(wanted),
        ),
      ) ?? null;
  }
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(
      `No <select> element matched ${JSON.stringify(target)}. Use web_click for custom dropdown buttons.`,
    );
  }
  if (element.disabled) {
    throw new Error("The matched <select> element is disabled");
  }

  const options = Array.from(element.options);
  let option = optionFromSelector;
  if (choice.optionValue !== undefined) {
    option =
      options.find(
        (candidate) => candidate.value === choice.optionValue,
      ) ?? null;
  } else if (choice.optionText !== undefined) {
    const wanted = normalize(choice.optionText);
    option =
      options.find((candidate) => normalize(candidate.text) === wanted) ??
      options.find((candidate) =>
        normalize(candidate.text).includes(wanted),
      ) ??
      null;
  } else if (choice.optionIndex !== undefined) {
    option = options[choice.optionIndex] ?? null;
  }
  if (!option) {
    throw new Error(
      `No option matched ${JSON.stringify(choice)}. Available options: ${options
        .slice(0, 30)
        .map((candidate, index) => `${index}:${candidate.text}`)
        .join(", ")}`,
    );
  }
  if (option.disabled) {
    throw new Error(`Option "${option.text}" is disabled`);
  }

  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("Select element has no native value setter");
  setter.call(element, option.value);
  element.dispatchEvent(new InputEvent("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (element.selectedIndex !== option.index) {
    throw new Error("The page rejected the selected option");
  }
  return {
    selected: true,
    verified: true,
    selector: target.selector ?? null,
    optionIndex: option.index,
    optionText: option.text.replace(/\s+/g, " ").trim(),
    optionValue: option.value,
  };
}

function pageFocus(target: WebTarget) {
  let element: Element | null = null;
  if (target.selector) {
    try {
      element = document.querySelector(target.selector);
    } catch {
      throw new Error(`Invalid CSS selector: ${target.selector}`);
    }
  } else {
    const match = pageFind(target);
    if (!match) {
      throw new Error(`No visible element matched ${JSON.stringify(target)}`);
    }
    if (target.name) {
      element = Array.from(
        document.querySelectorAll("input,textarea,select,button,a"),
      ).find((candidate) => candidate.getAttribute("name") === target.name) ?? null;
    } else if (target.label) {
      const wanted = target.label.replace(/\s+/g, " ").trim().toLowerCase();
      const label = Array.from(document.querySelectorAll("label")).find(
        (candidate) =>
          (candidate.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase() === wanted,
      );
      const forId = label?.getAttribute("for");
      element = forId
        ? document.getElementById(forId)
        : label?.querySelector("input,textarea,select,button") ?? null;
    } else if (target.targetText) {
      const wanted = target.targetText
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const candidates = Array.from(
        document.querySelectorAll(
          "button,a,[role=button],input,textarea,select",
        ),
      );
      element =
        candidates.find(
          (candidate) =>
            (candidate.textContent ||
              candidate.getAttribute("value") ||
              candidate.getAttribute("aria-label") ||
              "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase() === wanted,
        ) ?? null;
    }
  }
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Matched element cannot be focused`);
  }
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  return {
    focused: document.activeElement === element,
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    name: element.getAttribute("name"),
  };
}

function pageFill(target: WebTarget, value: string) {
  const match = pageFind(target);
  if (!match) {
    throw new Error(`No visible field matched ${JSON.stringify(target)}`);
  }
  let element: Element | null = null;
  if (target.selector) element = document.querySelector(target.selector);
  if (!element && target.label) {
    const wanted = target.label.replace(/\s+/g, " ").trim().toLowerCase();
    const label = Array.from(document.querySelectorAll("label")).find(
      (candidate) =>
        (candidate.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase() === wanted,
    );
    const forId = label?.getAttribute("for");
    element = forId
      ? document.getElementById(forId)
      : label?.querySelector("input,textarea,select") ?? null;
  }
  if (!element && target.name) {
    element =
      Array.from(document.querySelectorAll("input,textarea,select")).find(
        (candidate) => candidate.getAttribute("name") === target.name,
      ) ?? null;
  }
  if (
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )
  ) {
    throw new Error("Matched element is not a form field");
  }
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("Form field has no native value setter");
  setter.call(element, value);
  element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (element.value !== value) {
    throw new Error("The page rejected the field value");
  }
  const password =
    element instanceof HTMLInputElement &&
    element.type.toLowerCase() === "password";
  return {
    filled: true,
    verified: true,
    value: password ? "[redacted]" : element.value,
    ...match,
  };
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`DevTools request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

async function endpointAvailable(endpoint: string): Promise<boolean> {
  try {
    await fetchJson(`${endpoint}/json/version`);
    return true;
  } catch {
    return false;
  }
}

function assertTarget(target: WebTarget): void {
  if (
    !target.selector?.trim() &&
    !target.targetText?.trim() &&
    !target.label?.trim() &&
    !target.name?.trim()
  ) {
    throw new Error(
      "Provide one of selector, targetText, label, or name to identify the element",
    );
  }
}

function assertSelectChoice(
  choice: WebSelectChoice,
  target: WebTarget,
): void {
  const selectorTargetsOption = target.selector
    ?.toLowerCase()
    .includes("option");
  if (
    choice.optionText === undefined &&
    choice.optionValue === undefined &&
    choice.optionIndex === undefined &&
    !selectorTargetsOption
  ) {
    throw new Error(
      "Provide optionText, optionValue, or optionIndex for web_select",
    );
  }
  if (
    choice.optionIndex !== undefined &&
    (!Number.isInteger(choice.optionIndex) || choice.optionIndex < 0)
  ) {
    throw new Error("optionIndex must be a non-negative integer");
  }
}

function describeTarget(target: WebTarget): string {
  return (
    target.selector ??
    target.targetText ??
    target.label ??
    target.name ??
    "element"
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeKey(value: string): {
  key: string;
  code: string;
  virtualKeyCode: number;
  text?: string;
} {
  const normalized = value.trim().toLowerCase();
  const special: Record<
    string,
    { key: string; code: string; virtualKeyCode: number }
  > = {
    return: { key: "Enter", code: "Enter", virtualKeyCode: 13 },
    enter: { key: "Enter", code: "Enter", virtualKeyCode: 13 },
    tab: { key: "Tab", code: "Tab", virtualKeyCode: 9 },
    escape: { key: "Escape", code: "Escape", virtualKeyCode: 27 },
    esc: { key: "Escape", code: "Escape", virtualKeyCode: 27 },
    space: { key: " ", code: "Space", virtualKeyCode: 32 },
    up: { key: "ArrowUp", code: "ArrowUp", virtualKeyCode: 38 },
    down: { key: "ArrowDown", code: "ArrowDown", virtualKeyCode: 40 },
    left: { key: "ArrowLeft", code: "ArrowLeft", virtualKeyCode: 37 },
    right: { key: "ArrowRight", code: "ArrowRight", virtualKeyCode: 39 },
  };
  const mapped = special[normalized];
  if (mapped) return mapped;
  if (value.length === 1) {
    const upper = value.toUpperCase();
    return {
      key: value,
      code: /[a-z]/i.test(value) ? `Key${upper}` : value,
      virtualKeyCode: upper.charCodeAt(0),
      text: value,
    };
  }
  return {
    key: value,
    code: value,
    virtualKeyCode: 0,
  };
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Operation aborted"));
      },
      { once: true },
    );
  });
}
