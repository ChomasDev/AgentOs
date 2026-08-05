import type {
  Database,
  DatabaseRecord,
  Memory,
  MemoryEntry,
  MemoryKind,
  MemoryQuery,
} from "@agent-os/core/domain";

const TABLE = "entries";

interface StoredMemory extends DatabaseRecord {
  id: string;
  kind: MemoryKind;
  content: unknown;
  createdAt: Date;
  updatedAt: Date | null;
  userId: string | null;
  sessionId: string | null;
  importance: number | null;
  confidence: number | null;
  metadata: Record<string, unknown>;
}

export interface DatabaseMemoryOptions { database: Database }

export class DatabaseMemory implements Memory {
  private readonly ready: Promise<void>;

  constructor(private readonly options: DatabaseMemoryOptions) {
    if (!options.database) throw new Error("DatabaseMemory requires a scoped database");
    this.ready = options.database.init({
      tables: {
        [TABLE]: {
          primaryKey: "id",
          columns: {
            id: { type: "string", required: true },
            kind: { type: "string", required: true },
            content: { type: "json", required: true },
            createdAt: { type: "datetime", required: true },
            updatedAt: { type: "datetime" },
            userId: { type: "string" },
            sessionId: { type: "string" },
            importance: { type: "number" },
            confidence: { type: "number" },
            metadata: { type: "json", required: true, default: {} },
          },
          indexes: [
            { columns: ["sessionId", "createdAt"] },
            { columns: ["userId", "kind"] },
          ],
        },
      },
    });
  }

  async remember(entry: MemoryEntry): Promise<void> {
    await this.ready;
    await this.options.database.set(TABLE, entry.id, toStored(entry));
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    await this.ready;
    const row = await this.options.database.get<StoredMemory>(TABLE, id);
    return row ? fromStored(row) : undefined;
  }

  async recall(query: MemoryQuery = {}): Promise<readonly MemoryEntry[]> {
    await this.ready;
    const where: Record<string, unknown> = {};
    if (query.userId !== undefined) where.userId = query.userId;
    if (query.sessionId !== undefined) where.sessionId = query.sessionId;
    const rows = await this.options.database.get<StoredMemory>(TABLE, {
      where,
      orderBy: [{ field: "createdAt", direction: query.order === "newest" ? "desc" : "asc" }],
    });
    return rows
      .map(fromStored)
      .filter((entry) => matches(entry, query))
      .slice(0, Math.max(0, query.limit ?? 100));
  }

  async forget(id: string): Promise<boolean> {
    await this.ready;
    return (await this.options.database.delete(TABLE, id)) > 0;
  }

  async clear(query: MemoryQuery = {}): Promise<number> {
    await this.ready;
    if (Object.keys(query).length === 0) return this.options.database.delete(TABLE, {});
    const entries = await this.recall({ ...query, limit: Number.MAX_SAFE_INTEGER });
    const removed = await Promise.all(entries.map((entry) => this.options.database.delete(TABLE, entry.id)));
    return removed.reduce((total, count) => total + count, 0);
  }
}

function toStored(entry: MemoryEntry): StoredMemory {
  return {
    id: entry.id,
    kind: entry.kind,
    content: entry.content,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt ?? null,
    userId: entry.userId ?? null,
    sessionId: entry.sessionId ?? null,
    importance: entry.importance ?? null,
    confidence: entry.confidence ?? null,
    metadata: { ...entry.metadata },
  };
}

function fromStored(row: StoredMemory): MemoryEntry {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    createdAt: new Date(row.createdAt),
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : undefined,
    userId: row.userId ?? undefined,
    sessionId: row.sessionId ?? undefined,
    importance: row.importance ?? undefined,
    confidence: row.confidence ?? undefined,
    metadata: row.metadata,
  };
}

function matches(entry: MemoryEntry, query: MemoryQuery): boolean {
  if (query.kinds?.length && !query.kinds.includes(entry.kind)) return false;
  if (query.minImportance !== undefined && (entry.importance ?? 0) < query.minImportance) return false;
  if (query.text?.trim() && !JSON.stringify(entry.content).toLowerCase().includes(query.text.trim().toLowerCase())) return false;
  if (!query.metadata) return true;
  return Object.entries(query.metadata).every(([key, value]) => entry.metadata?.[key] === value);
}
