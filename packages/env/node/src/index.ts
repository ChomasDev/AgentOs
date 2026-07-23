import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Environment } from "@agent-os/core/domain";

abstract class BaseEnvironment implements Environment {
  abstract get(key: string): string | undefined;
  abstract getAll(): Record<string, string>;

  getRequired(key: string): string {
    const value = this.get(key);

    if (value === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }

    return value;
  }

  getOrDefault(key: string, fallback: string): string {
    return this.get(key) ?? fallback;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

export interface ProcessEnvironmentOptions {
  values?: NodeJS.ProcessEnv;
}

export class ProcessEnvironment extends BaseEnvironment {
  private readonly values: NodeJS.ProcessEnv;

  constructor(options: ProcessEnvironmentOptions = {}) {
    super();
    this.values = options.values ?? process.env;
  }

  get(key: string): string | undefined {
    return normalizeValue(this.values[key]);
  }

  getAll(): Record<string, string> {
    return toEnvironmentRecord(Object.entries(this.values));
  }
}

export interface DotenvEnvironmentOptions {
  filePath?: string;
  required?: boolean;
}

export class DotenvEnvironment extends BaseEnvironment {
  private readonly values: ReadonlyMap<string, string>;

  constructor(options: DotenvEnvironmentOptions = {}) {
    super();

    const filePath = resolve(options.filePath ?? ".env");

    if (!existsSync(filePath)) {
      if (options.required) {
        throw new Error(`Environment file not found: ${filePath}`);
      }

      this.values = new Map();
      return;
    }

    this.values = parseDotenv(readFileSync(filePath, "utf8"));
  }

  get(key: string): string | undefined {
    return normalizeValue(this.values.get(key));
  }

  getAll(): Record<string, string> {
    return toEnvironmentRecord(this.values);
  }
}

export class MapEnvironment extends BaseEnvironment {
  private readonly values: Map<string, string>;

  constructor(values: Readonly<Record<string, string>> = {}) {
    super();
    this.values = new Map(Object.entries(values));
  }

  get(key: string): string | undefined {
    return normalizeValue(this.values.get(key));
  }

  getAll(): Record<string, string> {
    return toEnvironmentRecord(this.values);
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}

export class CompositeEnvironment extends BaseEnvironment {
  constructor(private readonly providers: readonly Environment[]) {
    super();

    if (providers.length === 0) {
      throw new Error("CompositeEnvironment requires at least one provider");
    }
  }

  get(key: string): string | undefined {
    for (const provider of this.providers) {
      const value = provider.get(key);

      if (value !== undefined) {
        return value;
      }
    }

    return undefined;
  }

  getAll(): Record<string, string> {
    const values: Record<string, string> = {};

    for (let index = this.providers.length - 1; index >= 0; index -= 1) {
      Object.assign(values, this.providers[index]?.getAll());
    }

    return values;
  }
}

export {
  CompositeEnvironment as CompositeEnvAdapter,
  DotenvEnvironment as DotenvFileAdapter,
  MapEnvironment as MapEnvAdapter,
  ProcessEnvironment as NodeEnvironment,
  ProcessEnvironment as ProcessEnvAdapter,
};

function normalizeValue(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function toEnvironmentRecord(
  entries: Iterable<readonly [string, string | undefined]>,
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, rawValue] of entries) {
    const value = normalizeValue(rawValue);

    if (value !== undefined) {
      values[key] = value;
    }
  }

  return values;
}

function parseDotenv(contents: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values.set(key, value);
  }

  return values;
}
