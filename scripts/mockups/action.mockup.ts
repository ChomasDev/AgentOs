import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
} from "@agent-os/core/domain";

export interface __PASCAL__Input {
  // TODO: define capability input
}

export interface __PASCAL__Output {
  // TODO: define capability output
}

export interface __CLASS_NAME__Options {}

const manifest: CapabilityManifest = {
  id: "__NAME__.run",
  version: "1.0.0",
  name: "__SNAKE_NAME__",
  description: "TODO: describe what this capability does.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  tags: ["__NAME__"],
};

export class __CLASS_NAME__
  implements Capability<__PASCAL__Input, __PASCAL__Output>
{
  readonly manifest = manifest;

  constructor(private readonly options: __CLASS_NAME__Options = {}) {
    void this.options;
  }

  async execute(
    input: __PASCAL__Input,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<__PASCAL__Output>> {
    // TODO: implement capability
    void input;
    void context;

    return {
      success: true,
      data: {} as __PASCAL__Output,
    };
  }
}
