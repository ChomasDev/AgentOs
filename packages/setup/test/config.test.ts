import assert from "node:assert/strict";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import {
  buildAgentConfiguration,
  createInitialSelection,
  normalizeRequirements,
  stringifyAgentConfiguration,
} from "../src/config.js";
import type { PackageManifest } from "../src/types.js";

const catalog: PackageManifest[] = [
  manifest("ai-codex", "Codex", [
    iface("ai-codex.ai", "ai", [], [
      { key: "model", default: "gpt-default" },
    ]),
  ]),
  manifest("env-node", "Node Environment", [iface("env-node.env", "env")]),
  manifest("discovery", "Discovery", [iface("discovery.main", "discovery")]),
  manifest("orchestrator", "Orchestrator", [
    iface("orchestrator.main", "orchestrator"),
  ]),
  manifest("agent", "Agent", [iface("agent.main", "agent")]),
  manifest("io-cli", "CLI", [
    iface("io-cli.input", "input"),
    iface("io-cli.output", "output"),
  ]),
  manifest("http", "HTTP", [
    iface("http.input", "input"),
    iface("http.output", "output", ["input"]),
  ]),
];

test("initializes core defaults and the manifest model", () => {
  const selection = createInitialSelection(catalog);

  assert.deepEqual(selection.interfaces.ai, ["ai-codex"]);
  assert.deepEqual(selection.interfaces.input, ["io-cli"]);
  assert.deepEqual(selection.interfaces.output, ["io-cli"]);
  assert.equal(selection.model, "gpt-default");
});

test("adds interfaces required by a selected component", () => {
  const selection = createInitialSelection(catalog);
  selection.interfaces.input = [];
  selection.interfaces.output = ["http"];

  const normalized = normalizeRequirements(selection, catalog);

  assert.deepEqual(normalized.interfaces.input, ["http"]);
  assert.deepEqual(normalized.interfaces.output, ["http"]);
});

test("writes valid agent-conf YAML while preserving model config", () => {
  const selection = createInitialSelection(catalog);
  selection.model = "gpt-custom";

  const source = stringifyAgentConfiguration(
    buildAgentConfiguration(selection),
  );
  const value = parseYaml(source) as {
    interfaces: { ai: Array<{ id: string; config: { model: string } }> };
  };

  assert.equal(value.interfaces.ai[0]?.id, "ai-codex");
  assert.equal(value.interfaces.ai[0]?.config.model, "gpt-custom");
});

function manifest(
  id: string,
  name: string,
  interfaces: PackageManifest["interfaces"],
): PackageManifest {
  return {
    schemaVersion: 1,
    id,
    name,
    version: "0.1.0",
    interfaces,
  };
}

function iface(
  id: string,
  kind: PackageManifest["interfaces"][number]["kind"],
  required: string[] = [],
  config: PackageManifest["interfaces"][number]["config"] = [],
): PackageManifest["interfaces"][number] {
  return {
    id,
    kind,
    permissions: [],
    required,
    config,
  };
}
