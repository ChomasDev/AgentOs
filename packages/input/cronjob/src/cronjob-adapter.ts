import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  InputInterface,
  InputListener,
} from "@agent-os/core/domain";
import {
  CronjobInput,
  ManageCronjobsCapability,
  type CronjobInputOptions,
  type ManageCronjobsInput,
  type ManageCronjobsOutput,
} from "./index.js";

/** One instance shared by the cron input and management action interfaces. */
export class CronjobAdapter
  implements InputInterface, Capability<ManageCronjobsInput, ManageCronjobsOutput>
{
  readonly channel = "cronjob" as const;
  readonly manifest: CapabilityManifest;

  private readonly input: CronjobInput;
  private readonly capability: ManageCronjobsCapability;

  constructor(options: CronjobInputOptions) {
    this.input = new CronjobInput(options);
    this.capability = new ManageCronjobsCapability(this.input);
    this.manifest = this.capability.manifest;
  }

  start(listener: InputListener): Promise<void> {
    return this.input.start(listener);
  }

  stop(): Promise<void> {
    return this.input.stop();
  }

  close(): Promise<void> {
    return this.input.close();
  }

  execute(
    input: ManageCronjobsInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<ManageCronjobsOutput>> {
    return this.capability.execute(input, context);
  }
}
