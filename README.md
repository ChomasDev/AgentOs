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
| `agent` | `AgentLoop` | `packages/agent/<name>` | `@agent-os/agent-<name>` | Orchestrates discovery → model → capability calls |

**Capability (`action`)** is the one that exposes a callable tool with a manifest (`id`, `name`, schemas, tags). The other kinds wire the OS around those tools.

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
| `@agent-os/action-cli` | action |
| `@agent-os/action-perplexityserach` | action |
| `@agent-os/openai` | ai |
| `@agent-os/env-node` | env |
| `@agent-os/discovery-memory` | discovery |
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
