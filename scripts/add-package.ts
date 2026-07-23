#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const mockupsDir = join(scriptDir, "mockups");

type Kind =
  | "input"
  | "output"
  | "action"
  | "ai"
  | "env"
  | "discovery"
  | "agent";

interface KindConfig {
  folder: string;
  label: string;
  packagePrefix: string;
  classSuffix: string;
}

interface SelectOption {
  value: string;
  label: string;
}

const KINDS: Record<Kind, KindConfig> = {
  input: {
    folder: "input",
    label: "InputInterface",
    packagePrefix: "input",
    classSuffix: "Input",
  },
  output: {
    folder: "output",
    label: "OutputInterface",
    packagePrefix: "output",
    classSuffix: "Output",
  },
  action: {
    folder: "action",
    label: "Capability",
    packagePrefix: "action",
    classSuffix: "Capability",
  },
  ai: {
    folder: "ai",
    label: "AIProvider",
    packagePrefix: "ai",
    classSuffix: "Provider",
  },
  env: {
    folder: "env",
    label: "Environment",
    packagePrefix: "env",
    classSuffix: "Environment",
  },
  discovery: {
    folder: "discovery",
    label: "CapabilityDiscovery",
    packagePrefix: "discovery",
    classSuffix: "Discovery",
  },
  agent: {
    folder: "agent",
    label: "AgentLoop",
    packagePrefix: "agent",
    classSuffix: "Loop",
  },
};

const KIND_CHOICES = Object.keys(KINDS) as Kind[];

