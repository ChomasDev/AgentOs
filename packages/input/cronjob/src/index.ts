import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import cron, { type ScheduledTask } from "node-cron";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  InputInterface,
  InputListener,
  InputMessage,
} from "@agent-os/core/domain";

export type CronjobStatus = "active" | "suspended";

export interface Cronjob {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  timezone?: string;
  status: CronjobStatus;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
}

export interface AddCronjobOptions {
  name: string;
  cronExpression: string;
  prompt: string;
  timezone?: string;
}

export interface CronScheduler {
  validate(expression: string): boolean;
  schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options?: {
      name?: string;
      timezone?: string;
      noOverlap?: boolean;
    },
  ): ScheduledTask;
}

export interface CronjobInputOptions {
  databasePath?: string;
  scheduler?: CronScheduler;
  sessionId?: string;
  onError?: (error: unknown, job: Cronjob) => void | Promise<void>;
}

export class CronjobInput implements InputInterface {
  readonly channel = "cronjob" as const;

  private readonly database: DatabaseSync;
  private readonly scheduler: CronScheduler;
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly options: CronjobInputOptions;

  private listening = false;
  private listener?: InputListener;
  private resolveStopped?: () => void;
  private stopped?: Promise<void>;

  constructor(options: CronjobInputOptions = {}) {
    this.options = options;
    this.scheduler = options.scheduler ?? cron;

    const databasePath =
      options.databasePath === ":memory:"
        ? ":memory:"
        : resolve(
            options.databasePath ?? ".agent-os/cronjobs.sqlite",
          );

    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.initializeDatabase();
  }

