/**
 * Provider-neutral access to configuration and secrets.
 *
 * Implementations can read from process.env, dotenv files, maps, vaults,
 * or a composition of multiple sources.
 */
export interface Environment {
  get(key: string): string | undefined;
  getRequired(key: string): string;
  getOrDefault(key: string, fallback: string): string;
  has(key: string): boolean;
  getAll(): Record<string, string>;
}

/** Compatibility name used by the original AgentHarness contracts. */
export type EnvPort = Environment;
