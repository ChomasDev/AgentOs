import type {
  Capability,
  CapabilityDiscovery,
  CapabilityDiscoveryQuery,
  CapabilityManifest,
} from "@agent-os/core/domain";

export class __CLASS_NAME__ implements CapabilityDiscovery {
  private readonly capabilities = new Map<string, Capability[]>();

  async register(capability: Capability): Promise<void> {
    const registered = this.capabilities.get(capability.manifest.id) ?? [];
    registered.push(capability);
    this.capabilities.set(capability.manifest.id, registered);
  }

  async get(id: string, version?: string): Promise<Capability | undefined> {
    const registered = this.capabilities.get(id);
    if (version) {
      return registered?.find((item) => item.manifest.version === version);
    }
    return registered?.at(-1);
  }

  async discover(
    query: CapabilityDiscoveryQuery = {},
  ): Promise<readonly CapabilityManifest[]> {
    // TODO: filter by query.text / query.tags / query.limit
    void query;
    return [...this.capabilities.values()]
      .flat()
      .map((capability) => capability.manifest);
  }
}
