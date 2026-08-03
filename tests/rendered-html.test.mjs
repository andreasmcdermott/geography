import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps account progress behind authenticated server storage", async () => {
  const [page, client, route, hosting, migration] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/QuizApp.tsx", root), "utf8"),
    readFile(new URL("app/api/progress/route.ts", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("drizzle/0000_heavy_steve_rogers.sql", root), "utf8"),
  ]);

  assert.match(page, /<QuizApp\s*\/>/);
  assert.match(client, /Saved to your account/);
  assert.match(client, /syncAccountProgress/);
  assert.match(route, /getChatGPTUser/);
  assert.match(route, /Authentication required/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(migration, /CREATE TABLE `country_progress`/);
  assert.match(migration, /PRIMARY KEY\(`user_email`, `topic`, `country_code`\)/);
});
