export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`DevTools request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function endpointAvailable(endpoint: string): Promise<boolean> {
  try {
    await fetchJson(`${endpoint}/json/version`);
    return true;
  } catch {
    return false;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizeKey(value: string): {
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
  if (value.length !== 1) {
    return { key: value, code: value, virtualKeyCode: 0 };
  }

  const upper = value.toUpperCase();
  return {
    key: value,
    code: /[a-z]/i.test(value) ? `Key${upper}` : value,
    virtualKeyCode: upper.charCodeAt(0),
    text: value,
  };
}

export function delay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
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
