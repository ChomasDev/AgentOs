import type { JsonSchema, MemoryProposal } from "@agent-os/core/domain";

const DURABLE_KINDS = ["semantic", "episodic", "procedural"] as const;

export interface ModelMemoryProposal {
  kind: string;
  content: string;
  reason: string;
  confidence: number;
}

export function createMemoryProposalSchema(): JsonSchema {
  return {
    type: "array",
    maxItems: 3,
    description:
      "Explicit durable user facts or preferences from the current request. Empty when nothing should be remembered.",
    items: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...DURABLE_KINDS] },
        content: { type: "string", description: "Concise standalone fact." },
        reason: { type: "string", description: "Why this is useful later." },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["kind", "content", "reason", "confidence"],
      additionalProperties: false,
    },
  };
}

export function sanitizeMemoryProposals(
  proposals: readonly ModelMemoryProposal[] | undefined,
): MemoryProposal[] {
  const memories: MemoryProposal[] = [];
  for (const proposal of proposals ?? []) {
    if (!isDurableKind(proposal.kind)) continue;
    const content = proposal.content?.trim();
    const reason = proposal.reason?.trim();
    if (!content || !reason) continue;
    memories.push({
      operation: "remember",
      kind: proposal.kind,
      content: content.slice(0, 1_000),
      reason: reason.slice(0, 500),
      confidence: clamp(proposal.confidence),
    });
    if (memories.length === 3) break;
  }
  return memories;
}

function isDurableKind(value: string): value is typeof DURABLE_KINDS[number] {
  return DURABLE_KINDS.some((kind) => kind === value);
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}
