import { ValidationError } from "./errors.js";
import type {
  ChromeControlInput,
  WebSelectChoice,
  WebSnapshotOptions,
  WebTarget,
} from "./types.js";

export function requiredTarget(input: ChromeControlInput): WebTarget {
  const target = optionalTarget(input);
  if (target) return target;
  throw new ValidationError(
    "Provide selector, targetText, label, or name for this web operation",
  );
}

export function optionalTarget(
  input: ChromeControlInput,
): WebTarget | undefined {
  const target: WebTarget = {
    selector: optionalText(input.selector),
    targetText: optionalText(input.targetText),
    label: optionalText(input.label),
    name: optionalText(input.name),
  };
  if (target.selector || target.targetText || target.label || target.name) {
    return target;
  }
  return undefined;
}

export function selectChoice(input: ChromeControlInput): WebSelectChoice {
  const choice: WebSelectChoice = {
    optionText: optionalText(input.optionText),
    optionValue:
      typeof input.optionValue === "string" ? input.optionValue : undefined,
    optionIndex:
      input.optionIndex === undefined
        ? undefined
        : nonNegativeInteger(input.optionIndex, "optionIndex"),
  };
  const values = [choice.optionText, choice.optionValue, choice.optionIndex];
  const count = values.filter((value) => value !== undefined).length;
  const selectorTargetsOption = optionalText(input.selector)
    ?.toLowerCase()
    .includes("option");

  if (count > 1) {
    throw new ValidationError(
      "Provide only one of optionText, optionValue, or optionIndex",
    );
  }
  if (count === 1 || selectorTargetsOption) return choice;
  throw new ValidationError(
    "Provide optionText, optionValue, or optionIndex for web_select",
  );
}

export function snapshotOptions(
  input: ChromeControlInput,
): WebSnapshotOptions {
  return {
    waitMs: optionalInteger(input.waitMs, 0, 10_000),
    maxHtmlChars: optionalInteger(input.maxHtmlChars, 1_000, 200_000),
    maxTextChars: optionalInteger(input.maxTextChars, 1_000, 100_000),
  };
}

export function requiredUrl(value: unknown): string {
  const url = requiredText(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("Input 'url' must be an absolute URL");
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.href;
  }
  throw new ValidationError("Input 'url' must use http or https");
}

export function requiredText(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  throw new ValidationError(`Input '${name}' is required`);
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  throw new ValidationError(`Input '${name}' is required`);
}

export function clampInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(`Expected an integer between ${min} and ${max}`);
  }
  return Math.min(max, Math.max(min, value));
}

function optionalInteger(
  value: number | undefined,
  min: number,
  max: number,
): number | undefined {
  return value === undefined ? undefined : clampInteger(value, min, max);
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new ValidationError(`Input '${name}' must be a non-negative integer`);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}
