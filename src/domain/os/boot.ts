import type { AgentLoop } from "../agent/agent-loop.js";
import type { InputInterface } from "../input/input-interface.js";
import type { OutputInterface } from "../output/output-interface.js";

export interface OSBootOptions {
  agentLoop: AgentLoop;
  input: InputInterface;
  output: OutputInterface;
  settings: {
    agentic: boolean;
    /** Applies to text responses. Function-call execution is configured separately. */
    stream: boolean;
    /** Shows operational decisions and capability activity, not private chain-of-thought. */
    showSteps: boolean;
  };
}
