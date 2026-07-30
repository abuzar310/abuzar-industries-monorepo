# Injection & Input Validation Audit Report

**Status:** MEDIUM-HIGH FINDINGS  
**Date:** 2025-07-28

---

## SQL Injection

### 1. Parameterized Queries Used Correctly (GOOD)

**Files:** `packages/core/src/server/db.ts`, `packages/core/src/server/api.ts`

All database queries use parameterized queries (`$1`, `$2`):

```typescript
// db.ts:79-82
export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool().query(text, params);
  return r.rows as T[];
}

// Usage examples:
await q(`select * from ${tableRef(schema, table)} where id = $1`, [id]);
await q(`insert into ${tableRef(schema, table)} (id, data) values ($1, $2::jsonb)`, [id, JSON.stringify(data)]);
```

**Assessment:** No direct string concatenation of user input into SQL. Safe from classic SQLi.

---

### 2. Table/Schema Names Interpolated but Validated (GOOD)

**File:** `packages/core/src/server/db.ts:71-77`

```typescript
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("bad identifier: " + s);
  return s;
};

export const tableRef = (schema: AppSchema, table: string) =>
  `${ident(schema)}.${ident(table)}`;
```

**Assessment:** Schema (`official`|`unofficial`) and table names validated against regex. Safe.

---

### 3. JSONB Queries Use Parameter Binding (GOOD)

**File:** `packages/core/src/server/api.ts` various

```typescript
const rows = await client.query(
  `select * from ${t} where data->>'kind' = 'quotation'`,
  // no user input in WHERE
);
```

User data stays in JSONB `data` column, queried via `->>` operator with static values.

---

## NoSQL / Operator Injection

### 4. No MongoDB/Firebase — N/A

App uses PostgreSQL only.

---

## XSS (Cross-Site Scripting)

### 5. React Auto-Escapes by Default (GOOD)

**Framework:** Next.js 16 + React 19 — all `{variable}` in JSX are auto-escaped.

**Check:** No `dangerouslySetInnerHTML` found in `apps/**/*.tsx` or `packages/core/src/**/*.tsx`.

---

### 6. User Data Rendered in PDF/Print — Sanitized via html2canvas (MEDIUM)

**File:** `packages/core/src/lib/pdf.ts:66-94`

```typescript
const clone = sheet.cloneNode(true) as HTMLElement;
// Removes editing controls:
clone.querySelectorAll(".no-print,.doctool,.add-row,...").forEach((el) => el.remove());
// Freezes inputs to text:
clone.querySelectorAll("input").forEach((inp) => freeze(inp, inp.value));
clone.querySelectorAll("select").forEach((sel) => freeze(sel, sel.options[sel.selectedIndex]?.text || ""));
```

**Assessment:** 
- PDF generation uses `html2canvas` on a **cloned DOM** with editing controls removed
- Input values frozen as text nodes (not rendered as HTML)
- No user-controlled HTML injected into PDF canvas

**Risk:** If user data contains `<script>` tags, they become text in the canvas, not executed. Safe.

---

### 7. WhatsApp Message Building — Text Only (GOOD)

**File:** `packages/core/src/lib/whatsapp.ts`

```typescript
export function quoteMessage(doc: Doc): string {
  // Template literals with user data interpolated as plain text
  return `Hello ${doc.customerName},\nYour quotation ${doc.number}...\n`;
}
```

**Assessment:** Plain text messages, no HTML. WhatsApp renders as text. Safe.

---

### 8. GSTIN Lookup Result Rendered — Trusted Provider (LOW)

**File:** `packages/core/src/lib/gst-server.ts:88-112`

```typescript
const info = normaliseAppyflow(gstin, tp);
return json({ ok: true, info });
```

Client receives `GstInfo` and renders in React components (auto-escaped). Provider is Appyflow (trusted). Safe.

---

## Path Traversal

### 9. No File Upload / Path Operations (GOOD)

**Assessment:** No file upload endpoints, no `fs` operations with user input, no `path.join` with user data.

---

## Command Injection

### 10. No `child_process`, `exec`, `spawn` (GOOD)

**Check:** Grep for `child_process`, `exec`, `spawn`, `system` — none found.

---

## LDAP / Header Injection

### 11. No LDAP / Header Construction from User Input (GOOD)

**Assessment:** No LDAP. Session cookie built from server-controlled data only.

---

## Prototype Pollution

### 12. JSON Parsing — No Deep Merge (GOOD)

**Files:** `packages/core/src/lib/data.ts:48-54`

```typescript
async function call<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, {
    ...
    headers: { "Content-Type": "application/json", ... },
  });
  return (await r.json()) as T;
}
```

