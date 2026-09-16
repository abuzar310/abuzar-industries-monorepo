<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Architecture rules — READ BEFORE TOUCHING DATA CODE

This monorepo is **cloud-only**. The Postgres database (Supabase project
`gvqkyprpcdljcvrcgyyn`) is the **single source of truth**. There is NO
IndexedDB, NO localStorage business data, NO client-side sync engine. The old
local-first architecture caused silent data loss and was removed entirely —
never reintroduce any of it.

## Layout

```
packages/core/src/server/   db.ts (pg Pool) · auth.ts (scrypt + cookie) · api.ts (route factory)
packages/core/src/lib/      data.ts (THE client data layer) + domain modules on top of it
packages/core/src/store/    app-store (UI state) · AppProvider (boot + 8s change-poll)
apps/official               Abuzar Industries → Postgres schema `official`   (port 3020)
apps/unofficial             Safa / Cut Size   → Postgres schema `unofficial` (port 3010)
db/cloud-schema.sql         the schema (idempotent; apply with psql)
scripts/migrate-to-cloud.mjs one-time import from the old Supabase project
```

Each app mounts `/api/data/[[...path]]` → `createDataApi("<schema>")`. The
browser NEVER talks to Postgres or Supabase directly; the only secret is
`DATABASE_URL` (server-side env, see `.env.example` + `apps/*/.env.local`).

## Iron rules (these encode fixed bugs — do not "optimize" them away)

1. **All reads/writes go through `lib/data.ts`** (`allRec`/`getRec`/`put`/
   `delRec`/`metaGet`/`metaSet`). It keeps an in-memory cache filled by
   `/bootstrap`, writes through an ordered retrying outbox, and converges all
   devices via `/changes?since=` polling. Never bypass it from components.
2. **Never hard-delete rows.** `DELETE rec/...` soft-deletes (`deleted_at`).
   Documents additionally use in-data `deletedAt` (Recycle bin) / `purgedAt`
   (archive). Rows stay forever so deletes replicate and are recoverable.
3. **Never allocate document numbers on the client.** `rpc/create-doc` and
   `rpc/next-invoice-number` allocate atomically inside a Postgres advisory
   lock. Series are independent and must never mix:
   quotations `"<fy>-NNN"` · sales invoices `"2700"` · purchases `"1,2,3…"` ·
   rented invoices `"R-1, R-2…"` (see `seriesOf`/`seriesNumeric` in
   `lib/invoice-id.ts`). Invoice `id` is a permanent `inv_…` UID; only the
   printed `number` is ever edited.
4. **`updated_at` is set by a DB trigger** (server clock). Don't write it from
   the client and don't compare client clocks for conflict decisions.
5. **The two schemas are isolated.** `official` and `unofficial` never share
   tables, users, counters, or meta. Anything per-app goes in its schema.
6. **Auth is server-side** (`server/auth.ts`): scrypt password hashes in
   `<schema>.users`, HMAC-signed httpOnly cookie. No passwords/tokens in the
   browser. Master password comes from `APP_MASTER_PASSWORD` env only.
7. **Device-local = cosmetic only.** `prefGet`/`prefSet` (localStorage) may
   hold UI preferences (last-open doc, notification watermarks) — never records.
8. **Editor saves are explicit.** Edits mark the doc dirty; the Save button /
   Ctrl+S / any leave-the-doc action persists. Don't bring back
   keystroke-autosave, and don't remove the auto-save-before-print/convert/
   navigate safety nets.
9. Schema changes go into `db/cloud-schema.sql` (keep it idempotent) and are
   applied with psql against `DATABASE_URL`.

## The Excel tab (`apps/unofficial/src/excel`)

Cut Size has an owner-only **Excel** tab at `/excel`: our own spreadsheet, built on
the free Univer core with ExcelJS for `.xlsx` in a Web Worker. It is the one part of
the app that is deliberately device-local — workbooks live in IndexedDB and never
touch the business schemas, `lib/data.ts`, or any table above. The cloud-only rules
govern business data, which this screen never handles. Never put business data in it.

Its code sits outside `packages/core` on purpose, so the official app neither
installs nor bundles the engine, and everything inside it uses **relative imports**
(`@/*` resolves into this app and then core, which the sheet does not use). Never
import `@univerjs-pro/*`: `apps/unofficial/src/excel/license.check.ts` fails the
check chain the moment a paid or licence-infecting package appears, and it also
pins the Univer version so an upgrade is always deliberate.

## Verify after changes

```
pnpm typecheck && pnpm check && pnpm build:unofficial && pnpm build:official
```

Smoke-test the API: login (`POST /api/data/auth/login`), `GET /api/data/bootstrap`,
`rpc/create-doc`, and `GET /api/data/changes?since=…` after a delete.

## Git

Never add AI/Codex attribution or co-author trailers to commits. Only commit
when explicitly asked.