  async start(listener: InputListener): Promise<void> {
    if (this.listening) {
      throw new Error("CronjobInput listener is already running");
    }

    this.listening = true;
    this.listener = listener;
    this.stopped = new Promise<void>((resolveStopped) => {
      this.resolveStopped = resolveStopped;
    });

    try {
      for (const job of this.listCronjobs()) {
        if (job.status === "active") {
          this.scheduleJob(job);
        }
      }

      await this.stopped;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.listening = false;

    for (const task of this.tasks.values()) {
      task.destroy();
    }

    this.tasks.clear();
    this.listener = undefined;
    this.resolveStopped?.();
    this.resolveStopped = undefined;
    this.stopped = undefined;
  }

  async close(): Promise<void> {
    await this.stop();
    this.database.close();
  }

  addCronjob(options: AddCronjobOptions): Cronjob {
    const name = requiredText(options.name, "name");
    const cronExpression = requiredText(
      options.cronExpression,
      "cronExpression",
    );
    const prompt = requiredText(options.prompt, "prompt");
    const timezone = optionalText(options.timezone);

    this.validateSchedule(cronExpression, timezone);

    const now = new Date().toISOString();
    const job: Cronjob = {
      id: `cronjob-${randomUUID()}`,
      name,
      cronExpression,
      prompt,
      timezone,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    this.database
      .prepare(`
        INSERT INTO cronjobs (
          id,
          name,
          cron_expression,
          prompt,
          timezone,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        job.id,
        job.name,
        job.cronExpression,
        job.prompt,
        job.timezone ?? null,
        job.status,
        job.createdAt,
        job.updatedAt,
      );

    if (this.listening) {
      this.scheduleJob(job);
    }

    return job;
  }

  removeCronjob(idOrName: string): Cronjob | undefined {
    const job = this.getCronjob(idOrName);

    if (!job) {
      return undefined;
    }

    this.destroyTask(job.id);
    this.database.prepare("DELETE FROM cronjobs WHERE id = ?").run(job.id);
    return job;
  }

  suspendCronjob(idOrName: string): Cronjob | undefined {
    const job = this.getCronjob(idOrName);

    if (!job) {
      return undefined;
    }

    this.destroyTask(job.id);
    this.updateStatus(job.id, "suspended");
    return this.getCronjob(job.id);
  }

  resumeCronjob(idOrName: string): Cronjob | undefined {
    const job = this.getCronjob(idOrName);

    if (!job) {
      return undefined;
    }

    this.validateSchedule(job.cronExpression, job.timezone);
    this.updateStatus(job.id, "active");

    const resumed = this.getCronjob(job.id);

    if (resumed && this.listening) {
      this.scheduleJob(resumed);
    }

    return resumed;
  }

  getCronjob(idOrName: string): Cronjob | undefined {
    const target = requiredText(idOrName, "idOrName");
    const row = this.database
      .prepare(`
        SELECT *
        FROM cronjobs
        WHERE id = ? OR name = ? COLLATE NOCASE
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `)
      .get(target, target, target) as CronjobRow | undefined;

    return row ? mapRow(row) : undefined;
  }

  listCronjobs(): Cronjob[] {
    const rows = this.database
      .prepare("SELECT * FROM cronjobs ORDER BY created_at ASC")
      .all() as unknown as CronjobRow[];

    return rows.map(mapRow);
  }

  private initializeDatabase(): void {
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS cronjobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        cron_expression TEXT NOT NULL,
        prompt TEXT NOT NULL,
        timezone TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        last_error TEXT
      );
    `);
  }

  private validateSchedule(
    cronExpression: string,
    timezone?: string,
  ): void {
    if (!this.scheduler.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: "${cronExpression}"`);
    }

    if (timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      } catch {
        throw new Error(`Invalid IANA timezone: "${timezone}"`);
      }
    }
  }

  private scheduleJob(job: Cronjob): void {
    this.destroyTask(job.id);

    const task = this.scheduler.schedule(
      job.cronExpression,
      async () => {
        await this.runJob(job.id);
      },
      {
        name: job.id,
        timezone: job.timezone,
        noOverlap: true,
      },
    );

    this.tasks.set(job.id, task);
  }

  private async runJob(id: string): Promise<void> {
    const job = this.getCronjob(id);
    const listener = this.listener;

    if (!this.listening || !listener || job?.status !== "active") {
      return;
    }

    const lastRunAt = new Date().toISOString();
    this.database
      .prepare(`
        UPDATE cronjobs
        SET last_run_at = ?, last_error = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(lastRunAt, lastRunAt, job.id);

    try {
      await listener(this.createMessage(job, lastRunAt));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Cron job execution failed";

      this.database
        .prepare(`
          UPDATE cronjobs
          SET last_error = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(message, new Date().toISOString(), job.id);

      await this.options.onError?.(error, job);
    }
  }

  private updateStatus(id: string, status: CronjobStatus): void {
    this.database
      .prepare(`
        UPDATE cronjobs
        SET status = ?, updated_at = ?, last_error = NULL
        WHERE id = ?
      `)
      .run(status, new Date().toISOString(), id);
  }

  private destroyTask(id: string): void {
    this.tasks.get(id)?.destroy();
    this.tasks.delete(id);
  }

  private createMessage(job: Cronjob, triggeredAt: string): InputMessage {
    return {
      id: `input-${randomUUID()}`,
      channel: this.channel,
      sessionId: this.options.sessionId ?? `cronjob-${job.id}`,
      text: job.prompt,
      createdAt: new Date(triggeredAt),
      metadata: {
        cronjob: {
          id: job.id,
          name: job.name,
          cronExpression: job.cronExpression,
          timezone: job.timezone,
          triggeredAt,
        },
      },
    };
  }
}

export type ManageCronjobsAction =
  | "add"
  | "list"
  | "suspend"
  | "resume"
  | "remove";

export interface ManageCronjobsInput {
  action: ManageCronjobsAction;
  idOrName: string | null;
  name: string | null;
  cronExpression: string | null;
  prompt: string | null;
  timezone: string | null;
}

export interface ManageCronjobsOutput {
  message: string;
  job: Cronjob | null;
  jobs: Cronjob[];
}

const manageCronjobsManifest: CapabilityManifest = {
  id: "cronjobs.manage",
  version: "1.0.0",
  name: "manage_cronjobs",
  description:
    "Adds, lists, suspends, resumes, or removes persistent scheduled prompts. Each active cron job sends its prompt to the Agent OS agent loop at the configured time.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "list", "suspend", "resume", "remove"],
      },
      idOrName: {
        type: ["string", "null"],
        description:
          "Cron job ID or exact name for suspend, resume, or remove; otherwise null.",
      },
      name: {
        type: ["string", "null"],
        description: "Unique human-readable job name for add; otherwise null.",
      },
      cronExpression: {
        type: ["string", "null"],
        description:
          "Standard 5- or 6-field node-cron expression for add; otherwise null.",
      },
      prompt: {
        type: ["string", "null"],
        description:
          "Prompt that the agent should execute on each schedule for add; otherwise null.",
      },
      timezone: {
        type: ["string", "null"],
        description:
          "Optional IANA timezone such as Europe/Rome for add; otherwise null.",
      },
    },
    required: [
      "action",
      "idOrName",
      "name",
      "cronExpression",
      "prompt",
      "timezone",
    ],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      job: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      jobs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
    required: ["message", "job", "jobs"],
    additionalProperties: false,
  },
  permissions: ["cronjobs.read", "cronjobs.write"],
  tags: [
    "cron",
    "cronjob",
    "schedule",
    "scheduled",
    "timer",
    "recurring",
    "reminder",
    "add",
    "list",
    "suspend",
    "pause",
    "resume",
    "remove",
    "delete",
  ],
  execution: {
    timeoutMs: 5_000,
    idempotent: false,
  },
  examples: [
    {
      request:
        "Every weekday at 9 AM, research the latest AI news",
      arguments: {
        action: "add",
        idOrName: null,
        name: "weekday-ai-news",
        cronExpression: "0 9 * * 1-5",
        prompt: "Research the latest AI news and summarize it.",
        timezone: "Europe/Rome",
      },
    },
    {
      request: "Suspend the weekday-ai-news cron job",
      arguments: {
        action: "suspend",
        idOrName: "weekday-ai-news",
        name: null,
        cronExpression: null,
        prompt: null,
        timezone: null,
      },
    },
  ],
};

export class ManageCronjobsCapability
  implements Capability<ManageCronjobsInput, ManageCronjobsOutput>
{
  readonly manifest = manageCronjobsManifest;

  constructor(private readonly cronjobs: CronjobInput) {}

  async execute(
    input: ManageCronjobsInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<ManageCronjobsOutput>> {
    if (context.signal?.aborted) {
      return failure("CRONJOB_ABORTED", "Cron job operation was aborted");
    }

    try {
      switch (input.action) {
        case "add": {
          const job = this.cronjobs.addCronjob({
            name: requiredText(input.name ?? undefined, "name"),
            cronExpression: requiredText(
              input.cronExpression ?? undefined,
              "cronExpression",
            ),
            prompt: requiredText(input.prompt ?? undefined, "prompt"),
            timezone: input.timezone ?? undefined,
          });

          return success(`Cron job "${job.name}" added`, job);
        }
        case "list": {
          const jobs = this.cronjobs.listCronjobs();
          return {
            success: true,
            data: {
              message: `${jobs.length} cron job${jobs.length === 1 ? "" : "s"} found`,
              job: null,
              jobs,
            },
          };
        }
        case "suspend":
          return this.changeExisting(
            input.idOrName,
            "suspended",
            (target) => this.cronjobs.suspendCronjob(target),
          );
        case "resume":
          return this.changeExisting(
            input.idOrName,
            "resumed",
            (target) => this.cronjobs.resumeCronjob(target),
          );
        case "remove":
          return this.changeExisting(
            input.idOrName,
            "removed",
            (target) => this.cronjobs.removeCronjob(target),
          );
        default:
          return failure(
            "VALIDATION_ERROR",
            `Unsupported cron job action: ${String(input.action)}`,
          );
      }
    } catch (error) {
      return failure(
        isConstraintError(error)
          ? "CRONJOB_ALREADY_EXISTS"
          : "CRONJOB_OPERATION_FAILED",
        error instanceof Error ? error.message : "Cron job operation failed",
      );
    }
  }

  private changeExisting(
    idOrName: string | null,
    verb: string,
    change: (target: string) => Cronjob | undefined,
  ): CapabilityResult<ManageCronjobsOutput> {
    const target = requiredText(idOrName ?? undefined, "idOrName");
    const job = change(target);

    if (!job) {
      return failure(
        "CRONJOB_NOT_FOUND",
        `Cron job "${target}" was not found`,
      );
    }

    return success(`Cron job "${job.name}" ${verb}`, job);
  }
}

interface CronjobRow {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  timezone: string | null;
  status: CronjobStatus;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_error: string | null;
}

function mapRow(row: CronjobRow): Cronjob {
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cron_expression,
    prompt: row.prompt,
    timezone: row.timezone ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at ?? undefined,
    lastError: row.last_error ?? undefined,
  };
}

function requiredText(
  value: string | undefined,
  field: string,
): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`Input '${field}' is required`);
  }

  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function success(
  message: string,
  job: Cronjob,
): CapabilityResult<ManageCronjobsOutput> {
  return {
    success: true,
    data: {
      message,
      job,
      jobs: [],
    },
  };
}

function failure(
  code: string,
  message: string,
): CapabilityResult<never> {
  return {
    success: false,
    error: {
      code,
      message,
      retryable: false,
    },
  };
}

function isConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /constraint|unique/i.test(error.message)
  );
}
