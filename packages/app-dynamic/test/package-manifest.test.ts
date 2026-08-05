import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parsePackageManifest,
  parseInstallSelection,
  resolveRequiredInterfaces,
  stringifyInstallSelection,
} from "../src/utils/package-manifest.js";

const manifestSource = `
schemaVersion: 1
id: chat-http
name: Chat HTTP
version: 0.1.0
interfaces:
  - id: chat-http.input
    kind: input
    name: HTTP input
    permissions: [network.inbound]
  - id: chat-http.output
    kind: output
    name: HTTP output
    permissions: [network.inbound]
    required: [input]
  - id: chat-http.action
    kind: action
    name: Admin action
    permissions: [chat.admin]
`;

test("parses package identity, kinds, permissions, and dependencies", () => {
  const manifest = parsePackageManifest(manifestSource);

  assert.equal(manifest.id, "chat-http");
  assert.equal(manifest.interfaces[1]?.kind, "output");
  assert.deepEqual(manifest.interfaces[1]?.permissions, ["network.inbound"]);
  assert.deepEqual(manifest.interfaces[1]?.required, ["input"]);
});

test("selecting an interface includes required kinds", () => {
  const manifest = parsePackageManifest(manifestSource);

  assert.deepEqual(
    [...resolveRequiredInterfaces(manifest, ["chat-http.output"])].sort(),
    ["chat-http.input", "chat-http.output"],
  );
});

test("round-trips the installed component selection", () => {
  const selection = {
    schemaVersion: 1 as const,
    package: "chat-http",
    interfaces: ["chat-http.input"],
  };

  assert.deepEqual(
    parseInstallSelection(stringifyInstallSelection(selection)),
    selection,
  );
});

test("rejects dependencies which are not in the package", () => {
  assert.throws(
    () =>
      parsePackageManifest(
        manifestSource.replace("required: [input]", "required: [unknown-kind]"),
      ),
    /requires unknown interface or kind "unknown-kind"/,
  );
});

test("all workspace capability packages have a valid YAML manifest", async () => {
  const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const packagesRoot = join(repositoryRoot, "packages");
  const manifests: string[] = [];

  for (const kind of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!kind.isDirectory()) {
      continue;
    }
    const kindRoot = join(packagesRoot, kind.name);
    for (const implementation of await readdir(kindRoot, {
      withFileTypes: true,
    })) {
      if (!implementation.isDirectory()) {
        continue;
      }
      const packageRoot = join(kindRoot, implementation.name);
      try {
        await readFile(join(packageRoot, "package.json"), "utf8");
      } catch {
        continue;
      }
      const manifestPath = join(packageRoot, "agent-os.package.yaml");
      manifests.push(manifestPath);
      parsePackageManifest(await readFile(manifestPath, "utf8"));
    }
  }

  assert.equal(manifests.length, 17);
});
