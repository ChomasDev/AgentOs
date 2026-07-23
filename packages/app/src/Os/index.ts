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
      const response = await bootOptions.agentLoop.run(message, {
        stream: bootOptions.settings.stream,
        onEvent: bootOptions.settings.showSteps
          ? (event) =>
              bootOptions.output.write(
                formatAgentLoopEvent(event, bootOptions.env),
              )
          : undefined,
      });

      await bootOptions.output.write(
        response.type === "text" ? response.text : response.stream,
      );
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
