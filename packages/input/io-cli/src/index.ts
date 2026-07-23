import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline/promises";
import type {
  InputInterface,
  InputListener,
  InputMessage,
  OutputContent,
  OutputInterface,
} from "@agent-os/core/domain";

export interface CLIInputOptions {
  args?: readonly string[];
  input?: NodeJS.ReadableStream;
  onInterrupt?: () => void;
  output?: NodeJS.WritableStream;
  prompt?: string;
  sessionId?: string;
}

export class CLIInput implements InputInterface {
  readonly channel = "cli" as const;

  private listening = false;
  private readline?: ReadlineInterface;

  constructor(private readonly options: CLIInputOptions = {}) {}

  async read(): Promise<InputMessage> {
    const args = this.options.args ?? process.argv.slice(2);
    let text = args.filter((value) => value !== "--").join(" ").trim();

    if (!text) {
      const input = this.options.input ?? stdin;

      if (!(input as NodeJS.ReadStream).isTTY) {
        throw new Error("CLI input is required");
      }

      const output = this.options.output ?? stdout;
      const readline = createInterface({ input, output });

      try {
        text = (
          await readline.question(this.options.prompt ?? "What should the agent do? ")
        ).trim();
      } finally {
        readline.close();
      }
    }

    if (!text) {
      throw new Error("CLI input is required");
    }

    return this.createMessage(text);
  }

  async start(listener: InputListener): Promise<void> {
    if (this.listening) {
      throw new Error("CLI input listener is already running");
    }

    this.listening = true;
    const args = this.options.args ?? process.argv.slice(2);
    const initialText = args
      .filter((value) => value !== "--")
      .join(" ")
      .trim();

    if (initialText) {
      try {
        await listener(this.createMessage(initialText));
      } finally {
        this.listening = false;
      }
      return;
    }

    const input = this.options.input ?? stdin;

    if (!(input as NodeJS.ReadStream).isTTY) {
      this.listening = false;
      throw new Error("Interactive CLI input requires a TTY");
    }

    const output = this.options.output ?? stdout;
    this.readline = createInterface({ input, output });
    this.readline.on("SIGINT", () => {
      if (this.options.onInterrupt) {
        this.options.onInterrupt();
      } else {
        void this.stop();
      }
    });
    const prompt = this.options.prompt ?? "What should the agent do? ";

    try {
      output.write(prompt);

      for await (const line of this.readline) {
        const text = line.trim();

        if (text === "exit" || text === "quit") {
          break;
        }

        if (text) {
          await listener(this.createMessage(text));
        }

        if (this.listening) {
          output.write(prompt);
        }
      }
    } finally {
      this.listening = false;
      this.readline.close();
      this.readline = undefined;
    }
  }

  async stop(): Promise<void> {
    this.listening = false;
    this.readline?.close();
  }

  private createMessage(text: string): InputMessage {
    return {
      id: `input-${randomUUID()}`,
      channel: this.channel,
      sessionId: this.options.sessionId ?? `cli-${randomUUID()}`,
      text,
      createdAt: new Date(),
    };
  }
}

export interface CLIOutputOptions {
  output?: NodeJS.WritableStream;
}

export class CLIOutput implements OutputInterface {
  readonly channel = "cli" as const;

  private readonly output: NodeJS.WritableStream;

  constructor(options: CLIOutputOptions = {}) {
    this.output = options.output ?? stdout;
  }

  async write(content: OutputContent): Promise<void> {
    if (typeof content === "string") {
      this.writeChunk(content);
      return;
    }

    let lastChunk = "";

    for await (const chunk of content) {
      lastChunk = chunk;
      this.output.write(chunk);
    }

    if (lastChunk && !lastChunk.endsWith("\n")) {
      this.output.write("\n");
    }
  }

  private writeChunk(chunk: string): void {
    this.output.write(chunk);

    if (!chunk.endsWith("\n")) {
      this.output.write("\n");
    }
  }
}

export { CLIInput as CLIInputAdapter, CLIOutput as CLIOutputAdapter };
