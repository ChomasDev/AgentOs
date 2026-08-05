import { execFile } from "node:child_process";
import type { ChromeCommandRunner } from "./types.js";

export const executeCommand: ChromeCommandRunner = (command, args, options) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        signal: options.signal,
        timeout: options.timeoutMs,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
          return;
        }
        reject(error);
      },
    );
  });
