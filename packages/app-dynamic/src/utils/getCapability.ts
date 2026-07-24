import type { CapabilityType } from "@agent-os/core/domain";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const appDynamicRoot = fileURLToPath(new URL("../..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const capabilityRoot = join(appDynamicRoot, "capability");

let installGate: Promise<void> = Promise.resolve();
let packagesBuilt = false;

export async function getOrDownloadCapability(
  capability: string,
  type: CapabilityType,
) {
  if (!(await isCapabilityInstalled(capability))) {
    await withInstallLock(async () => {
      if (await isCapabilityInstalled(capability)) {
        return;
      }

      const shouldInstall = await confirmInstall(capability);
      if (!shouldInstall) {
        throw new Error(
          `Capability "${capability}" is not installed and installation was declined`,
        );
      }

      await installCapability(capability);
    });
  }

  return getCapability(capability, type);
}

function withInstallLock<T>(task: () => Promise<T>): Promise<T> {
  const run = installGate.then(task, task);
  installGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function getCapability(
  capability: string,
  _type: CapabilityType,
): Promise<Record<string, unknown>> {
  const moduleUrl = resolveInstalledModuleUrl(capability);
  return import(moduleUrl) as Promise<Record<string, unknown>>;
}

function resolveInstalledModuleUrl(capability: string): string {
  return pathToFileURL(
    join(capabilityRoot, capability, "dist", "index.js"),
  ).href;
}

async function isCapabilityInstalled(capability: string): Promise<boolean> {
  try {
    await access(join(capabilityRoot, capability, "dist", "index.js"));
    return true;
  } catch {
    return false;
  }
}

async function confirmInstall(capability: string): Promise<boolean> {
  if (!stdin.isTTY) {
    if (process.env.AGENT_OS_AUTO_INSTALL === "1") {
      return true;
    }

    throw new Error(
      `Capability "${capability}" is not installed. Re-run in a TTY or set AGENT_OS_AUTO_INSTALL=1.`,
    );
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `The capability "${capability}" is not installed yet. Do you want to install it? (y/N) `,
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function installCapability(capability: string): Promise<void> {
  if (!packagesBuilt) {
    console.log(`[capability] Building core + packages to install "${capability}"…`);
    // Packages import `@agent-os/core/domain` from root `dist/`, so core must build first.
    await runCommand("pnpm", ["run", "build"], repositoryRoot);
    packagesBuilt = true;
  } else {
    console.log(`[capability] Reusing previous package build for "${capability}"…`);
  }

  const targetRoot = join(capabilityRoot, capability);

  await mkdir(capabilityRoot, { recursive: true });
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  const sourceRoot = await findBuiltPackageRoot(capability);
  if (sourceRoot) {
    await installFromPackageSource(sourceRoot, targetRoot);
  } else if (!(await installFromRegistryArtifact(capability, targetRoot))) {
    await rm(targetRoot, { recursive: true, force: true });
    throw new Error(
      `Could not find a built package or registry artifact for capability "${capability}"`,
    );
  }

  console.log(`[capability] Installed "${capability}" → ${targetRoot}`);
}

async function installFromPackageSource(
  sourceRoot: string,
  targetRoot: string,
): Promise<void> {
  const packageJsonSource = join(sourceRoot, "package.json");
  if (await exists(packageJsonSource)) {
    await cp(packageJsonSource, join(targetRoot, "package.json"));
  }

  await cp(join(sourceRoot, "dist"), join(targetRoot, "dist"), {
    recursive: true,
  });

  const manifestSource = join(sourceRoot, "agent-os.package.json");
  if (await exists(manifestSource)) {
    await cp(manifestSource, join(targetRoot, "agent-os.package.json"));
  }

  const sourceNodeModules = join(sourceRoot, "node_modules");
  if (await exists(sourceNodeModules)) {
    await symlink(sourceNodeModules, join(targetRoot, "node_modules"), "dir");
  }
}

async function installFromRegistryArtifact(
  capability: string,
  targetRoot: string,
): Promise<boolean> {
  const artifactsDir = join(
    repositoryRoot,
    ".agent-os/registry/artifacts",
    capability,
  );
  if (!(await exists(artifactsDir))) {
    return false;
  }

  const zips = (await readdir(artifactsDir))
    .filter((name) => name.endsWith(".zip"))
    .sort();
  const zipName = zips.at(-1);
  if (!zipName) {
    return false;
  }

  console.log(
    `[capability] Installing "${capability}" from registry artifact ${zipName}…`,
  );
  await runCommand(
    "unzip",
    ["-o", join(artifactsDir, zipName), "-d", targetRoot],
    repositoryRoot,
  );
  return exists(join(targetRoot, "dist", "index.js"));
}

async function findBuiltPackageRoot(
  capability: string,
): Promise<string | undefined> {
  const npmName = await resolveNpmName(capability);
  const packageRoots = await listPackageRoots(join(repositoryRoot, "packages"));

  if (npmName) {
    for (const root of packageRoots) {
      const name = await readPackageName(root);
      if (name === npmName && (await isBuilt(root))) {
        return root;
      }
    }
  }

  for (const root of packageRoots) {
    const name = await readPackageName(root);
    if (name) {
      const bare = name.replace(/^@[^/]+\//, "");
      if (
        (bare === capability ||
          bare.endsWith(`-${capability}`) ||
          capability.endsWith(bare)) &&
        (await isBuilt(root))
      ) {
        return root;
      }
    }

    if (basename(root) === capability && (await isBuilt(root))) {
      return root;
    }
  }

  return undefined;
}

async function resolveNpmName(capability: string): Promise<string | undefined> {
  const indexPath = join(repositoryRoot, ".agent-os/registry/index.json");
  if (!(await exists(indexPath))) {
    return undefined;
  }

  const index = JSON.parse(await readFile(indexPath, "utf8")) as {
    packages?: Array<{ id?: string; npmName?: string }>;
  };

  return index.packages?.find((entry) => entry.id === capability)?.npmName;
}

async function listPackageRoots(packagesRoot: string): Promise<string[]> {
  const roots: string[] = [];
  const kindEntries = await readdir(packagesRoot, { withFileTypes: true });

  for (const kindEntry of kindEntries) {
    if (!kindEntry.isDirectory()) {
      continue;
    }

    const kindRoot = join(packagesRoot, kindEntry.name);
    if (await isPackageCandidate(kindRoot)) {
      roots.push(kindRoot);
      continue;
    }

    const implEntries = await readdir(kindRoot, { withFileTypes: true });
    for (const implEntry of implEntries) {
      if (!implEntry.isDirectory()) {
        continue;
      }

      const implRoot = join(kindRoot, implEntry.name);
      if (await isPackageCandidate(implRoot)) {
        roots.push(implRoot);
      }
    }
  }

  return roots;
}

async function isPackageCandidate(packageRoot: string): Promise<boolean> {
  return (
    (await exists(join(packageRoot, "package.json"))) ||
    (await exists(join(packageRoot, "dist", "index.js")))
  );
}

async function readPackageName(packageRoot: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as { name?: string };
    return pkg.name;
  } catch {
    return undefined;
  }
}

async function isBuilt(packageRoot: string): Promise<boolean> {
  return exists(join(packageRoot, "dist", "index.js"));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Command failed (${code ?? "unknown"}): ${command} ${args.join(" ")}`,
        ),
      );
    });
  });
}
