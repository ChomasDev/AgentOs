import type { CapabilityManifest } from "./capability-manifest.js";
import type { Capability } from "./capability.js";

export interface CapabilityDiscoveryQuery {
  text?: string;
  tags?: readonly string[];
  limit?: number;
}

/**
 * Registry and discovery boundary. Implementations may use memory, a database,
 * embeddings, or a remote catalogue without changing the OS.
 */
export interface CapabilityDiscovery {
  register(capability: Capability): Promise<void>;
  get(id: string, version?: string): Promise<Capability | undefined>;
  discover(
    query?: CapabilityDiscoveryQuery,
  ): Promise<readonly CapabilityManifest[]>;
}
