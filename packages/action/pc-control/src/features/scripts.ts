import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../../scripts/", import.meta.url));

export const scripts = {
  accessibilityTree: resolve(directory, "accessibility-tree.js"),
  accessibilityAction: resolve(directory, "accessibility-action.js"),
  apps: resolve(directory, "apps.js"),
  automationPermission: resolve(directory, "automation-permission.applescript"),
  mouse: resolve(directory, "mouse.js"),
  permissions: resolve(directory, "permissions.js"),
  pressKey: resolve(directory, "press-key.applescript"),
  scroll: resolve(directory, "scroll.js"),
  typeText: resolve(directory, "type-text.applescript"),
} as const;
