import type { WebSelectChoice, WebTarget } from "./types.js";

export function assertTarget(target: WebTarget): void {
  if (
    target.selector?.trim() ||
    target.targetText?.trim() ||
    target.label?.trim() ||
    target.name?.trim()
  ) {
    return;
  }
  throw new Error(
    "Provide one of selector, targetText, label, or name to identify the element",
  );
}

export function assertSelectChoice(
  choice: WebSelectChoice,
  target: WebTarget,
): void {
  const selectorTargetsOption = target.selector
    ?.toLowerCase()
    .includes("option");
  const hasChoice =
    choice.optionText !== undefined ||
    choice.optionValue !== undefined ||
    choice.optionIndex !== undefined;
  if (!hasChoice && !selectorTargetsOption) {
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

export function describeTarget(target: WebTarget): string {
  return (
    target.selector ??
    target.targetText ??
    target.label ??
    target.name ??
    "element"
  );
}
