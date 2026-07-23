import { OpenAIProvider } from "@agent-os/openai";
import OS from "./Os/index.js";

const model = new OpenAIProvider({
  model: process.env.OPENAI_MODEL ?? "gpt-5.6",
});

const os = new OS();

os.boot({
  model,
  settings: {
    agentic: true,
  },
});
