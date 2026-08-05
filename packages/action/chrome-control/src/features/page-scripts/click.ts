import type { WebTarget } from "../types.js";

export function pageClick(target: WebTarget) {
  if (target.selector) {
    let selected: Element | null;
    try {
      selected = document.querySelector(target.selector);
    } catch {
      throw new Error(`Invalid CSS selector: ${target.selector}`);
    }
    if (selected instanceof HTMLOptionElement) {
      return { clicked: true, routedToSelect: true, ...pageSelect(target, {}) };
    }
  }

  const match = pageFind(target);
  if (!match) {
    throw new Error(`No visible element matched ${JSON.stringify(target)}`);
  }
  const element = findClickableElement(target);
  if (!(element instanceof HTMLElement)) {
    throw new Error("Matched element cannot be clicked");
  }

  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  element.click();
  return { clicked: true, ...match };

  function findClickableElement(value: WebTarget): Element | null {
    if (value.selector) return document.querySelector(value.selector);
    if (value.label) return elementForLabel(value.label);
    if (value.name) {
      return (
        Array.from(
          document.querySelectorAll("input,textarea,select,button"),
        ).find((item) => item.getAttribute("name") === value.name) ?? null
      );
    }
    if (value.targetText) return elementForText(value.targetText);
    return null;
  }

  function elementForLabel(labelText: string): Element | null {
    const wanted = labelText.trim().toLowerCase();
    const label = Array.from(document.querySelectorAll("label")).find(
      (item) => (item.textContent || "").trim().toLowerCase() === wanted,
    );
    const forId = label?.getAttribute("for");
    if (forId) return document.getElementById(forId);
    return label?.querySelector("input,textarea,select,button") ?? null;
  }

  function elementForText(text: string): Element | null {
    const wanted = normalize(text);
    const candidates = Array.from(
      document.querySelectorAll(
        "button,a,[role=button],input[type=button],input[type=submit],td,div,span",
      ),
    );
    return (
      candidates.find((item) => normalize(textFor(item)) === wanted) ??
      candidates.find((item) => normalize(textFor(item)).includes(wanted)) ??
      null
    );
  }

  function textFor(element: Element): string {
    return element.textContent || element.getAttribute("value") || "";
  }

  function normalize(value: string): string {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
  }
}

declare function pageFind(target: WebTarget): Record<string, unknown> | null;
declare function pageSelect(
  target: WebTarget,
  choice: Record<string, never>,
): Record<string, unknown>;
