import { ValidationError } from "./errors.js";
import type { AccessibilityLimits, MacOSControlInput } from "./types.js";

export function coordinates(input: MacOSControlInput): { x: number; y: number } {
  return {
    x: finiteNumber(input.x, "x"),
    y: finiteNumber(input.y, "y"),
  };
}

export function accessibilityLimits(
  input: MacOSControlInput,
  defaults: AccessibilityLimits,
): AccessibilityLimits {
  return {
    depth: clampInteger(input.depth ?? defaults.depth, 0, 20),
    maxElements: clampInteger(
      input.maxElements ?? defaults.maxElements,
      1,
      5_000,
    ),
  };
}

export function finiteNumber(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new ValidationError(`Input '${name}' must be a finite number`);
}

export function clampInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(`Expected an integer between ${min} and ${max}`);
  }
  return Math.min(max, Math.max(min, value));
}

export function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new ValidationError(`Input '${name}' must be a non-negative integer`);
}

export function requiredText(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  throw new ValidationError(`Input '${name}' is required`);
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  throw new ValidationError(`Input '${name}' is required`);
}

export function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (milliseconds === 0) return Promise.resolve();

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
