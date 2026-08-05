import type { CapabilityManifest } from "@agent-os/core/domain";

export const chromeControlManifest: CapabilityManifest = {
  id: "chrome.control",
  version: "0.1.0",
  name: "control_chrome",
  description:
    "Controls websites in a dedicated Chrome profile through Chromium DevTools and returns fresh page state.",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: [
          "web_open",
          "web_snapshot",
          "web_click",
          "web_fill",
          "web_select",
          "web_press",
          "web_wait",
        ],
      },
      url: { type: "string", description: "URL for web_open." },
      selector: { type: "string", description: "CSS selector for an element." },
      targetText: { type: "string", description: "Visible element text." },
      label: { type: "string", description: "Visible form-field label." },
      name: { type: "string", description: "HTML name attribute." },
      value: {
        type: "string",
        description: "Value for web_fill. Passwords are redacted in results.",
      },
      key: { type: "string", description: "Key for web_press." },
      waitMs: { type: "integer", minimum: 0, maximum: 10_000 },
      maxHtmlChars: { type: "integer", minimum: 1_000, maximum: 200_000 },
      maxTextChars: { type: "integer", minimum: 1_000, maximum: 100_000 },
      timeoutMs: {
        type: "integer",
        minimum: 100,
        maximum: 30_000,
        description: "Timeout for web_wait.",
      },
      optionText: { type: "string", description: "Visible option text." },
      optionValue: { type: "string", description: "HTML option value." },
      optionIndex: {
        type: "integer",
        minimum: 0,
        description: "Zero-based option index.",
      },
    },
    required: ["operation"],
    additionalProperties: false,
  },
  outputSchema: { type: "object", additionalProperties: true },
  permissions: ["filesystem.write"],
  tags: ["browser", "chrome", "chromium", "html", "dom", "web"],
  execution: { timeoutMs: 30_000, idempotent: false },
};