function parseArgs(argv: string[]) {
  const options: { kind?: Kind; name?: string; yes?: boolean } = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--kind" || arg === "-k") {
      options.kind = argv[++i] as Kind;
    } else if (arg === "--name" || arg === "-n") {
      options.name = argv[++i];
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Scaffold a new Agent OS adapter package.

Usage:
  pnpm addCapability
  pnpm addCapability --kind action --name web
  pnpm addCapability -k input -n slack -y

Kinds: ${KIND_CHOICES.join(", ")}

Templates live in scripts/mockups/:
  <kind>.mockup.ts
  package.json.mockup
  tsconfig.json.mockup

Creates:
  packages/<kind>/<name>/
    package.json
    tsconfig.json
    src/index.ts
`);
}

function toKebab(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toPascal(value: string): string {
  return toKebab(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toSnake(value: string): string {
  return toKebab(value).replace(/-/g, "_");
}

function isKind(value: string): value is Kind {
  return KIND_CHOICES.includes(value as Kind);
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
  fallback?: string,
): Promise<string> {
  const suffix = fallback ? ` (${fallback})` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback || "";
}

async function selectWithArrows(
  question: string,
  options: readonly SelectOption[],
  initialIndex = 0,
): Promise<string> {
  if (options.length === 0) {
    throw new Error("No options to select");
  }

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "Interactive selection needs a TTY. Pass --kind instead (e.g. --kind action).",
    );
  }

  let index = Math.min(Math.max(initialIndex, 0), options.length - 1);
  let firstDraw = true;
  const hint = "↑/↓ move · Enter select · Ctrl+C cancel";
  const lineCount = options.length + 2;

  const hideCursor = "\x1b[?25l";
  const showCursor = "\x1b[?25h";
  const clearLine = "\x1b[2K";

  function draw() {
    if (!firstDraw) {
      output.write(`\x1b[${lineCount}A`);
    }
    firstDraw = false;

    output.write(`${clearLine}${question}\n`);
    for (const [i, option] of options.entries()) {
      const pointer = i === index ? "❯" : " ";
      const label =
        i === index
          ? `\x1b[36m${pointer} ${option.value}\x1b[0m  →  ${option.label}`
          : `  ${option.value}  →  ${option.label}`;
      output.write(`${clearLine}${label}\n`);
    }
    output.write(`${clearLine}\x1b[2m${hint}\x1b[0m\n`);
  }

  return new Promise((resolve, reject) => {
    const previousRawMode = input.isRaw;

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write(showCursor);
    };

    const onData = (chunk: Buffer | string) => {
      const key = typeof chunk === "string" ? chunk : chunk.toString("utf8");

      if (key === "\u0003") {
        cleanup();
        output.write("\n");
        reject(new Error("Cancelled."));
        return;
      }

      if (key === "\r" || key === "\n") {
        const selected = options[index]!;
        cleanup();
        output.write(`\nSelected: ${selected.value}\n`);
        resolve(selected.value);
        return;
      }

      // Up arrow / k
      if (key === "\u001b[A" || key === "k") {
        index = (index - 1 + options.length) % options.length;
        draw();
        return;
      }

      // Down arrow / j
      if (key === "\u001b[B" || key === "j") {
        index = (index + 1) % options.length;
        draw();
      }
    };

    output.write(hideCursor);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    draw();
  });
}

function applyPlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (content, [key, value]) => content.replaceAll(key, value),
    template,
  );
}

async function renderMockup(
  mockupFileName: string,
  values: Record<string, string>,
): Promise<string> {
  const mockupPath = join(mockupsDir, mockupFileName);
  if (!existsSync(mockupPath)) {
    throw new Error(`Missing mockup template: ${relative(repoRoot, mockupPath)}`);
  }

  const template = await readFile(mockupPath, "utf8");
  return applyPlaceholders(template, values);
}

async function createPackage(kind: Kind, name: string) {
  const config = KINDS[kind];
  const kebabName = toKebab(name);

  if (!kebabName) {
    throw new Error("Name is required");
  }

  const pascal = toPascal(kebabName);
  const className = `${pascal}${config.classSuffix}`;
  const packageName = `@agent-os/${config.packagePrefix}-${kebabName}`;
  const packageDir = join(repoRoot, "packages", config.folder, kebabName);

  if (existsSync(packageDir)) {
    throw new Error(`Package already exists: ${relative(repoRoot, packageDir)}`);
  }

  const values = {
    __NAME__: kebabName,
    __PASCAL__: pascal,
    __CLASS_NAME__: className,
    __SNAKE_NAME__: toSnake(kebabName),
    __PACKAGE_NAME__: packageName,
  };

  const files: Record<string, string> = {
    "package.json": await renderMockup("package.json.mockup", values),
    "tsconfig.json": await renderMockup("tsconfig.json.mockup", values),
    "src/index.ts": await renderMockup(`${kind}.mockup.ts`, values),
  };

  await mkdir(join(packageDir, "src"), { recursive: true });

  for (const [relativePath, contents] of Object.entries(files)) {
    await writeFile(join(packageDir, relativePath), contents, "utf8");
  }

  return {
    packageName,
    packageDir: relative(repoRoot, packageDir),
    className,
  };
}

async function runPnpmInstall(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["install", "--no-frozen-lockfile", "--config.confirmModulesPurge=false"],
      {
        cwd: repoRoot,
        stdio: "inherit",
        shell: process.platform === "win32",
        env: {
          ...process.env,
          // pnpm may need to recreate node_modules when a workspace package is added;
          // without a TTY it refuses unless CI/confirmModulesPurge is set.
          CI: process.env.CI ?? "true",
        },
      },
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pnpm install failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("Create a new Agent OS adapter package\n");

  if (args.kind && !isKind(args.kind)) {
    throw new Error(
      `Unknown kind "${args.kind}". Expected: ${KIND_CHOICES.join(", ")}`,
    );
  }

  const kind = (
    args.kind ??
    (await selectWithArrows(
      "What interface does this implement?",
      KIND_CHOICES.map((choice) => ({
        value: choice,
        label: KINDS[choice].label,
      })),
      KIND_CHOICES.indexOf("action"),
    ))
  ) as Kind;

  const rl = createInterface({ input, output });

  try {
    const name =
      args.name?.trim() ||
      (await ask(
        rl,
        `Implementation name (folder under packages/${KINDS[kind].folder}/)`,
        "example",
      ));

    const kebabName = toKebab(name);
    const packageName = `@agent-os/${KINDS[kind].packagePrefix}-${kebabName}`;
    const packageDir = `packages/${KINDS[kind].folder}/${kebabName}`;

    console.log(`
About to create:
  kind:    ${kind} (${KINDS[kind].label})
  path:    ${packageDir}
  package: ${packageName}
`);

    if (!args.yes) {
      const confirm = (
        await ask(rl, "Create this package? [y/N]", "n")
      ).toLowerCase();
      if (confirm !== "y" && confirm !== "yes") {
        console.log("Cancelled.");
        return;
      }
    }

    const created = await createPackage(kind, kebabName);

    console.log("\nLinking workspace dependencies...\n");
    await runPnpmInstall();

    const coreLink = join(
      repoRoot,
      created.packageDir,
      "node_modules",
      "@agent-os",
      "core",
    );
    if (!existsSync(coreLink)) {
      throw new Error(
        `Workspace link missing after install: ${relative(repoRoot, coreLink)}. Run \`pnpm install\` manually.`,
      );
    }

    console.log(`
Created ${created.packageDir}
  package: ${created.packageName}
  export:  ${created.className}

Next:
  1. Implement TODO stubs in ${created.packageDir}/src/index.ts
  2. Wire it in packages/app (package.json dependency + main.ts)
`);
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