**Assessment:** `JSON.parse` (via `r.json()`) returns plain objects. No `Object.assign`, `_.merge`, `lodash.merge` with user input found.

---

## Regular Expression DoS (ReDoS)

### 13. GSTIN Regex — Fixed Pattern, No Backtracking Risk (GOOD)

**File:** `packages/core/src/lib/gst.ts:59`

```typescript
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
```

**Assessment:** Fixed-length, no quantifiers on groups. No ReDoS.

---

### 14. `fyLabel()` — Simple String Manipulation (GOOD)

**File:** `packages/core/src/lib/numbering.ts`

```typescript
export function fyLabel(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const fy = m >= 3 ? `${String(y).slice(-2)}${String(y + 1).slice(-2)}` : `${String(y - 1).slice(-2)}${String(y).slice(-2)}`;
  return fy;
}
```

Safe.

---

## Mass Assignment / Overposting

### 15. `PUT /rec/:store/:id` Accepts Full Record (HIGH)

**File:** `packages/core/src/server/api.ts:265-269`

```typescript
if (method === "PUT") {
  const data = (await req.json().catch(() => null)) as AnyRec | null;
  if (!data || typeof data !== "object") return err(400, "Bad record");
  const row = await (await import("./db")).upsertRow(schema, table, id, data);
  return json({ data: row.data, updatedAt: row.updated_at });
}
```

**Vulnerability:** Client sends **entire record** including fields they shouldn't modify:
- `id` (can't change — used in WHERE)
- `created_at` (could overwrite)
- `deleted_at` (could undelete)
- Role-sensitive fields (e.g., `amountPaid`, `paymentStatus`, `finalPrice` on quotations)
- `enteredBy` (could spoof author)

**Impact:** 
- Manager could set `finalPrice: 0` on own quotations
- Could set `paymentStatus: "paid"` without payment
- Could modify `created_at` to backdate
- Could undelete soft-deleted records

**Fix:** Allow-list fields per store per role.

---

### 16. `POST /rpc/create-doc` Accepts Arbitrary Document Data (HIGH)

**File:** `packages/core/src/server/api.ts:291-295`

```typescript
if (b === "create-doc") {
  const data = body.data as AnyRec;
  if (!data || typeof data !== "object") return err(400, "Bad document");
  const doc = await createDocAtomic(schema, data);
  return json({ data: doc });
}
```

**Vulnerability:** Client provides full document including:
- `id` (ignored — generated server-side, good)
- `number` (used for invoices — client can set display number)
- `kind` (quotation/invoice — client chooses)
- `customerId`, `customerName` (any customer)
- `amountPaid`, `paymentStatus`, `finalPrice` (financial fields)
- `sections` (line items with arbitrary rates/quantities)

**Impact:** Create fake quotations/invoices with arbitrary prices, fake customers, backdated dates.

**Fix:** Validate and sanitize on server. Only allow safe fields from client; compute financials server-side.

---

### 17. Expense Creation — Client Controls `type`, `mode`, `account`, `sourceId` (MEDIUM)

**File:** `packages/core/src/server/api.ts:265-269` (via `PUT /rec/expenses/:id`)

Client can set:
- `type: "sale"` + `custId` → creates receipt (financial impact)
- `type: "salary"` → payroll record
- `mode: "upi"` + `account: "Attacker UPI"` → fake UPI trail
- `sourceId: "wkr:admin"` → fake wage payment

**Fix:** Server-side validation of expense types per role. Receipts only via payment flow.

---

## CSV / Formula Injection

### 18. No CSV Export Found (GOOD)

**Check:** No CSV export functionality in codebase.

---

## JSON/Parser Attacks

### 19. `JSON.parse` on Server Response Only (GOOD)

No `eval`, `Function`, `new Function` with user input.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| High | 3 | Mass assignment on `PUT /rec`, `POST /rpc/create-doc`, expense type spoofing |
| Medium | 1 | PDF generation (mitigated by html2canvas) |
| Low | 0 | — |
| Good | 9 | SQLi, XSS, Path traversal, Command injection, Prototype pollution, ReDoS, CSV, JSON, LDAP |

---

## Remediation Plan

### Phase 1: High (Implement Now)

1. **Allow-list fields on `PUT /rec/:store/:id`** — create `ALLOWED_FIELDS` map per store per role
2. **Validate `create-doc` input** — server-side schema validation (Zod or manual)
3. **Validate expense types** — reject `sale`/`salary` from non-payment flows

### Phase 2: Defense in Depth

4. **Add Zod schemas** for all API inputs
5. **Add audit logging** for financial field changes
6. **Content Security Policy** header (see Deployment report)