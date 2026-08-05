import { NativeCommandClient } from "./native-command.js";
import { scripts } from "./scripts.js";
import type { MacOSControlInput } from "./types.js";
import {
  clampInteger,
  coordinates,
  finiteNumber,
  requiredString,
  requiredText,
} from "./validation.js";

export class NativeInput {
  constructor(private readonly commands: NativeCommandClient) {}

  move(input: MacOSControlInput, signal?: AbortSignal) {
    const { x, y } = coordinates(input);
    return this.mouse(["move", String(x), String(y), "left", "1"], signal);
  }

  click(input: MacOSControlInput, signal?: AbortSignal) {
    const { x, y } = coordinates(input);
    const button = input.button ?? "left";
    const clicks = clampInteger(input.clicks ?? 1, 1, 3);
    return this.mouse(
      ["click", String(x), String(y), button, String(clicks)],
      signal,
    );
  }

  drag(input: MacOSControlInput, signal?: AbortSignal) {
    const values = [
      finiteNumber(input.fromX, "fromX"),
      finiteNumber(input.fromY, "fromY"),
      finiteNumber(input.toX, "toX"),
      finiteNumber(input.toY, "toY"),
    ].map(String);
    const duration = String(clampInteger(input.durationMs ?? 500, 0, 10_000));
    const steps = String(clampInteger(input.steps ?? 30, 1, 240));
    return this.mouse(
      ["drag", ...values, duration, steps, input.button ?? "left"],
      signal,
    );
  }

  scroll(input: MacOSControlInput, signal?: AbortSignal) {
    const deltaX = finiteNumber(input.deltaX ?? 0, "deltaX");
    const deltaY = finiteNumber(input.deltaY ?? 0, "deltaY");
    return this.commands.json(
      "osascript",
      ["-l", "JavaScript", scripts.scroll, String(deltaX), String(deltaY)],
      signal,
    );
  }

  async typeText(input: MacOSControlInput, signal?: AbortSignal) {
    const text = requiredString(input.text, "text");
    await this.commands.run("osascript", [scripts.typeText, text], signal);
    return { typed: true, characterCount: text.length };
  }

  async pressKey(input: MacOSControlInput, signal?: AbortSignal) {
    const key = requiredText(input.key, "key").toLowerCase();
    const modifiers = input.modifiers ?? [];
    await this.commands.run(
      "osascript",
      [scripts.pressKey, key, ...modifiers],
      signal,
    );
    return { key, modifiers: [...modifiers], pressed: true };
  }

  private mouse(args: string[], signal?: AbortSignal) {
    return this.commands.json(
      "osascript",
      ["-l", "JavaScript", scripts.mouse, ...args],
      signal,
    );
  }
}
