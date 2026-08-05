import type { WebTarget } from "../types.js";

export function pageFill(target: WebTarget, value: string) {
  const match = pageFind(target);
  if (!match) {
    throw new Error(`No visible field matched ${JSON.stringify(target)}`);
  }

  const element = findField();
  if (!isFormField(element)) {
    throw new Error("Matched element is not a form field");
  }

  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  const prototype = prototypeFor(element);
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

  function findField(): Element | null {
    if (target.selector) return document.querySelector(target.selector);
    if (target.label) return fieldForLabel(target.label);
    if (target.name) {
      return (
        Array.from(document.querySelectorAll("input,textarea,select")).find(
          (item) => item.getAttribute("name") === target.name,
        ) ?? null
      );
    }
    return null;
  }

  function fieldForLabel(labelText: string): Element | null {
    const wanted = labelText.replace(/\s+/g, " ").trim().toLowerCase();
    const label = Array.from(document.querySelectorAll("label")).find(
      (item) =>
        (item.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() ===
        wanted,
    );
    const forId = label?.getAttribute("for");
    if (forId) return document.getElementById(forId);
    return label?.querySelector("input,textarea,select") ?? null;
  }

  function isFormField(
    candidate: Element | null,
  ): candidate is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    return (
      candidate instanceof HTMLInputElement ||
      candidate instanceof HTMLTextAreaElement ||
      candidate instanceof HTMLSelectElement
    );
  }

  function prototypeFor(
    field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ): object {
    if (field instanceof HTMLTextAreaElement) return HTMLTextAreaElement.prototype;
    if (field instanceof HTMLSelectElement) return HTMLSelectElement.prototype;
    return HTMLInputElement.prototype;
  }
}

declare function pageFind(target: WebTarget): Record<string, unknown> | null;
