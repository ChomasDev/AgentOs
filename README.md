# Agent OS

Provider-neutral agent runtime. Domain contracts live in `@agent-os/core`; concrete adapters live under `packages/`.

## Adapter kinds

Each adapter package implements one domain interface:

| Kind | Domain interface | Folder | Package name | Role |
| --- | --- | --- | --- | --- |
| `input` | `InputInterface` | `packages/input/<name>` | `@agent-os/input-<name>` | Receives user/messages into the OS (CLI, HTTP, Slack, …) |
| `output` | `OutputInterface` | `packages/output/<name>` | `@agent-os/output-<name>` | Writes agent responses to a destination |
| `action` | `Capability` | `packages/action/<name>` | `@agent-os/action-<name>` | A tool the agent can call (run a command, hit an API, …) |
| `ai` | `AIProvider` | `packages/ai/<name>` | `@agent-os/ai-<name>` | Model provider (OpenAI, Claude, local, …) |
| `env` | `Environment` | `packages/env/<name>` | `@agent-os/env-<name>` | Reads configuration and secrets from process env, dotenv, maps, vaults, … |
| `discovery` | `CapabilityDiscovery` | `packages/discovery/<name>` | `@agent-os/discovery-<name>` | Registry that finds/registers capabilities |
| `orchestrator` | `Orchestrator` | `packages/orchestrator/<name>` | `@agent-os/orchestrator-<name>` | Selects capabilities and the response destination for each message |
| `agent` | `AgentLoop` | `packages/agent/<name>` | `@agent-os/agent-<name>` | Runs the model/tool loop with the selected capabilities |

**Capability (`action`)** is the one that exposes a callable tool with a manifest (`id`, `name`, schemas, tags). The other kinds wire the OS around those tools.

`OSBootOptions.input` and `OSBootOptions.output` are vectors. The OS starts
every input concurrently, so long-running sources such as cron jobs, HTTP
listeners, and the CLI can feed the same agent loop. For every message, the
orchestrator selects one output from the configured output vector.

Domain types are exported from `@agent-os/core/domain` (see `src/domain/`).

## Create a new adapter

```bash
pnpm addCapability
```

1. Use **↑ / ↓** (or `j` / `k`) to pick a kind, then **Enter**
2. Enter an implementation name (folder slug), e.g. `web`, `slack`, `postgres`
3. Confirm creation

The script scaffolds the package, copies a stub from `scripts/mockups/`, and runs `pnpm install` so `@agent-os/core` is linked.

Non-interactive:

```bash
pnpm addCapability --kind action --name web -y
pnpm addCapability -k input -n express -y
pnpm addCapability -k env -n vault -y
pnpm addCapability -k orchestrator -n rules -y
```

### What gets created

```text
packages/<kind>/<name>/
  package.json
  tsconfig.json
  src/index.ts      # stub implementing the domain interface
```

Templates (edit these to change future scaffolds):

```text
scripts/mockups/
  <kind>.mockup.ts
  package.json.mockup
  tsconfig.json.mockup
```

### After scaffolding

1. Implement the `TODO`s in `src/index.ts`
2. Build: `pnpm --filter @agent-os/<kind>-<name> build`
3. Wire it into the app:
   - add a dependency in `packages/app/package.json`
   - import and register/boot it in `packages/app/src/main.ts`
4. Run `pnpm install` if you added the app dependency by hand

## Existing packages

| Package | Kind |
| --- | --- |
| `@agent-os/io-cli` | input (+ CLI output in same package) |
| `@agent-os/input-cronjob` | input (+ cron management capability) |
| `@agent-os/action-cli` | action |
| `@agent-os/action-perplexityserach` | action |
| `@agent-os/openai` | ai |
| `@agent-os/env-node` | env |
| `@agent-os/discovery-memory` | discovery |
| `@agent-os/orchestrator` | orchestrator |
| `@agent-os/agent-loop` | agent |
| `@agent-os/app` | composition root |

## Environment

`@agent-os/env-node` provides process, dotenv, map, and composite
implementations of the core `Environment` interface. The main app composes
process variables over the repository `.env` file, so exported variables take
precedence:

```ts
const env = new CompositeEnvironment([
  new ProcessEnvironment(),
  new DotenvEnvironment({ filePath: ".env" }),
]);
```

OpenAI, Perplexity, CLI child processes, OS settings, and terminal formatting
all receive configuration through this environment instance.

## Orchestration

`ModelOrchestrator` uses the OS model before the agent loop runs. It receives
the current message and chat metadata, available capability manifests, and
configured output channels. Its structured decision chooses:

- the capability IDs the agent loop may use;
- the single output channel that receives progress and the final response.

The decision is validated against the available capabilities and outputs.
If model routing fails, the orchestrator falls back to text-based capability
discovery and the preferred, matching-input, or first configured output.

## Cron jobs

The main app starts `CronjobInput` beside `CLIInput`. Cron jobs are stored in
SQLite at `.agent-os/cronjobs.sqlite` by default and restored whenever the app
starts. Override the location with `CRONJOB_DB_PATH`.

Each active job stores a cron expression and an agent prompt. When `node-cron`
fires the job, the prompt enters the same agent loop as any other input.
The `manage_cronjobs` capability lets the agent add, list, suspend, resume, and
remove schedules. For example:

```text
Every weekday at 9 AM Europe/Rome time, research the latest AI news.
List my cron jobs.
Suspend the weekday-ai-news cron job.
Resume the weekday-ai-news cron job.
Remove the weekday-ai-news cron job.
```

## Scripts

```bash
pnpm addCapability   # scaffold a new adapter
pnpm build           # build core + packages
pnpm dev             # run the app
pnpm start           # start the app
```

Set `PERPLEXITY_API_KEY` in `.env` to register the optional `web.search`
capability. You can test it in the main app with a prompt such as:

```text
Search the web for the latest TypeScript release.
```
