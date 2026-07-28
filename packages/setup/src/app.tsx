import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Text,
  useApp,
  useInput,
  useStdout,
} from "ink";
import { normalizeRequirements } from "./config.js";
import { packagesForKind } from "./catalog.js";
import type {
  InterfaceKind,
  PackageManifest,
  WizardSelection,
} from "./types.js";

type StepId =
  | "ai"
  | "model"
  | "env"
  | "discovery"
  | "orchestrator"
  | "agent"
  | "input"
  | "output"
  | "action"
  | "review";

interface WizardStep {
  id: StepId;
  label: string;
  hint: string;
  kind?: InterfaceKind;
  mode: "single" | "multiple" | "text" | "review";
}

const STEPS: readonly WizardStep[] = [
  {
    id: "ai",
    label: "AI provider",
    hint: "Choose the provider that will run the agent.",
    kind: "ai",
    mode: "single",
  },
  {
    id: "model",
    label: "Model",
    hint: "Type the model ID used by the selected provider.",
    mode: "text",
  },
  {
    id: "env",
    label: "Environment",
    hint: "Choose how settings and secrets are loaded.",
    kind: "env",
    mode: "single",
  },
  {
    id: "discovery",
    label: "Discovery",
    hint: "Choose the capability catalog implementation.",
    kind: "discovery",
    mode: "single",
  },
  {
    id: "orchestrator",
    label: "Orchestrator",
    hint: "Choose how requests are routed.",
    kind: "orchestrator",
    mode: "single",
  },
  {
    id: "agent",
    label: "Agent loop",
    hint: "Choose the runtime loop.",
    kind: "agent",
    mode: "single",
  },
  {
    id: "input",
    label: "Inputs",
    hint: "Select every source that can send messages.",
    kind: "input",
    mode: "multiple",
  },
  {
    id: "output",
    label: "Outputs",
    hint: "Select every destination that can receive responses.",
    kind: "output",
    mode: "multiple",
  },
  {
    id: "action",
    label: "Actions",
    hint: "Select tools that the agent may call.",
    kind: "action",
    mode: "multiple",
  },
  {
    id: "review",
    label: "Review",
    hint: "Review the configuration and save it.",
    mode: "review",
  },
];

export interface SetupAppProps {
  catalog: PackageManifest[];
  initialSelection: WizardSelection;
  outputPath: string;
  onSave: (selection: WizardSelection) => Promise<void>;
}

