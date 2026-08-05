import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteDatabaseProvider } from "../src/index.js";

const structure = {
  tables: {
    pages: {
      primaryKey: "id",
      columns: {
        id: { type: "string" as const, required: true },
        title: { type: "string" as const, required: true },
        visits: { type: "number" as const, default: 0 },
        data: { type: "json" as const },
      },
      indexes: [{ columns: ["title"] }],
    },
  },
};

test("provides isolated namespaces and JSON-defined CRUD", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const web = provider.scope("web");
  const auth = provider.scope("auth");
  await Promise.all([web.init(structure), auth.init(structure)]);

  await web.add("web.pages", { id: "one", title: "Agent OS", data: { live: true } });
  await auth.add("pages", { id: "one", title: "Login", visits: 2 });
  assert.equal((await web.get("pages", "one"))?.title, "Agent OS");
  assert.equal((await auth.get("pages", "one"))?.title, "Login");

  const updated = await web.update("pages", "one", { visits: 3 });
  assert.equal(updated?.visits, 3);
  assert.deepEqual(updated?.data, { live: true });
  assert.equal((await web.get("pages", { where: { visits: 3 } })).length, 1);
  assert.equal(await web.delete("pages", "one"), 1);
  assert.equal(await web.get("pages", "one"), undefined);
  await provider.close();
});
