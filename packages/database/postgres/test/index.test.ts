import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresDatabaseProvider,
  type PostgresPool,
  type PostgresQueryResult,
} from "../src/index.js";

test("creates native PostgreSQL schemas from JSON structures", async () => {
  const statements: string[] = [];
  const pool: PostgresPool = {
    async query<Row>(text: string): Promise<PostgresQueryResult<Row>> {
      statements.push(text);
      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };
  const provider = new PostgresDatabaseProvider({ pool });
  const database = provider.scope("web");
  await database.init({
    tables: {
      pages: {
        columns: {
          id: { type: "string", required: true },
          payload: { type: "json", required: true },
        },
      },
    },
  });

  assert.match(statements[0]!, /CREATE SCHEMA IF NOT EXISTS "web"/);
  assert.match(statements[1]!, /CREATE TABLE IF NOT EXISTS "web"\."pages"/);
  assert.match(statements[1]!, /"payload" JSONB NOT NULL/);
});
