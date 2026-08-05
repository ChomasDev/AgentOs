import type { WebTarget } from "../types.js";

export function pageFind(target: WebTarget) {
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
    element =
      Array.from(
        document.querySelectorAll("input,textarea,select,button"),
      ).find((candidate) => candidate.getAttribute("name") === target.name) ??
      null;
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
          normalize(candidate.textContent || candidate.getAttribute("value")) ===
          wanted,
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
