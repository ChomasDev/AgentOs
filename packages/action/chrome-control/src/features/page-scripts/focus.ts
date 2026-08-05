import type { WebTarget } from "../types.js";

export function pageFocus(target: WebTarget) {
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
    element = findWithoutSelector();
  }

  if (!(element instanceof HTMLElement)) {
    throw new Error("Matched element cannot be focused");
  }
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  return {
    focused: document.activeElement === element,
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    name: element.getAttribute("name"),
  };

  function findWithoutSelector(): Element | null {
    if (target.name) {
      return (
        Array.from(
          document.querySelectorAll("input,textarea,select,button,a"),
        ).find((item) => item.getAttribute("name") === target.name) ?? null
      );
    }
    if (target.label) return fieldForLabel(target.label);
    if (target.targetText) return elementForText(target.targetText);
    return null;
  }

  function fieldForLabel(labelText: string): Element | null {
    const wanted = normalize(labelText);
    const label = Array.from(document.querySelectorAll("label")).find(
      (item) => normalize(item.textContent || "") === wanted,
    );
    const forId = label?.getAttribute("for");
    if (forId) return document.getElementById(forId);
    return label?.querySelector("input,textarea,select,button") ?? null;
  }

  function elementForText(text: string): Element | null {
    const wanted = normalize(text);
    return (
      Array.from(
        document.querySelectorAll(
          "button,a,[role=button],input,textarea,select",
        ),
      ).find(
        (item) =>
          normalize(
            item.textContent ||
              item.getAttribute("value") ||
              item.getAttribute("aria-label") ||
              "",
          ) === wanted,
      ) ?? null
    );
  }

  function normalize(value: string): string {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
  }
}

declare function pageFind(target: WebTarget): Record<string, unknown> | null;
