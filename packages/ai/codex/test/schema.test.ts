import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCodexOutputSchema } from "../src/index.js";

test("normalizes optional capability arguments for Codex strict output", () => {
  const normalized = normalizeCodexOutputSchema({
    type: "object",
    properties: {
      operation: { type: "string" },
      app: { type: "string" },
      options: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          label: { type: ["string", "null"] },
        },
        required: ["enabled"],
      },
    },
    required: ["operation"],
  });

  assert.deepEqual(normalized, {
    type: "object",
    properties: {
      operation: { type: "string" },
      app: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      options: {
        anyOf: [
          {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              label: { type: ["string", "null"] },
            },
            required: ["enabled", "label"],
            additionalProperties: false,
          },
          { type: "null" },
        ],
      },
    },
    required: ["operation", "app", "options"],
    additionalProperties: false,
  });
});

test("does not add a second null branch to an already nullable property", () => {
  const normalized = normalizeCodexOutputSchema({
    type: "object",
    properties: {
      value: {
        anyOf: [{ type: "number" }, { type: "null" }],
      },
    },
  });

  assert.deepEqual(normalized.properties, {
    value: {
      anyOf: [{ type: "number" }, { type: "null" }],
    },
  });
  assert.deepEqual(normalized.required, ["value"]);
});
