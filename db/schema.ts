import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const countryProgress = sqliteTable(
  "country_progress",
  {
    userEmail: text("user_email").notNull(),
    topic: text("topic", { enum: ["flags", "capitals"] }).notNull(),
    countryCode: text("country_code").notNull(),
    attempts: integer("attempts").notNull().default(0),
    correct: integer("correct").notNull().default(0),
    streak: integer("streak").notNull().default(0),
    mastered: integer("mastered", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.userEmail, table.topic, table.countryCode] })],
);
