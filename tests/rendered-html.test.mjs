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
  assert.match(client, /\/api\/progress/);
  assert.match(client, /\/flags\/\$\{code\.toLocaleLowerCase\(\)\}\.svg/);
  assert.match(client, /label="Flag to identify"/);
  assert.doesNotMatch(client, /label=\{`Flag of \$\{question\.country\.name\}`\}/);
  assert.match(client, /Region test/);
  assert.match(client, /All regions/);
  assert.match(client, /Mastery is ignored in test mode/);
  assert.match(client, /quizLengths: QuizLength\[\] = \[20, 30, 40, 50, "all"\]/);
  assert.match(client, /mode === "adaptive"[\s\S]*mastered/);
  assert.match(client, /Elimination/);
  assert.match(client, /mode === "elimination"/);
  assert.match(client, /eliminationAnswerOrder\.filter\(\(item\) => !usedCodes\.has\(item\.code\)\)/);
  assert.match(client, /unused \$\{countryFirst \? "flags" : "countries"\} remain/);
  assert.match(route, /getChatGPTUser/);
  assert.match(route, /Authentication required/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(migration, /CREATE TABLE `country_progress`/);
  assert.match(migration, /PRIMARY KEY\(`user_email`, `topic`, `country_code`\)/);
});