export function SetupApp({
  catalog,
  initialSelection,
  outputPath,
  onSave,
}: SetupAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [stepIndex, setStepIndex] = useState(0);
  const [optionIndex, setOptionIndex] = useState(0);
  const [selection, setSelection] = useState(() =>
    normalizeRequirements(initialSelection, catalog),
  );
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const step = STEPS[stepIndex]!;
  const options = useMemo(
    () => (step.kind ? packagesForKind(catalog, step.kind) : []),
    [catalog, step.kind],
  );
  const focusedPackage =
    step.id === "model"
      ? catalog.find((pkg) => pkg.id === selection.interfaces.ai[0])
      : options[optionIndex];

  useEffect(() => {
    setOptionIndex(0);
    setMessage("");
  }, [stepIndex]);

  useInput((input, key) => {
    if (saving || saved) {
      return;
    }
    if (key.escape) {
      if (stepIndex === 0) {
        exit();
      } else {
        setStepIndex((current) => current - 1);
      }
      return;
    }

    if (step.mode === "text") {
      if (key.return) {
        if (selection.model.trim() === "") {
          setMessage("A model ID is required.");
          return;
        }
        setStepIndex((current) => current + 1);
        return;
      }
      if (key.backspace || key.delete) {
        setSelection((current) => ({
          ...current,
          model: current.model.slice(0, -1),
        }));
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        const printableInput = input.replaceAll(
          /[\u0000-\u001F\u007F]/g,
          "",
        );
        if (!printableInput) {
          return;
        }
        setSelection((current) => ({
          ...current,
          model: `${current.model}${printableInput}`,
        }));
      }
      return;
    }

    if (step.mode === "review") {
      if (key.return) {
        setSaving(true);
        void onSave(selection)
          .then(() => {
            setSaved(true);
            setSaving(false);
            setTimeout(() => exit(), 650);
          })
          .catch((error: unknown) => {
            setSaving(false);
            setMessage(
              error instanceof Error ? error.message : "Could not save config",
            );
          });
      }
      return;
    }

    if ((key.upArrow || input === "k") && options.length > 0) {
      setOptionIndex(
        (current) => (current - 1 + options.length) % options.length,
      );
      return;
    }
    if ((key.downArrow || input === "j") && options.length > 0) {
      setOptionIndex((current) => (current + 1) % options.length);
      return;
    }
    if (input === " " && focusedPackage && step.kind) {
      setSelection((current) =>
        togglePackage(
          current,
          catalog,
          step.kind!,
          focusedPackage,
          step.mode === "single",
        ),
      );
      return;
    }
    if (key.return) {
      if (
        step.kind &&
        (step.kind === "input" || step.kind === "output") &&
        selection.interfaces[step.kind].length === 0
      ) {
        setMessage(`Select at least one ${step.kind}.`);
        return;
      }
      setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
    }
  });

  const terminalWidth = stdout.columns || 100;
  const terminalHeight = stdout.rows || 30;
  const contentWidth = Math.max(64, Math.min(116, terminalWidth - 4));
  const panelHeight = Math.max(16, Math.min(22, terminalHeight - 9));
  const helpText =
    message ||
    (step.mode === "text"
      ? "Type model ID   ENTER Continue   ESC Back"
      : step.mode === "review"
        ? "ENTER Save configuration   ESC Back"
        : "↑/↓ Move   SPACE Select   ENTER Continue   ESC Back");

  return (
    <Box
      width={terminalWidth}
      height={terminalHeight}
      flexDirection="column"
    >
      <Header stepIndex={stepIndex} width={terminalWidth} />

      <Box flexDirection="column" alignItems="center" flexGrow={1}>
        <Box marginTop={1} alignItems="center" flexDirection="column">
          <Text bold color="white">
            Agent OS Setup
          </Text>
          <Text color="white">{step.hint}</Text>
        </Box>

        <Box
          width={contentWidth}
          flexGrow={1}
          alignItems="center"
          justifyContent="center"
          gap={2}
        >
          <Box
            width="58%"
            height={panelHeight}
            borderStyle="double"
            borderColor="white"
            flexDirection="column"
            paddingX={1}
          >
            <Text bold color="yellow">
              {step.label.toUpperCase()}
            </Text>
            <Box marginTop={1} flexDirection="column">
              {step.mode === "text" ? (
                <ModelInput value={selection.model} />
              ) : step.mode === "review" ? (
                <Review selection={selection} catalog={catalog} />
              ) : (
                <OptionList
                  options={options}
                  focusedIndex={optionIndex}
                  selectedIds={
                    step.kind ? selection.interfaces[step.kind] : []
                  }
                  single={step.mode === "single"}
                />
              )}
            </Box>
          </Box>

          <Box
            width="42%"
            height={panelHeight}
            borderStyle="double"
            borderColor="white"
            flexDirection="column"
            paddingX={1}
          >
            <Text bold color="yellow">
              PACKAGE DETAILS
            </Text>
            {step.mode === "review" ? (
              <SavePanel
                outputPath={outputPath}
                saving={saving}
                saved={saved}
              />
            ) : (
              <PackageDetail pkg={focusedPackage} />
            )}
          </Box>
        </Box>

        <Box marginBottom={1}>
          <Text color={message ? "yellow" : "white"}>{helpText}</Text>
        </Box>
      </Box>

      <StatusBar step={step} stepIndex={stepIndex} />
    </Box>
  );
}

function Header({
  stepIndex,
  width,
}: {
  stepIndex: number;
  width: number;
}) {
  const title = "Agent OS Professional Setup";
  const progress = `Step ${stepIndex + 1} of ${STEPS.length}`;
  const divider = "═".repeat(Math.max(width, 1));
  return (
    <Box flexDirection="column">
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color="white">
          {title}
        </Text>
        <Text color="white">{progress}</Text>
      </Box>
      <Text color="white" wrap="truncate">
        {divider}
      </Text>
    </Box>
  );
}

function OptionList({
  options,
  focusedIndex,
  selectedIds,
  single,
}: {
  options: PackageManifest[];
  focusedIndex: number;
  selectedIds: string[];
  single: boolean;
}) {
  if (options.length === 0) {
    return <Text color="yellow">No matching packages found.</Text>;
  }
  return (
    <Box flexDirection="column">
      {options.map((pkg, index) => {
        const selected = selectedIds.includes(pkg.id);
        const focused = focusedIndex === index;
        return (
          <Text
            key={pkg.id}
            color={focused || selected ? "yellow" : "white"}
            bold={focused}
            wrap="truncate-end"
          >
            {focused ? "►" : " "} {selected ? (single ? "◉" : "●") : "○"}{" "}
            {pkg.name} ({pkg.id})
          </Text>
        );
      })}
    </Box>
  );
}

