import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { NativeCommandClient } from "./native-command.js";
import { scripts } from "./scripts.js";
import type { MacOSPermissionStatus } from "./types.js";

const GUIDANCE =
  "Enable your terminal (and osascript if listed) in System Settings → Privacy & Security → Accessibility, Automation, and Screen Recording, then restart Agent OS.";

export class PermissionControl {
  constructor(private readonly commands: NativeCommandClient) {}

  async request(signal?: AbortSignal): Promise<MacOSPermissionStatus> {
    const native = await this.commands.safeJson<{ accessibility?: boolean }>(
      "osascript",
      ["-l", "JavaScript", scripts.permissions],
      signal,
    );
    const automation = await this.commands.safe(
      "osascript",
      [scripts.automationPermission],
      signal,
    );
    const status: MacOSPermissionStatus = {
      accessibility: booleanOrNull(native?.accessibility),
      automation: automation !== null,
      screenRecording: await this.probeScreenRecording(signal),
      requested: true,
    };
    if (allGranted(status)) return status;
    return { ...status, guidance: GUIDANCE };
  }

  private async probeScreenRecording(
    signal?: AbortSignal,
  ): Promise<boolean | null> {
    let temporaryDirectory: string | undefined;
    try {
      temporaryDirectory = await mkdtemp(
        resolve(tmpdir(), "agent-os-screen-recording-"),
      );
      const result = await this.commands.safe(
        "screencapture",
        [
          "-x",
          "-R0,0,1,1",
          resolve(temporaryDirectory, "permission-check.png"),
        ],
        signal,
      );
      return result !== null;
    } catch {
      return null;
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  }
}

function allGranted(status: MacOSPermissionStatus): boolean {
  return (
    status.accessibility === true &&
    status.automation === true &&
    status.screenRecording === true
  );
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function removeTemporaryDirectory(path?: string): Promise<void> {
  if (!path) return;
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Permission probing should not fail because cleanup did.
  }
}
