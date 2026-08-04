import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps account progress behind authenticated server storage", async () => {
  const [page, client, styles, indonesiaFlag, monacoFlag, flagNotice, mapClient, mapData, countriesSource, route, hosting, migration] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/QuizApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("public/flags/id.svg", root), "utf8"),
    readFile(new URL("public/flags/mc.svg", root), "utf8"),
    readFile(new URL("public/licenses/country-flags-public-domain.txt", root), "utf8"),
    readFile(new URL("app/MapQuestionCard.tsx", root), "utf8"),
    readFile(new URL("public/data/world-map.json", root), "utf8"),
    readFile(new URL("app/countries.ts", root), "utf8"),
    readFile(new URL("app/api/progress/route.ts", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
    readFile(new URL("drizzle/0000_heavy_steve_rogers.sql", root), "utf8"),
  ]);

  assert.match(page, /<QuizApp\s*\/>/);
  assert.match(client, /Saved to your account/);
  assert.match(client, /\/api\/progress/);
  assert.match(client, /\/flags\/\$\{code\.toLocaleLowerCase\(\)\}\.svg/);
  const flagRatio = (source) => {
    const viewBox = source.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
    assert.equal(viewBox?.length, 4);
    return viewBox[2] / viewBox[3];
  };
  assert.equal(flagRatio(indonesiaFlag), 3 / 2);
  assert.equal(flagRatio(monacoFlag), 5 / 4);
  assert.doesNotMatch(styles, /aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(styles, /\.flag-image[^}]*object-fit:\s*contain/);
  assert.match(client, /country-flags-public-domain\.txt/);
  assert.match(flagNotice, /hampusborgos\/country-flags/);
  assert.match(client, /label="Flag to identify"/);
  assert.doesNotMatch(client, /label=\{`Flag of \$\{question\.country\.name\}`\}/);
  assert.match(client, /Region test/);
  assert.match(client, /All regions/);
  assert.match(client, /Mastery is ignored in test mode/);
  assert.match(client, /quizLengths: QuizLength\[\] = \[20, 30, 40, 50, "all"\]/);
  assert.match(client, /mode === "adaptive"[\s\S]*mastered/);
  assert.match(client, /Elimination/);
  assert.match(client, /mode === "elimination"/);
  assert.match(client, /topic !== "capitals" && \(/);
  assert.match(client, /nextTopic === "capitals" && quizMode === "elimination"/);
  assert.match(client, /elimination=\{quiz\.mode === "elimination"\}/);
  assert.match(client, /eliminatedCodes=\{quiz\.mode === "elimination" \? quiz\.questions\.slice\(0, quiz\.index\)/);
  assert.match(client, /completed locations are removed from the clickable map/);
  assert.match(client, /Free pick/);
  assert.match(client, /Choose any flag/);
  assert.match(client, /Filter by country name/);
  assert.match(client, /Matched flags stay faded in place/);
  assert.match(client, /matched-flag-slot/);
  assert.match(client, /free-answer-flash/);
  assert.match(client, /normalize\("NFKD"\)/);
  assert.match(client, /replace\(\/\\p\{M\}\/gu, ""\)/);
  assert.match(client, /normalizeSearchText\(country\.name\)\.includes\(normalized\)/);
  assert.match(client, /window\.setTimeout\(returnToBoard, correct \? 325 : 650\)/);
  assert.match(styles, /\.free-answer-flash\.success\s*\{\s*animation-duration:\s*\.325s/);
  assert.match(client, /recent-wrong/);
  assert.match(client, /const \[recentWrongCode, setRecentWrongCode\] = useState<string \| null>\(null\)/);
  assert.match(client, /const recentlyWrong = recentWrongCode === code/);
  assert.match(client, /onClick=\{\(\) => \{ setRecentWrongCode\(null\); setSelectedFlag\(country\)/);
  assert.doesNotMatch(client, /flagMarks/);
  assert.doesNotMatch(client, /Choose another flag/);
  assert.match(client, /label=\{`Flag choice \$\{index \+ 1\}`\}/);
  assert.doesNotMatch(client, /label=\{`Flag of \$\{selectedFlag\.name\}`\}/);
  assert.match(client, /freeRemainingCodes: questions\.map/);
  assert.match(client, /recordAnswer\("flags", flagCode, isCorrect\)/);
  assert.match(client, /eliminationAnswerOrder\.filter\(\(item\) => !usedCodes\.has\(item\.code\)\)/);
  assert.match(client, /unused \$\{countryFirst \? "flags" : "countries"\} remain/);
  assert.match(client, /MapQuestionCard/);
  assert.match(client, /map: \{\}/);
  assert.match(mapClient, /Find <em>\{country\.name\}<\/em> on the map/);
  assert.match(mapClient, /Find this flag’s country on the map/);
  assert.match(mapClient, /alt="Flag to locate"/);
  assert.doesNotMatch(mapClient, /alt=\{`Flag of \$\{country\.name\}`\}/);
  assert.match(mapClient, /\/data\/world-map\.json/);
  assert.match(mapClient, /Scroll or use the controls to zoom, then drag to pan/);
  assert.match(mapClient, /Focus \$\{region\}/);
  assert.match(mapClient, /map-country \$\{active \? "active" : "inactive"\}/);
  assert.match(mapClient, /Map elimination/);
  assert.match(mapClient, /!eliminatedSet\.has\(item\.code\)/);
  assert.match(mapClient, /Remaining countries/);
  assert.match(mapClient, /onPointerMove/);
  assert.match(mapClient, /onWheel/);
  assert.ok(mapClient.indexOf("setPointerCapture") > mapClient.indexOf("onPointerMove"), "pointer capture must start only after a drag, not on an ordinary country click");
  assert.match(client, /prompt=\{quiz\.questions\[quiz\.index\]\.direction === "country-to-answer" \? "country" : "flag"\}/);
  assert.match(client, /Prompts alternate between country names and flags/);
  const map = JSON.parse(mapData);
  const countryCodes = new Set([...countriesSource.matchAll(/code: "([A-Z]{2})"/g)].map((match) => match[1]));
  assert.equal(map.features.length, 197);
  assert.deepEqual(new Set(map.features.map((feature) => feature.properties.code)), countryCodes);
  assert.match(route, /getChatGPTUser/);
  assert.match(route, /Authentication required/);
  assert.match(route, /"flags", "capitals", "map"/);
  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(migration, /CREATE TABLE `country_progress`/);
  assert.match(migration, /PRIMARY KEY\(`user_email`, `topic`, `country_code`\)/);
});
