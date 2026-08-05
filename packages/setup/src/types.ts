export const INTERFACE_KINDS = [
  "env",
  "ai",
  "discovery",
  "database",
  "memory",
  "orchestrator",
  "agent",
  "input",
  "output",
  "action",
] as const;

export type InterfaceKind = (typeof INTERFACE_KINDS)[number];

export interface ManifestConfig {
  key: string;
  env?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface ManifestInterface {
  id: string;
  kind: InterfaceKind;
  name?: string;
  className?: string;
  description?: string;
  permissions: string[];
  required: string[];
  config: ManifestConfig[];
}

export interface PackageManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  interfaces: ManifestInterface[];
}

export interface PackageEntry {
  id: string;
  config?: Record<string, unknown>;
}

export type AgentInterfaces = Record<InterfaceKind, PackageEntry[]>;

export interface AgentConfiguration {
  schemaVersion: 1;
  interfaces: AgentInterfaces;
}

export interface WizardSelection {
  interfaces: Record<InterfaceKind, string[]>;
  configs: Map<string, Record<string, unknown>>;
  model: string;
}
