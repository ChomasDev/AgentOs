import type { AIProvider } from "../ai/ai-provider.js";

export interface OSBootOptions {
  model: AIProvider;
  settings: {
    agentic: boolean;
  };
}
