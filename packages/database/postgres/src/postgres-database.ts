import { Pool } from "pg";
import type {
  Database,
  DatabaseKey,
  DatabaseProvider,
  DatabaseQuery,
  DatabaseRecord,
  DatabaseStructure,
  DatabaseTableSchema,
} from "@agent-os/core/domain";
import {
  applyDefaults,
  normalizeNamespace,
  postgresType,
  safeIdentifier,
  validateStructure,
} from "./schema.js";

export interface PostgresQueryResult<Row = DatabaseRecord> { rows: Row[]; rowCount: number | null }
export interface PostgresPool {
  query<Row = DatabaseRecord>(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult<Row>>;
  end(): Promise<void>;
}
export interface PostgresDatabaseOptions { connectionString?: string; pool?: PostgresPool }

export class PostgresDatabaseProvider implements DatabaseProvider {
  private readonly pool: PostgresPool;
  private readonly ownsPool: boolean;
  private readonly schemas = new Map<string, DatabaseTableSchema>();

  constructor(options: PostgresDatabaseOptions = {}) {
    if (!options.pool && !options.connectionString?.trim()) throw new Error("PostgresDatabaseProvider requires connectionString");
    this.pool = options.pool ?? new Pool({ connectionString: options.connectionString });
    this.ownsPool = !options.pool;
  }

  scope(namespace: string): Database {
    return new PostgresDatabase(this.pool, normalizeNamespace(namespace), this.schemas);
  }

  async close(): Promise<void> { if (this.ownsPool) await this.pool.end(); }
}

class PostgresDatabase implements Database {
  constructor(
    private readonly pool: PostgresPool,
    readonly namespace: string,
    private readonly schemas: Map<string, DatabaseTableSchema>,
  ) {}

