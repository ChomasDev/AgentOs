import type {
  InputMessage,
  OutputInterface,
} from "@agent-os/core/domain";

export function addDeliveryContext(
  message: InputMessage,
  destination: string,
): InputMessage {
  if (destination === message.channel) return message;
  return {
    ...message,
    text: [
      message.text,
      "Delivery context:",
      `Agent OS will deliver your final response to the ${destination} output.`,
      "Write the exact content intended for that destination. Do not claim that delivery requires a tool or is unavailable.",
    ].join("\n\n"),
    metadata: { ...message.metadata, deliveryOutputChannel: destination },
  };
}

export function selectProgressOutput(
  source: InputMessage,
  outputs: readonly OutputInterface[],
): OutputInterface | undefined {
  if (source.channel !== "cli") return undefined;
  return outputs.find((output) => output.channel === "cli");
}
