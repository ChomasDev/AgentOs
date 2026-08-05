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
orchestrator selects a primary output and may add response copies or
channel-specific messages on other configured outputs.

Domain types are exported from `@agent-os/core/domain` (see `src/domain/`).

## Interactive setup

Run the React terminal wizard to configure Agent OS:

```bash
pnpm setup
```

The centered two-pane interface walks through the AI provider, model,
environment, discovery, orchestrator, agent loop, inputs, outputs, and actions.
The right pane previews the highlighted package and expands every interface it
contains, including permissions and required companion interfaces.

Use **↑ / ↓** (or `j` / `k`) to move, **Space** to select, **Enter** to
continue, and **Esc** to go back. The review step writes
`packages/app-dynamic/src/agent-conf.yaml`. Existing package configuration is
preserved when possible. To write somewhere else:

```bash
pnpm setup -- --output ./agent-conf.yaml
```

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
  agent-os.package.yaml
  package.json
  tsconfig.json
  src/index.ts      # stub implementing the domain interface
```

Templates (edit these to change future scaffolds):

```text
scripts/mockups/
  agent-os.package.yaml.mockup
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

## Package manifests and selective installation

Every capability package contains `agent-os.package.yaml`. It describes the
package identity and each installable interface, including its kind and
permissions:

```yaml
schemaVersion: 1
id: openrouter-api
name: OpenRouter API
version: 0.1.0
interfaces:
  - id: openrouter-api.input
    kind: input
    name: OpenRouterApiInput
    permissions: [network.inbound]
  - id: openrouter-api.output
    kind: output
    name: OpenRouterApiInput
    permissions: [network.inbound]
    required: [input]
```

When `app-dynamic` downloads a package, it shows this information in an
interactive checkbox selector. Use **↑ / ↓** (or `j` / `k`) to move,
**Space** to toggle a component, and **Enter** to confirm. Dependencies are
added automatically: in the example, selecting only the output also selects
the required input.

The selection is recorded beside the installed package in
`agent-os.install.yaml`; only selected interfaces are instantiated. In
non-interactive environments, `AGENT_OS_AUTO_INSTALL=1` accepts the components
requested by `agent-conf.yaml` together with their requirements.

## Existing packages

| Package | Kind |
| --- | --- |
| `@agent-os/io-cli` | input (+ CLI output in same package) |
| `@agent-os/input-cronjob` | input (+ cron management capability) |
| `@agent-os/action-cli` | action |
| `@agent-os/action-chrome-control` | action (Chrome on macOS) |
| `@agent-os/action-pc-control` | action (macOS) |
| `@agent-os/action-perplexityserach` | action |
| `@agent-os/openai` | ai |
| `@agent-os/ai-codex` | ai |
| `@agent-os/env-node` | env |
| `@agent-os/discovery-memory` | discovery |
| `@agent-os/orchestrator-default` | orchestrator |
| `@agent-os/output-telegram` | output |
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

Codex, Perplexity, CLI child processes, OS settings, and terminal formatting
all receive configuration through this environment instance.

## Orchestration

`DefaultOrchestrator` uses the OS model before the agent loop runs. It receives
the current message and chat metadata, available capability manifests, and
configured output channels. Its structured decision chooses:

- the capability IDs the agent loop may use;
- the primary output channel that receives progress and the final response;
- optional additional outputs that receive either a response copy or fixed
  channel-specific text.

The decision is validated against the available capabilities and outputs.
If model routing fails, the orchestrator falls back to text-based capability
discovery and the preferred, matching-input, or first configured output.
The orchestrator always considers the complete registered capability catalog
and can select up to 50 capabilities by default. The agent loop can load the
same default maximum; both limits remain configurable through their
`maxCapabilities` constructor option.

For example, with the web API and Telegram configured, a web request to write
a report can route the generated report to Telegram while returning a short
`Okay, done.` acknowledgement to the web request. Set both variables to enable
the Telegram output:

```dotenv
TELEGRAM_BOT_TOKEN=123456:bot-token
TELEGRAM_CHAT_ID=123456789
```

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
pnpm setup           # open the interactive configuration wizard
pnpm build           # build core + packages
pnpm dev             # run the app
pnpm start           # start the app
```

Set `PERPLEXITY_API_KEY` in `.env` to register the optional `web.search`
capability. You can test it in the main app with a prompt such as:

```text
Search the web for the latest TypeScript release.
```

## macOS PC and Chrome control

The `pc-control` action uses macOS-native automation to open/focus/quit apps,
inspect an app's accessibility tree, move/click/drag/scroll the mouse, type text,
press keyboard shortcuts, list running apps, and capture screenshots.

The separate `chrome-control` action owns browser automation. For websites,
use the DOM-aware `web_open`, `web_snapshot`, `web_fill`,
`web_select`, `web_click`, `web_press`, and `web_wait` operations. They locate elements by
CSS selector, label, name, or visible text and return the updated URL, title,
visible text, HTML, and interactive elements after each action.

Web control opens a dedicated Google Chrome profile under
`.agent-os/browser-profile` by default. The profile persists its login session.
`web_fill` atomically focuses, fills, dispatches input/change events, and
verifies a field, which avoids coordinate-click and lost-focus typing errors.
`web_select` chooses native options by visible text, HTML value, or zero-based
index, dispatches input/change events, verifies the result, and returns the
updated page. Passing an `<option>` selector to `web_click` automatically uses
the same selection path. When `web_press` receives an element target, it now
focuses that element before dispatching the key.

For native apps, `get_app_state` returns indexed accessibility elements plus an
optional screenshot. `click_element`, `set_element_value`, and
`perform_element_action` operate directly on a fresh `elementIndex` and then
return a new app state. These virtual element actions do not move the physical
mouse. Element indexes are intentionally ephemeral: always use an index from
the latest returned state. Coordinate mouse operations remain available as a
fallback for apps that do not expose usable accessibility controls. The `drag`
operation accepts start/end coordinates plus configurable duration and movement
steps, which supports visual canvases such as Figma.

When the action is enabled, Agent OS requests Accessibility, Automation, and
Screen Recording access during startup, before terminal input begins. Approve
the prompts for the terminal/runtime shown by macOS. If a permission remains
disabled, open **System Settings → Privacy & Security**, enable the terminal
(and `osascript` if macOS lists it), then restart Agent OS.

To suppress startup prompts, configure the action with
`requestPermissionsOnInit: false` or set
`PC_CONTROL_REQUEST_PERMISSIONS=false`. The `permissions` operation can request
and report access later.
