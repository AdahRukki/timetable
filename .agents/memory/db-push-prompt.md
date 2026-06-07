---
name: db:push interactive prompt
description: Why npm run db:push hangs in this repl and how to apply additive schema changes.
---

`npm run db:push` (drizzle-kit push, even with `--force`) stops on an interactive prompt:
"add users_google_id_unique unique constraint ... truncate users table?". Piping newlines to
stdin does NOT advance the arrow-key menu, so the push never applies.

**Why:** That unique constraint is unrelated pre-existing drift; the prompt blocks ALL pending
statements including unrelated additive columns.

**How to apply:** For purely additive changes, run the equivalent `ALTER TABLE ... ADD COLUMN
IF NOT EXISTS ...` directly via `psql "$DATABASE_URL"`, matching the Drizzle column type/default
exactly (e.g. `integer NOT NULL DEFAULT 0`). Then verify via information_schema.columns.
