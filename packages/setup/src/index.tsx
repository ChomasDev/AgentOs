#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "ink";
import { SetupApp } from "./app.js";
import { loadPackageCatalog } from "./catalog.js";
import {
  buildAgentConfiguration,
  createInitialSelection,
  loadAgentConfiguration,
  saveAgentConfiguration,
} from "./config.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = resolve(packageRoot, "../..");
const defaultOutputPath = resolve(
  repositoryRoot,
  "packages/app-dynamic/src/agent-conf.yaml",
);

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Agent OS setup requires an interactive terminal.");
  }

  const outputPath = parseOutputPath(process.argv.slice(2));
  const catalog = await loadPackageCatalog(repositoryRoot);
  if (catalog.length === 0) {
    throw new Error("No Agent OS package manifests were found.");
  }
  const existing = await loadAgentConfiguration(outputPath);
  const initialSelection = createInitialSelection(catalog, existing);

  const instance = render(
    <SetupApp
      catalog={catalog}
      initialSelection={initialSelection}
      outputPath={outputPath}
      onSave={async (selection) => {
        await saveAgentConfiguration(
          outputPath,
          buildAgentConfiguration(selection),
        );
      }}
    />,
    { alternateScreen: true, exitOnCtrlC: true },
  );
  await instance.waitUntilExit();
}

function parseOutputPath(args: string[]): string {
  const outputIndex = args.findIndex(
    (argument) => argument === "--output" || argument === "-o",
  );
  const supplied = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  return supplied ? resolve(process.cwd(), supplied) : defaultOutputPath;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
