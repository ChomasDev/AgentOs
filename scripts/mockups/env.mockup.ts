import type { Environment } from "@agent-os/core/domain";

export interface __CLASS_NAME__Options {
  values?: Readonly<Record<string, string | undefined>>;
}

export class __CLASS_NAME__ implements Environment {
  constructor(private readonly options: __CLASS_NAME__Options = {}) {}

  get(key: string): string | undefined {
    // TODO: read the value from your environment provider
    return this.options.values?.[key] || undefined;
  }

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

  getAll(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.options.values ?? {}).filter(
        (entry): entry is [string, string] => Boolean(entry[1]),
      ),
    );
  }
}
