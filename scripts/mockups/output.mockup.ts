import type {
  OutputContent,
  OutputInterface,
} from "@agent-os/core/domain";

export interface __CLASS_NAME__Options {}

export class __CLASS_NAME__ implements OutputInterface {
  readonly channel = "__NAME__" as const;

  constructor(private readonly options: __CLASS_NAME__Options = {}) {
    void this.options;
  }

  async write(content: OutputContent): Promise<void> {
    // TODO: write content to your output destination
    void content;
  }
}
