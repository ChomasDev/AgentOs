import type { AIProvider } from "../ai/ai-provider.js";
import type { InputInterface } from "../input/input-interface.js";
import type { OutputInterface } from "../output/output-interface.js";

export interface OSBootOptions {
  model: AIProvider;
  input: InputInterface;
  output: OutputInterface;
  settings: {
    agentic: boolean;
    /** Applies to text responses. Function-call execution is configured separately. */
    stream: boolean;
  };
}
