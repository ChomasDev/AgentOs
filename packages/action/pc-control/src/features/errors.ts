export class ValidationError extends Error {}
export class UnsupportedPlatformError extends Error {}

export function commandErrorDetails(error: unknown): unknown {
  if (!(error instanceof Error)) return undefined;

  const details = error as Error & {
    command?: string;
    stderr?: string;
    stdout?: string;
  };
  if (!details.command && !details.stderr && !details.stdout) return undefined;

  return {
    command: details.command,
    stderr: details.stderr,
    stdout: details.stdout,
  };
}