function ModelInput({ value }: { value: string }) {
  return (
    <Text color="white">
      {" "}{value}
      <Text color="yellow">█</Text>
      {" ".repeat(Math.max(1, 34 - value.length))}
    </Text>
  );
}

function PackageDetail({ pkg }: { pkg?: PackageManifest }) {
  if (!pkg) {
    return <Text color="white">Select a package to see its details.</Text>;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="white">
        {pkg.name}
      </Text>
      <Text color="gray">
        {pkg.id}@{pkg.version}
      </Text>
      <Box>
        <Text color="white" wrap="truncate-end">
          {pkg.description ?? "No description"}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold color="white">
          Included interfaces
        </Text>
        {pkg.interfaces.map((iface) => (
          <Box key={iface.id} flexDirection="column">
            <Text color="white" wrap="truncate-end">
              <Text color="yellow">● {iface.kind}</Text>{" "}
              {iface.name ?? iface.className ?? iface.id}
            </Text>
            <Text wrap="truncate-end">
              <Text color="gray">{iface.id} · </Text>
              <Text color={iface.permissions.length > 0 ? "yellow" : "white"}>
                {iface.permissions.join(", ") || "none"}
              </Text>
              {iface.required.length > 0 ? (
                <Text color="magenta">
                  {" "}· requires {iface.required.join(", ")}
                </Text>
              ) : null}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Review({
  selection,
  catalog,
}: {
  selection: WizardSelection;
  catalog: PackageManifest[];
}) {
  const rows: Array<[string, string]> = [
    ["AI", packageNames(selection.interfaces.ai, catalog)],
    ["Model", selection.model],
    ["Environment", packageNames(selection.interfaces.env, catalog)],
    ["Inputs", packageNames(selection.interfaces.input, catalog)],
    ["Outputs", packageNames(selection.interfaces.output, catalog)],
    ["Actions", packageNames(selection.interfaces.action, catalog)],
  ];
  return (
    <Box flexDirection="column">
      {rows.map(([label, value]) => (
        <Box key={label}>
          <Box width={13}>
            <Text color="yellow">{label}</Text>
          </Box>
          <Text color="white">{value || "none"}</Text>
        </Box>
      ))}
    </Box>
  );
}

function SavePanel({
  outputPath,
  saving,
  saved,
}: {
  outputPath: string;
  saving: boolean;
  saved: boolean;
}) {
  return (
    <Box flexDirection="column" justifyContent="center" flexGrow={1}>
      <Text bold color={saved ? "yellow" : "white"}>
        {saved ? "✓ Configuration saved" : saving ? "Saving…" : "Ready to save"}
      </Text>
      <Box marginTop={1}>
        <Text color="gray" wrap="truncate-end">
          {outputPath}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="white">
          {saved
            ? "You can now run pnpm dev:dynamic."
            : "Press Enter to write this configuration."}
        </Text>
      </Box>
    </Box>
  );
}

function StatusBar({
  step,
  stepIndex,
}: {
  step: WizardStep;
  stepIndex: number;
}) {
  return (
    <Box
      width="100%"
      justifyContent="space-between"
      paddingX={1}
    >
      <Text color="white" bold>
        ESC=Back/Quit   SPACE=Select   ENTER=Continue
      </Text>
      <Text color="white" bold>
        {step.label} [{stepIndex + 1}/{STEPS.length}]
      </Text>
    </Box>
  );
}

function togglePackage(
  selection: WizardSelection,
  catalog: readonly PackageManifest[],
  kind: InterfaceKind,
  pkg: PackageManifest,
  single: boolean,
): WizardSelection {
  const current = selection.interfaces[kind];
  const interfaces = {
    ...selection.interfaces,
    [kind]: single
      ? [pkg.id]
      : current.includes(pkg.id)
        ? current.filter((id) => id !== pkg.id)
        : [...current, pkg.id],
  };
  let model = selection.model;

  if (kind === "ai" && single) {
    const configuredModel = selection.configs.get(`ai:${pkg.id}`)?.model;
    const defaultModel = pkg.interfaces
      .find((iface) => iface.kind === "ai")
      ?.config.find((entry) => entry.key === "model")?.default;
    model =
      typeof configuredModel === "string"
        ? configuredModel
        : typeof defaultModel === "string"
          ? defaultModel
          : "";
  }

  return normalizeRequirements(
    { ...selection, interfaces, model },
    catalog,
  );
}

function packageNames(
  ids: readonly string[],
  catalog: readonly PackageManifest[],
): string {
  return ids
    .map((id) => catalog.find((pkg) => pkg.id === id)?.name ?? id)
    .join(", ");
}
