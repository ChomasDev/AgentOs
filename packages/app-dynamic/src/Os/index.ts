import type {
  InputMessage,
  OSBootOptions,
} from "@agent-os/core/domain";
import { formatAgentLoopEvent } from "../utils/format-agent-loop-event.js";

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

    const listener = async (message: InputMessage) => {
      const decision = await bootOptions.orchestrator.orchestrate(
        message,
        bootOptions.output,
      );
      const output = bootOptions.output.find(
        (candidate) => candidate.channel === decision.outputChannel,
      );

      if (!output) {
        throw new Error(
          `Orchestrator selected unavailable output "${decision.outputChannel}"`,
        );
      }

      const response = await bootOptions.agentLoop.run(message, {
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
      const generatedResponse =
        response.type === "text"
          ? response.text
          : responseOutputs.length === 1
            ? response.stream
            : await collectStream(response.stream);

      if (typeof generatedResponse === "string") {
        for (const destination of responseOutputs) {
          await destination.write(generatedResponse);
        }
      } else {
        await output.write(generatedResponse);
      }

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

async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks.join("");
}
