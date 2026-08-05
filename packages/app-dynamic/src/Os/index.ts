import type {
  AIProcessResult,
  InputMessage,
  OSBootOptions,
  OutputInterface,
} from "@agent-os/core/domain";
import { formatAgentLoopEvent } from "../utils/format-agent-loop-event.js";
import { ConversationHistory } from "./conversation-history.js";
import { persistMemoryProposals } from "./memory-proposals.js";

export default class OS {
  private bootOptions?: OSBootOptions;
  private listening = false;

  public boot(bootOption: OSBootOptions): void {
    if (this.bootOptions) {
      throw new Error("Agent OS is already booted");
    }

    if (bootOption.input.length === 0) {
      throw new Error("Agent OS requires at least one input");
    }

    if (bootOption.output.length === 0) {
      throw new Error("Agent OS requires at least one output");
    }

    this.bootOptions = bootOption;
  }

  public async startListener(): Promise<void> {
    const bootOptions = this.bootOptions;

    if (!bootOptions) {
      throw new Error("Agent OS must be booted before starting its listener");
    }

    if (this.listening) {
      throw new Error("Agent OS input listener is already running");
    }

    this.listening = true;
    const history = new ConversationHistory(bootOptions.memory);

    const listener = async (message: InputMessage) => {
      const contextualized = await history.contextualize(message);
      await history.rememberUser(message);
      const decision = await bootOptions.orchestrator.orchestrate(
        contextualized,
        bootOptions.output,
      );
      await persistMemoryProposals(
        bootOptions.memory,
        message,
        decision.memoryProposals,
      );
      const output = bootOptions.output.find(
        (candidate) => candidate.channel === decision.outputChannel,
      );

      if (!output) {
        throw new Error(
          `Orchestrator selected unavailable output "${decision.outputChannel}"`,
        );
      }

      const response = await bootOptions.agentLoop.run(contextualized, {
        capabilityIds: decision.capabilityIds,
        stream: bootOptions.settings.stream,
        onEvent: bootOptions.settings.showSteps
          ? (event) =>
              output.write(
                formatAgentLoopEvent(event, bootOptions.env),
              )
          : undefined,
      });

      const additionalOutputs = (decision.additionalOutputs ?? []).map(
        (route) => {
          const destination = bootOptions.output.find(
            (candidate) => candidate.channel === route.outputChannel,
          );

          if (!destination) {
            throw new Error(
              `Orchestrator selected unavailable additional output "${route.outputChannel}"`,
            );
          }

          return { route, destination };
        },
      );
      const responseOutputs = [
        output,
        ...additionalOutputs
          .filter(({ route }) => route.content === "response")
          .map(({ destination }) => destination),
      ];
      const generatedResponse = await deliverResponse(
        response,
        responseOutputs,
      );
      await history.rememberAssistant(message, generatedResponse);

      for (const { route, destination } of additionalOutputs) {
        if (route.content === "text" && route.text !== undefined) {
          await destination.write(route.text);
        }
      }
    };

    try {
      await Promise.all(
        bootOptions.input.map((input) => input.start(listener)),
      );
    } catch (error) {
      await Promise.allSettled(
        bootOptions.input.map((input) => input.stop()),
      );
      throw error;
    } finally {
      this.listening = false;
    }
  }

  public async stopListener(): Promise<void> {
    const inputs = this.bootOptions?.input ?? [];

    try {
      const results = await Promise.allSettled(
        inputs.map((input) => input.stop()),
      );
      const errors = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason);

      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to stop Agent OS inputs");
      }
    } finally {
      this.listening = false;
    }
  }
}

async function deliverResponse(
  response: AIProcessResult,
  outputs: readonly OutputInterface[],
): Promise<string> {
  if (response.type === "text") {
    await writeAll(outputs, response.text);
    return response.text;
  }
  if (outputs.length > 1) {
    const text = await collectStream(response.stream);
    await writeAll(outputs, text);
    return text;
  }

  const chunks: string[] = [];
  await outputs[0]!.write(captureStream(response.stream, chunks));
  return chunks.join("");
}

async function writeAll(
  outputs: readonly OutputInterface[],
  text: string,
): Promise<void> {
  for (const output of outputs) await output.write(text);
}

async function* captureStream(
  stream: AsyncIterable<string>,
  chunks: string[],
): AsyncGenerator<string> {
  for await (const chunk of stream) {
    chunks.push(chunk);
    yield chunk;
  }
}

async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks.join("");
}
