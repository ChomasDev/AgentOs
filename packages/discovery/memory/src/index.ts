import type {
  Capability,
  CapabilityDiscovery,
  CapabilityDiscoveryQuery,
  CapabilityManifest,
} from "@agent-os/core/domain";

export class InMemoryCapabilityDiscovery implements CapabilityDiscovery {
  private readonly capabilities = new Map<string, Capability[]>();

  async register(capability: Capability): Promise<void> {
    const registered = this.capabilities.get(capability.manifest.id) ?? [];
    const version = capability.manifest.version;
    const existingIndex = registered.findIndex(
      (candidate) => candidate.manifest.version === version,
    );

    if (existingIndex >= 0) {
      registered[existingIndex] = capability;
    } else {
      registered.push(capability);
    }

    this.capabilities.set(capability.manifest.id, registered);
  }

  async get(
    id: string,
    version?: string,
  ): Promise<Capability | undefined> {
    const registered = this.capabilities.get(id);

    if (version) {
      return registered?.find(
        (candidate) => candidate.manifest.version === version,
      );
    }

    return registered?.at(-1);
  }

  async discover(
    query: CapabilityDiscoveryQuery = {},
  ): Promise<readonly CapabilityManifest[]> {
    const tags = new Set(query.tags?.map(normalize).filter(Boolean));
    const terms = normalize(query.text)
      .split(/\s+/)
      .filter(Boolean);
    const limit = Math.max(0, query.limit ?? Number.POSITIVE_INFINITY);

    return [...this.capabilities.values()]
      .flatMap((versions) => versions.at(-1) ?? [])
      .map((capability) => ({
        manifest: capability.manifest,
        score: scoreManifest(capability.manifest, terms, tags),
      }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((candidate) => candidate.manifest);
  }
}

function scoreManifest(
  manifest: CapabilityManifest,
  terms: readonly string[],
  requestedTags: ReadonlySet<string>,
): number {
  const manifestTags = new Set(manifest.tags?.map(normalize).filter(Boolean));

  if (
    requestedTags.size > 0 &&
    [...requestedTags].some((tag) => !manifestTags.has(tag))
  ) {
    return -1;
  }

  if (terms.length === 0) {
    return requestedTags.size;
  }

  const searchable = normalize(
    [
      manifest.id,
      manifest.name,
      manifest.description,
      ...(manifest.tags ?? []),
      ...(manifest.examples?.map((example) => example.request) ?? []),
    ].join(" "),
  );
  const matches = terms.filter((term) => searchable.includes(term)).length;

  return matches > 0 ? matches : -1;
}

function normalize(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

export { InMemoryCapabilityDiscovery as CapabilityDiscoveryMemoryAdapter };
