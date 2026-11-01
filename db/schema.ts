import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ledgerState = sqliteTable("ledger_state", {
  id: integer("id").primaryKey(),
  version: integer("version").notNull().default(0),
  data: text("data").notNull(),
});
