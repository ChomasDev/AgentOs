export function pageSnapshot(maxHtmlChars: number, maxTextChars: number) {
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
  const valueFor = (input: HTMLInputElement, isPassword: boolean) => {
    if (!("value" in input)) return null;
    if (!isPassword) return input.value;
    return input.value ? "[redacted]" : "";
  };
  const optionsFor = (element: Element) => {
    if (!(element instanceof HTMLSelectElement)) return null;
    return Array.from(element.options)
      .slice(0, 100)
      .map((option, optionIndex) => ({
        optionIndex,
        text: option.text.replace(/\s+/g, " ").trim(),
        value: option.value,
        selected: option.selected,
        disabled: option.disabled,
      }));
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
        element.tagName === "INPUT" && input.type.toLowerCase() === "password";
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
        text: (element.textContent || element.getAttribute("value") || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 300),
        value: valueFor(input, isPassword),
        disabled: "disabled" in input ? input.disabled : false,
        options: optionsFor(element),
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
