import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db";

type Topic = "flags" | "capitals";

type StoredRow = {
  topic: Topic;
  country_code: string;
  attempts: number;
  correct: number;
  streak: number;
  mastered: number;
};

type ProgressRecord = {
  attempts: number;
  correct: number;
  streak: number;
  mastered: boolean;
};

const topics: Topic[] = ["flags", "capitals"];

function isTopic(value: unknown): value is Topic {
  return value === "flags" || value === "capitals";
}

function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

function asCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : null;
}

function parseRecord(value: unknown): ProgressRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const attempts = asCount(raw.attempts);
  const correct = asCount(raw.correct);
  const streak = asCount(raw.streak);
  if (attempts === null || correct === null || streak === null || correct > attempts || streak > attempts) return null;
  if (typeof raw.mastered !== "boolean") return null;
  return { attempts, correct, streak, mastered: raw.mastered };
}

function rowToRecord(row: StoredRow): ProgressRecord {
  return {
    attempts: row.attempts,
    correct: row.correct,
    streak: row.streak,
    mastered: Boolean(row.mastered),
  };
}

async function authenticatedEmail() {
  const user = await getChatGPTUser();
  return user ? { user, email: user.email.trim().toLocaleLowerCase() } : null;
}

export async function GET() {
  const auth = await authenticatedEmail();
  if (!auth) return Response.json({ error: "Authentication required" }, { status: 401 });

  const result = await getD1()
    .prepare(
      `SELECT topic, country_code, attempts, correct, streak, mastered
       FROM country_progress
       WHERE user_email = ?
       ORDER BY topic, country_code`,
    )
    .bind(auth.email)
    .all<StoredRow>();

  const progress: Record<Topic, Record<string, ProgressRecord>> = { flags: {}, capitals: {} };
  for (const row of result.results) {
    if (isTopic(row.topic) && isCountryCode(row.country_code)) {
      progress[row.topic][row.country_code] = rowToRecord(row);
    }
  }

  return Response.json({ progress, user: { displayName: auth.user.displayName } });
}

export async function PUT(request: Request) {
  const auth = await authenticatedEmail();
  if (!auth) return Response.json({ error: "Authentication required" }, { status: 401 });

  const payload = (await request.json()) as { progress?: unknown };
  if (!payload.progress || typeof payload.progress !== "object") {
    return Response.json({ error: "Valid progress is required" }, { status: 400 });
  }

  const rawProgress = payload.progress as Record<string, unknown>;
  const statements: D1PreparedStatement[] = [];
  const db = getD1();
  const upsert = `INSERT INTO country_progress
    (user_email, topic, country_code, attempts, correct, streak, mastered, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_email, topic, country_code) DO UPDATE SET
      attempts = MAX(country_progress.attempts, excluded.attempts),
      correct = MAX(country_progress.correct, excluded.correct),
      streak = MAX(country_progress.streak, excluded.streak),
      mastered = MAX(country_progress.mastered, excluded.mastered),
      updated_at = CURRENT_TIMESTAMP`;

  for (const topic of topics) {
    const topicProgress = rawProgress[topic];
    if (!topicProgress || typeof topicProgress !== "object") continue;
    for (const [countryCode, value] of Object.entries(topicProgress as Record<string, unknown>)) {
      if (!isCountryCode(countryCode)) continue;
      const record = parseRecord(value);
      if (!record) continue;
      statements.push(
        db.prepare(upsert).bind(
          auth.email,
          topic,
          countryCode,
          record.attempts,
          record.correct,
          record.streak,
          record.mastered ? 1 : 0,
        ),
      );
    }
  }

  if (statements.length > 0) await db.batch(statements);
  return Response.json({ saved: statements.length });
}

export async function POST(request: Request) {
  const auth = await authenticatedEmail();
  if (!auth) return Response.json({ error: "Authentication required" }, { status: 401 });

  const payload = (await request.json()) as { topic?: unknown; countryCode?: unknown; correct?: unknown };
  if (!isTopic(payload.topic) || !isCountryCode(payload.countryCode) || typeof payload.correct !== "boolean") {
    return Response.json({ error: "A valid answer is required" }, { status: 400 });
  }

  const correctValue = payload.correct ? 1 : 0;
  const db = getD1();
  await db
    .prepare(
      `INSERT INTO country_progress
        (user_email, topic, country_code, attempts, correct, streak, mastered, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, 0, CURRENT_TIMESTAMP)
       ON CONFLICT(user_email, topic, country_code) DO UPDATE SET
         attempts = country_progress.attempts + 1,
         correct = country_progress.correct + excluded.correct,
         streak = CASE WHEN ? = 1 THEN country_progress.streak + 1 ELSE 0 END,
         mastered = CASE
           WHEN country_progress.mastered = 1 OR (? = 1 AND country_progress.streak + 1 >= 3) THEN 1
           ELSE 0
         END,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(auth.email, payload.topic, payload.countryCode, correctValue, correctValue, correctValue, correctValue)
    .run();

  const row = await db
    .prepare(
      `SELECT topic, country_code, attempts, correct, streak, mastered
       FROM country_progress
       WHERE user_email = ? AND topic = ? AND country_code = ?`,
    )
    .bind(auth.email, payload.topic, payload.countryCode)
    .first<StoredRow>();

  return Response.json({ record: row ? rowToRecord(row) : null });
}

export async function DELETE(request: Request) {
  const auth = await authenticatedEmail();
  if (!auth) return Response.json({ error: "Authentication required" }, { status: 401 });

  const topic = new URL(request.url).searchParams.get("topic");
  if (!isTopic(topic)) return Response.json({ error: "A valid topic is required" }, { status: 400 });

  await getD1()
    .prepare("DELETE FROM country_progress WHERE user_email = ? AND topic = ?")
    .bind(auth.email, topic)
    .run();

  return Response.json({ deleted: true });
}
