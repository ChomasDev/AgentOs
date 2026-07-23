export type OutputChannel = "cli" | (string & {});

export type OutputContent = string | AsyncIterable<string>;

/**
 * A transport-neutral output destination. Supporting both content shapes keeps
 * streaming a runtime choice rather than an adapter-specific behavior.
 */
export interface OutputInterface {
  readonly channel: OutputChannel;
  /** Human-readable routing guidance for an orchestrator. */
  readonly description?: string;
  write(content: OutputContent): Promise<void>;
}
