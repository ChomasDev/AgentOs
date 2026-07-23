import type { OSBootOptions } from "@agent-os/core/domain";
import { formatAgentLoopEvent } from "../utils/format-agent-loop-event.js";

export default class OS {
  private bootOptions?: OSBootOptions;
  private listening = false;

  // given the Ai, memroy, actionDiscovery,agent loop, Input and output make the Os boot with that
  public boot(bootOption: OSBootOptions): void {
    if (this.bootOptions) {
      throw new Error("Agent OS is already booted");
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

    try {
      await bootOptions.input.start(async (message) => {
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
      });
    } finally {
      this.listening = false;
    }
  }

  public async stopListener(): Promise<void> {
    await this.bootOptions?.input.stop();
    this.listening = false;
  }
}
