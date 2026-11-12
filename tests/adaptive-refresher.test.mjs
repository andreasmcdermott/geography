import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const client = await readFile(new URL("app/QuizApp.tsx", root), "utf8");
const countries = Array.from({ length: 60 }, (_, index) => ({
  code: `C${index}`,
  name: `Country ${index}`,
  region: index < 40 ? "Europe" : "Asia",
}));
const mastered = (lastPlayedAt) => ({ attempts: 3, correct: 3, streak: 3, mastered: true, lastPlayedAt });
function quizContext() {
  const source = client.slice(client.indexOf("function mergeProgress"), client.indexOf("function plural"));
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const context = vm.createContext({ countries });
  vm.runInContext(outputText, context);
  return context;
}

test("adaptive refreshers select the oldest countries at every quiz length and rotate after answers", () => {
  const context = quizContext();
  for (const topic of ["map", "flags", "capitals"]) {
    const progress = { map: {}, flags: {}, capitals: {} };
    // Reverse chronological order makes the expected pool independent of country order.
    progress[topic] = Object.fromEntries(countries.map((country, index) => [country.code, mastered(60 - index)]));
    for (const length of [20, 30, 40, 50, "all"]) {
      const questions = context.buildQuiz(topic, length, progress, "adaptive", "Europe", "names");
      const count = length === "all" ? 60 : length;
      assert.equal(questions.length, count);
      assert.deepEqual(new Set(questions.map(({ country }) => country.code)), new Set(countries.slice(60 - count).map(({ code }) => code)));
    }
    const first = context.buildQuiz(topic, 20, progress, "adaptive", "All", "names");
    for (const { country } of first) progress[topic][country.code].lastPlayedAt = 100;
    const next = context.buildQuiz(topic, 20, progress, "adaptive", "All", "names");
    assert.equal(next.length, 20);
    assert.ok(next.every(({ country }) => !first.some((question) => question.country.code === country.code)));
  }
});

test("adaptive keeps unfinished countries first and supports legacy records without dates", () => {
  const context = quizContext();
  const progress = { map: Object.fromEntries(countries.map(({ code }, index) => [code, mastered(index + 1)])), flags: {}, capitals: {} };
  delete progress.map.C59.lastPlayedAt;
  const oldest = context.buildQuiz("map", 20, progress, "adaptive", "All", "flags");
  assert.equal(oldest[0].country.code, "C59");
  assert.ok(oldest.every(({ direction }) => direction === "answer-to-country"));
  progress.map.C0.mastered = false;
  const learning = context.buildQuiz("map", 20, progress, "adaptive", "All", "names");
  assert.equal(learning.length, 1);
  assert.equal(learning[0].country.code, "C0");
  assert.equal(context.buildQuiz("map", "all", progress, "region", "Europe", "names").length, 40);
  assert.equal(context.buildQuiz("map", "all", progress, "elimination", "Europe", "names").length, 40);
});

test("local answers record recency and preserve mastery, including a missed refresher answer", () => {
  let progress = { map: { C0: mastered(1) }, flags: {}, capitals: {} };
  const source = client.slice(client.indexOf("function recordAnswer("), client.indexOf("function answer("));
  const context = vm.createContext({
    setProgress(update) { progress = update(progress); },
    syncAnswer() {},
  });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const before = Date.now();
  context.recordAnswer("map", "C0", false);
  assert.equal(progress.map.C0.mastered, true);
  assert.equal(progress.map.C0.streak, 0);
  assert.equal(progress.map.C0.attempts, 4);
  assert.ok(progress.map.C0.lastPlayedAt >= before);

  const merged = quizContext().mergeProgress(progress, { map: { C0: mastered(1) }, flags: {}, capitals: {} });
  assert.equal(merged.map.C0.lastPlayedAt, progress.map.C0.lastPlayedAt);
  const newer = { map: { C0: mastered(Date.now() + 1000) }, flags: {}, capitals: {} };
  assert.equal(quizContext().mergeProgress(progress, newer).map.C0.lastPlayedAt, newer.map.C0.lastPlayedAt);
});

async function progressApi(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(await readFile(new URL("drizzle/0000_heavy_steve_rogers.sql", root), "utf8"));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind(...values) {
        return {
          async run() { return statement.run(...values); },
          async all() { return { results: statement.all(...values) }; },
          async first() { return statement.get(...values) ?? null; },
        };
      } };
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
  const source = await readFile(new URL("app/api/progress/route.ts", root), "utf8");
  const context = vm.createContext({
    exports: {}, Response,
    require(name) {
      if (name === "../../chatgpt-auth") return { getChatGPTUser: async () => ({ email: "reader@example.com", displayName: "Reader" }) };
      if (name === "../../../db") return { getD1: () => db };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { api: context.exports, sqlite };
}
const request = (payload) => new Request("http://localhost/api/progress", { method: "PUT", body: JSON.stringify(payload) });

test("progress API preserves actual play dates through imports, reloads and stale device syncs", async (t) => {
  const { api, sqlite } = await progressApi(t);
  sqlite.prepare("INSERT INTO country_progress VALUES (?, ?, ?, 3, 3, 3, 1, ?)").run("reader@example.com", "map", "FR", "2025-01-01 12:00:00");
  const legacyDate = Date.parse("2025-01-01T12:00:00Z");
  assert.equal((await (await api.GET()).json()).progress.map.FR.lastPlayedAt, legacyDate);
  await api.PUT(request({ progress: { map: { FR: mastered(undefined), DE: mastered(undefined) } } }));
  let saved = (await (await api.GET()).json()).progress;
  assert.equal(saved.map.FR.lastPlayedAt, legacyDate, "signing in must not reset recency");
  assert.equal(saved.map.DE.lastPlayedAt, 0, "undated local progress stays oldest");

  const playedAt = Date.parse("2025-01-01T12:00:01.123Z");
  await api.PUT(request({ progress: { map: { FR: mastered(playedAt) } } }));
  await api.PUT(request({ progress: { map: { FR: mastered(legacyDate) } } }));
  saved = (await (await api.GET()).json()).progress;
  assert.equal(saved.map.FR.lastPlayedAt, playedAt, "a stale device must not overwrite a newer play date");

  const before = Date.now();
  const answer = (await (await api.POST(request({ topic: "map", countryCode: "FR", correct: false }))).json()).record;
  assert.ok(answer.lastPlayedAt >= before);
  assert.equal(answer.mastered, true);
  assert.equal(answer.streak, 0);
  await api.PUT(request({ progress: saved }));
  assert.equal((await (await api.GET()).json()).progress.map.FR.lastPlayedAt, answer.lastPlayedAt);

  const fresh = (await (await api.POST(request({ topic: "flags", countryCode: "JP", correct: true }))).json()).record;
  assert.equal(fresh.attempts, 1);
  assert.ok(fresh.lastPlayedAt >= before);
});
