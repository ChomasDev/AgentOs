import type {
  AgentLoop,
  AgentLoopOptions,
  AIProcessResult,
  InputMessage,
} from "@agent-os/core/domain";

export interface __CLASS_NAME__Options {}

export class __CLASS_NAME__ implements AgentLoop {
  constructor(private readonly options: __CLASS_NAME__Options = {}) {
    void this.options;
  }

  async run(
    message: InputMessage,
    options: AgentLoopOptions,
  ): Promise<AIProcessResult> {
    // TODO: implement agent loop
    void options;
    return { type: "text", text: message.text };
  }
}
