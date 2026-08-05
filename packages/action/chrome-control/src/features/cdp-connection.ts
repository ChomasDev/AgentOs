interface CdpMessage {
  id?: number;
  error?: { message?: string };
  result?: unknown;
}

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
    }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", () => this.handleClose());
  }

  static connect(url: string, signal?: AbortSignal): Promise<CdpConnection> {
    return new Promise((resolvePromise, reject) => {
      const socket = new WebSocket(url);
      const stopListening = () => signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        socket.close();
        reject(signal?.reason ?? new Error("Browser connection aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      socket.addEventListener(
        "open",
        () => {
          stopListening();
          resolvePromise(new CdpConnection(socket));
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          stopListening();
          reject(new Error("Could not connect to Chromium DevTools"));
        },
        { once: true },
      );
    });
  }

  isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  private handleMessage(event: MessageEvent): void {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (message.id === undefined) return;

    const pending = this.pending.get(message.id);
    if (!pending) return;

    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? "DevTools error"));
      return;
    }
    pending.resolve(message.result);
  }

  private handleClose(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Browser connection closed"));
    }
    this.pending.clear();
  }
}