  async init(structure: DatabaseStructure): Promise<void> {
    validateStructure(structure);
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${quote(this.namespace)}`);
    for (const [table, schema] of Object.entries(structure.tables)) {
      await this.createTable(table, schema);
      this.schemas.set(this.key(table), schema);
    }
  }

  async add<T extends DatabaseRecord>(table: string, value: T): Promise<T> {
    const schema = this.schema(table);
    const record = applyDefaults(schema, value);
    const columns = Object.keys(record);
    const values = columns.map((key) => encode(record[key], schema.columns[key]!.type));
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const result = await this.pool.query<T>(`INSERT INTO ${this.name(table)} (${columns.map(quote).join(",")}) VALUES (${placeholders.join(",")}) RETURNING *`, values);
    return this.decode(schema, result.rows[0] ?? record) as T;
  }

  async get<T extends DatabaseRecord>(table: string, target?: DatabaseKey | DatabaseQuery): Promise<T | undefined | readonly T[]> {
    const schema = this.schema(table);
    if (typeof target === "string" || typeof target === "number") {
      const key = schema.primaryKey ?? "id";
      const result = await this.pool.query<T>(`SELECT * FROM ${this.name(table)} WHERE ${quote(key)} = $1`, [target]);
      return result.rows[0] ? this.decode(schema, result.rows[0]) as T : undefined;
    }
    const query = buildQuery(schema, target ?? {});
    const result = await this.pool.query<T>(`SELECT * FROM ${this.name(table)}${query.sql}`, query.values);
    return result.rows.map((row) => this.decode(schema, row) as T);
  }

  async set<T extends DatabaseRecord>(table: string, id: DatabaseKey, value: T): Promise<T> {
    const schema = this.schema(table);
    const primaryKey = schema.primaryKey ?? "id";
    const record = applyDefaults(schema, { ...value, [primaryKey]: id });
    const columns = Object.keys(record);
    const values = columns.map((key) => encode(record[key], schema.columns[key]!.type));
    const updates = columns.filter((key) => key !== primaryKey).map((key) => `${quote(key)}=EXCLUDED.${quote(key)}`);
    const conflict = updates.length ? `DO UPDATE SET ${updates.join(",")}` : "DO NOTHING";
    const result = await this.pool.query<T>(`INSERT INTO ${this.name(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")}) ON CONFLICT (${quote(primaryKey)}) ${conflict} RETURNING *`, values);
    return this.decode(schema, result.rows[0] ?? record) as T;
  }

  async update<T extends DatabaseRecord>(table: string, id: DatabaseKey, patch: Partial<T>): Promise<T | undefined> {
    const current = await this.get<T>(table, id);
    if (!current) return undefined;
    return this.set(table, id, { ...current, ...patch } as T);
  }

  async delete(table: string, target: DatabaseKey | DatabaseQuery): Promise<number> {
    const schema = this.schema(table);
    if (typeof target === "string" || typeof target === "number") {
      const key = schema.primaryKey ?? "id";
      const result = await this.pool.query(`DELETE FROM ${this.name(table)} WHERE ${quote(key)} = $1`, [target]);
      return result.rowCount ?? 0;
    }
    const query = buildQuery(schema, target, false);
    const result = await this.pool.query(`DELETE FROM ${this.name(table)}${query.sql}`, query.values);
    return result.rowCount ?? 0;
  }

  private async createTable(table: string, schema: DatabaseTableSchema): Promise<void> {
    const primaryKey = schema.primaryKey ?? "id";
    const columns = Object.entries(schema.columns).map(([name, column]) => `${quote(name)} ${postgresType(column.type)}${name === primaryKey ? " PRIMARY KEY" : ""}${column.required ? " NOT NULL" : ""}${column.unique ? " UNIQUE" : ""}`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.name(table)} (${columns.join(",")})`);
    for (const [index, definition] of (schema.indexes ?? []).entries()) {
      const unique = definition.unique ? "UNIQUE " : "";
      const name = quote(`${this.namespace}_${table}_${index}`);
      await this.pool.query(`CREATE ${unique}INDEX IF NOT EXISTS ${name} ON ${this.name(table)} (${definition.columns.map(quote).join(",")})`);
    }
  }

  private schema(table: string): DatabaseTableSchema {
    const schema = this.schemas.get(this.key(table));
    if (!schema) throw new Error(`Database table is not initialized: ${this.namespace}.${table}`);
    return schema;
  }
  private key(table: string): string { return `${this.namespace}.${this.localTable(table)}`; }
  private name(table: string): string { return `${quote(this.namespace)}.${quote(this.localTable(table))}`; }
  private localTable(table: string): string {
    const parts = table.split(".");
    if (parts.length === 1) return safeIdentifier(parts[0]!, "table name");
    if (parts.length === 2 && normalizeNamespace(parts[0]!) === this.namespace) return safeIdentifier(parts[1]!, "table name");
    throw new Error(`Table ${table} is outside database namespace ${this.namespace}`);
  }
  private decode(schema: DatabaseTableSchema, row: DatabaseRecord): DatabaseRecord {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decode(value, schema.columns[key]?.type)]));
  }
}

function buildQuery(schema: DatabaseTableSchema, query: DatabaseQuery, includePaging = true): { sql: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  for (const [field, value] of Object.entries(query.where ?? {})) {
    if (!schema.columns[field]) throw new Error(`Unknown database field: ${field}`);
    if (value === null) clauses.push(`${quote(field)} IS NULL`);
    else { values.push(encode(value, schema.columns[field]!.type)); clauses.push(`${quote(field)} = $${values.length}`); }
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  if (!includePaging) return { sql: where, values };
  const order = (query.orderBy ?? []).map(({ field, direction }) => {
    if (!schema.columns[field]) throw new Error(`Unknown database field: ${field}`);
    return `${quote(field)} ${direction === "desc" ? "DESC" : "ASC"}`;
  });
  const ordering = order.length ? ` ORDER BY ${order.join(",")}` : "";
  if (query.limit !== undefined) { values.push(Math.max(0, query.limit)); }
  const limit = query.limit === undefined ? "" : ` LIMIT $${values.length}`;
  if (query.offset !== undefined) { values.push(Math.max(0, query.offset)); }
  const offset = query.offset === undefined ? "" : ` OFFSET $${values.length}`;
  return { sql: `${where}${ordering}${limit}${offset}`, values };
}

function encode(value: unknown, type: string): unknown {
  if (value === undefined) return null;
  if (type === "json") return JSON.stringify(value);
  return value;
}
function decode(value: unknown, type?: string): unknown {
  if (type === "datetime" && value != null) return new Date(value as string | number | Date);
  if (type === "json" && typeof value === "string") return JSON.parse(value);
  return value;
}
function quote(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
