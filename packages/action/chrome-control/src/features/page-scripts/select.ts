import type { WebSelectChoice, WebTarget } from "../types.js";

export function pageSelect(target: WebTarget, choice: WebSelectChoice) {
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
    element = selectForLabel(target.label);
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
  if (element.disabled) throw new Error("The matched <select> element is disabled");

  const options = Array.from(element.options);
  const option = findOption(options, optionFromSelector);
  if (!option) {
    const available = options
      .slice(0, 30)
      .map((candidate, index) => `${index}:${candidate.text}`)
      .join(", ");
    throw new Error(
      `No option matched ${JSON.stringify(choice)}. Available options: ${available}`,
    );
  }
  if (option.disabled) throw new Error(`Option "${option.text}" is disabled`);

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

  function selectForLabel(labelText: string): Element | null {
    const wanted = normalize(labelText);
    const labels = Array.from(document.querySelectorAll("label"));
    const label =
      labels.find((candidate) => normalize(candidate.textContent) === wanted) ??
      labels.find((candidate) =>
        normalize(candidate.textContent).includes(wanted),
      );
    const forId = label?.getAttribute("for");
    if (forId) return document.getElementById(forId);
    return label?.querySelector("select") ?? null;
  }

  function findOption(
    options: HTMLOptionElement[],
    fallback: HTMLOptionElement | null,
  ): HTMLOptionElement | null {
    if (choice.optionValue !== undefined) {
      return options.find((item) => item.value === choice.optionValue) ?? null;
    }
    if (choice.optionText !== undefined) {
      const wanted = normalize(choice.optionText);
      return (
        options.find((item) => normalize(item.text) === wanted) ??
        options.find((item) => normalize(item.text).includes(wanted)) ??
        null
      );
    }
    if (choice.optionIndex !== undefined) {
      return options[choice.optionIndex] ?? null;
    }
    return fallback;
  }
}
