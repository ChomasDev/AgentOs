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
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { stdin, stdout } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertPackageManifest,
  INSTALL_SELECTION_FILE,
  loadPackageManifest,
  PACKAGE_MANIFEST_FILE,
  parseInstallSelection,
  resolveRequiredInterfaces,
  stringifyInstallSelection,
  type PackageManifest,
} from "./package-manifest.js";

const appDynamicRoot = fileURLToPath(new URL("../..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const capabilityRoot = join(appDynamicRoot, "capability");

let installGate: Promise<void> = Promise.resolve();
let packagesBuilt = false;

export async function getOrDownloadCapability(
  capability: string,
  requestedKinds: readonly CapabilityType[],
) {
  return withInstallLock(async () => {
    const manifest = await resolvePackageManifest(capability);
    let installedInterfaces = await readInstalledInterfaces(capability);

    if (!(await isCapabilityInstalled(capability))) {
      installedInterfaces = await selectInterfaces(
        manifest,
        requestedKinds,
        [],
      );
      if (installedInterfaces.length === 0) {
        throw new Error(
          `Package "${capability}" is not installed because no components were selected`,
        );
      }
      await installCapability(capability);
      await writeInstallSelection(capability, manifest, installedInterfaces);
    } else if (!installedInterfaces) {
      // Packages installed before selective manifests existed keep their old behavior.
      installedInterfaces = manifest.interfaces.map((iface) => iface.id);
      await writeInstallSelection(capability, manifest, installedInterfaces);
    } else {
      const missingRequestedKinds = requestedKinds.filter(
        (kind) =>
          !manifest.interfaces.some(
            (iface) =>
              iface.kind === kind && installedInterfaces?.includes(iface.id),
          ),
      );
      if (missingRequestedKinds.length > 0) {
        installedInterfaces = await selectInterfaces(
          manifest,
          missingRequestedKinds,
          installedInterfaces,
        );
        await writeInstallSelection(capability, manifest, installedInterfaces);
      }
    }

    return {
      manifest,
      installedInterfaces,
      module: await getCapability(capability),
    };
  });
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
): Promise<Record<string, unknown>> {
  const moduleUrl = resolveInstalledModuleUrl(capability);
  return import(moduleUrl) as Promise<Record<string, unknown>>;
}

function resolveInstalledModuleUrl(capability: string): string {
  return pathToFileURL(
    join(capabilityRoot, capability, "dist", "index.js"),
  ).href;
}

async function resolvePackageManifest(
  capability: string,
): Promise<PackageManifest> {
  const installedPath = join(
    capabilityRoot,
    capability,
    PACKAGE_MANIFEST_FILE,
  );
  if (await exists(installedPath)) {
    return loadPackageManifest(installedPath);
  }

  const sourceRoot = await findPackageRoot(capability, false);
  if (sourceRoot) {
    const sourcePath = join(sourceRoot, PACKAGE_MANIFEST_FILE);
    if (await exists(sourcePath)) {
      return loadPackageManifest(sourcePath);
    }
  }

  const registryPackage = await readRegistryPackage(capability);
  if (registryPackage?.manifest) {
    return assertPackageManifest(registryPackage.manifest);
  }
  throw new Error(
    `Package "${capability}" has no ${PACKAGE_MANIFEST_FILE} and no registry manifest`,
  );
}

async function readInstalledInterfaces(
  capability: string,
): Promise<string[] | undefined> {
  const path = join(capabilityRoot, capability, INSTALL_SELECTION_FILE);
  if (!(await exists(path))) {
    return undefined;
  }
  return parseInstallSelection(await readFile(path, "utf8")).interfaces;
}

async function writeInstallSelection(
  capability: string,
  manifest: PackageManifest,
  interfaces: readonly string[],
): Promise<void> {
  await writeFile(
    join(capabilityRoot, capability, INSTALL_SELECTION_FILE),
    stringifyInstallSelection({
      schemaVersion: 1,
      package: manifest.id,
      interfaces: [...interfaces],
    }),
    "utf8",
  );
}

async function isCapabilityInstalled(capability: string): Promise<boolean> {
  try {
    await access(join(capabilityRoot, capability, "dist", "index.js"));
    return true;
  } catch {
    return false;
  }
}

async function selectInterfaces(
  manifest: PackageManifest,
  requestedKinds: readonly CapabilityType[],
  alreadyInstalled: readonly string[],
): Promise<string[]> {
  const requested = manifest.interfaces
    .filter((iface) => requestedKinds.includes(iface.kind))
    .map((iface) => iface.id);
  const defaults = resolveRequiredInterfaces(manifest, [
    ...alreadyInstalled,
    ...requested,
  ]);

  if (!stdin.isTTY) {
    if (process.env.AGENT_OS_AUTO_INSTALL === "1") {
      return [...defaults];
    }

    throw new Error(
      `Package "${manifest.id}" needs component approval. Re-run in a TTY or set AGENT_OS_AUTO_INSTALL=1.`,
    );
  }

  stdout.write(`\nPackage: ${manifest.name} (${manifest.id}@${manifest.version})\n`);
  if (manifest.description) {
    stdout.write(`${manifest.description}\n`);
  }
  return selectInterfacesWithKeyboard(
    manifest,
    requested,
    alreadyInstalled,
  );
}

function selectInterfacesWithKeyboard(
  manifest: PackageManifest,
  initiallySelected: readonly string[],
  alreadyInstalled: readonly string[],
): Promise<string[]> {
  let index = 0;
  let firstDraw = true;
  const chosen = new Set([...alreadyInstalled, ...initiallySelected]);
  const locked = new Set(alreadyInstalled);
  const lineCount = manifest.interfaces.length * 2 + 2;
  const clearLine = "\x1b[2K";
  const hideCursor = "\x1b[?25l";
  const showCursor = "\x1b[?25h";

  const effectiveSelection = () =>
    resolveRequiredInterfaces(manifest, chosen);

  const draw = () => {
    if (!firstDraw) {
      stdout.write(`\x1b[${lineCount}A`);
    }
    firstDraw = false;
    const selected = effectiveSelection();

    stdout.write(`${clearLine}Select components:\n`);
    manifest.interfaces.forEach((iface, candidateIndex) => {
      const focused = candidateIndex === index;
      const checked = selected.has(iface.id) ? "●" : "○";
      const pointer = focused ? "❯" : " ";
      const permissions =
        iface.permissions.length > 0 ? iface.permissions.join(", ") : "none";
      const state = locked.has(iface.id)
        ? " · installed"
        : selected.has(iface.id) && !chosen.has(iface.id)
          ? " · required"
          : "";
      const requirement =
        iface.required.length > 0
          ? ` · requires ${iface.required.join(", ")}`
          : "";
      const line =
        `${pointer} ${checked} ${iface.name ?? iface.id} (${iface.id}) ` +
        `[${iface.kind}] — permissions: ${permissions}${requirement}${state}`;
      const fittedLine = fitTerminalLine(line);
      const description = fitTerminalLine(
        `      ${iface.description ?? ""}`,
      );

      stdout.write(
        `${clearLine}${focused ? `\x1b[36m${fittedLine}\x1b[0m` : fittedLine}\n`,
      );
      stdout.write(`${clearLine}${description}\n`);
    });
    stdout.write(
      `${clearLine}\x1b[2m↑/↓ move · Space select · Enter confirm · Ctrl+C cancel\x1b[0m\n`,
    );
  };

  return new Promise((resolve, reject) => {
    const previousRawMode = stdin.isRaw;

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(previousRawMode);
      stdin.pause();
      stdout.write(showCursor);
    };

    const onData = (chunk: Buffer | string) => {
      const key = typeof chunk === "string" ? chunk : chunk.toString("utf8");

      if (key === "\u0003") {
        cleanup();
        stdout.write("\n");
        reject(new Error("Component selection cancelled"));
        return;
      }
      if (key === "\r" || key === "\n") {
        const selected = [...effectiveSelection()];
        cleanup();
        stdout.write("\n");
        resolve(selected);
        return;
      }
      if (key === "\u001b[A" || key === "k") {
        index = (index - 1 + manifest.interfaces.length) %
          manifest.interfaces.length;
        draw();
        return;
      }
      if (key === "\u001b[B" || key === "j") {
        index = (index + 1) % manifest.interfaces.length;
        draw();
        return;
      }
      if (key === " ") {
        const iface = manifest.interfaces[index]!;
        const selected = effectiveSelection();
        if (locked.has(iface.id)) {
          return;
        }
        if (chosen.has(iface.id)) {
          chosen.delete(iface.id);
        } else if (!selected.has(iface.id)) {
          chosen.add(iface.id);
        }
        draw();
      }
    };

    stdout.write(hideCursor);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    draw();
  });
}

function fitTerminalLine(value: string): string {
  const width = Math.max(stdout.columns || 120, 20);
  const singleLine = value.replaceAll(/\r?\n/g, " ");
  return singleLine.length <= width
    ? singleLine
    : `${singleLine.slice(0, width - 1)}…`;
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

  const manifestSource = join(sourceRoot, PACKAGE_MANIFEST_FILE);
  if (await exists(manifestSource)) {
    await cp(manifestSource, join(targetRoot, PACKAGE_MANIFEST_FILE));
  }

  const scriptsSource = join(sourceRoot, "scripts");
  if (await exists(scriptsSource)) {
    await cp(scriptsSource, join(targetRoot, "scripts"), {
      recursive: true,
    });
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
  return findPackageRoot(capability, true);
}

async function findPackageRoot(
  capability: string,
  requireBuild: boolean,
): Promise<string | undefined> {
  const npmName = await resolveNpmName(capability);
  const packageRoots = await listPackageRoots(join(repositoryRoot, "packages"));

  if (npmName) {
    for (const root of packageRoots) {
      const name = await readPackageName(root);
      if (name === npmName && (!requireBuild || (await isBuilt(root)))) {
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
        (!requireBuild || (await isBuilt(root)))
      ) {
        return root;
      }
    }

    if (
      basename(root) === capability &&
      (!requireBuild || (await isBuilt(root)))
    ) {
      return root;
    }
  }

  return undefined;
}

async function resolveNpmName(capability: string): Promise<string | undefined> {
  return (await readRegistryPackage(capability))?.npmName;
}

async function readRegistryPackage(
  capability: string,
): Promise<
  | { id?: string; npmName?: string; manifest?: unknown }
  | undefined
> {
  const indexPath = join(repositoryRoot, ".agent-os/registry/index.json");
  if (!(await exists(indexPath))) {
    return undefined;
  }

  const index = JSON.parse(await readFile(indexPath, "utf8")) as {
    packages?: Array<{ id?: string; npmName?: string; manifest?: unknown }>;
  };

  return index.packages?.find((entry) => entry.id === capability);
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
