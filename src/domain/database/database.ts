export type DatabaseColumnType =
  | "string"
  | "number"
  | "boolean"
  | "datetime"
  | "json";

export interface DatabaseColumnSchema {
  type: DatabaseColumnType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
}

export interface DatabaseIndexSchema {
  columns: readonly string[];
  unique?: boolean;
}

export interface DatabaseTableSchema {
  primaryKey?: string;
  columns: Readonly<Record<string, DatabaseColumnSchema>>;
  indexes?: readonly DatabaseIndexSchema[];
}

export interface DatabaseStructure {
  tables: Readonly<Record<string, DatabaseTableSchema>>;
}

export interface DatabaseOrder {
  field: string;
  direction?: "asc" | "desc";
}

export interface DatabaseQuery {
  where?: Readonly<Record<string, unknown>>;
  orderBy?: readonly DatabaseOrder[];
  limit?: number;
  offset?: number;
}

export type DatabaseRecord = Record<string, unknown>;
export type DatabaseKey = string | number;

/** A database view restricted to one capability namespace. */
export interface Database {
  readonly namespace: string;
  init(structure: DatabaseStructure): Promise<void>;
  add<T extends DatabaseRecord>(table: string, value: T): Promise<T>;
  get<T extends DatabaseRecord>(table: string, id: DatabaseKey): Promise<T | undefined>;
  get<T extends DatabaseRecord>(table: string, query?: DatabaseQuery): Promise<readonly T[]>;
  set<T extends DatabaseRecord>(table: string, id: DatabaseKey, value: T): Promise<T>;
  update<T extends DatabaseRecord>(table: string, id: DatabaseKey, patch: Partial<T>): Promise<T | undefined>;
  delete(table: string, target: DatabaseKey | DatabaseQuery): Promise<number>;
}

/** The configured backend. Runtime code creates one isolated view per capability. */
export interface DatabaseProvider {
  scope(namespace: string): Database;
  close?(): Promise<void>;
}

/** Extend a capability's constructor options with this to use its scoped database. */
export interface DatabaseClientOptions {
  database: Database;
}
