# Access Control Audit Report

**Status:** HIGH FINDINGS  
**Date:** 2025-07-28

---

## Critical

### 1. No Ownership/Authorization Checks on Data Mutations (CRITICAL)

**Files:**
- `packages/core/src/server/api.ts:260-280` (`/rec/:store/:id` PUT/DELETE)
- `packages/core/src/server/api.ts:291-295` (`/rpc/create-doc`)
- `packages/core/src/server/api.ts:297-306` (`/rpc/next-voucher-no`, `/rpc/next-invoice-number`)

**Vulnerability:** All write endpoints (`PUT /rec/:store/:id`, `DELETE /rec/:store/:id`, `POST /rpc/*`) only check `userFrom(req)` — i.e., "is there a valid session?" — but **do not verify**:
- Which schema (`official` vs `unofficial`) the user belongs to (already bound per-app)
- Whether the user has permission to write to that specific store
- Whether the user owns the record (for updates/deletes)
- Role-based access (owner vs manager)

**Impact:** Any authenticated user (even `manager` role) can:
- Create/delete/modify ANY record in ANY store (customers, quotations, invoices, expenses, sessions, workers, attendance, stock, ledgers, vouchers, collections, payHolders)
- Escalate by creating fake payment records, deleting financial data, modifying stock
- Cross-contaminate data between the two apps (if they somehow share a session cookie domain)

**Evidence from code:**
```typescript
// api.ts:265-269 — PUT /rec/:store/:id
if (method === "PUT") {
  const data = (await req.json().catch(() => null)) as AnyRec | null;
  if (!data || typeof data !== "object") return err(400, "Bad record");
  const row = await (await import("./db")).upsertRow(schema, table, id, data);
  return json({ data: row.data, updatedAt: row.updated_at });
}
```
No ownership check. No role check. Just session validation.

---

### 2. Bootstrap Returns ALL Data to Any Authenticated User (CRITICAL)

**File:** `packages/core/src/server/api.ts:220-232`

```typescript
if (a === "bootstrap" && method === "GET") {
  const out: AnyRec = {};
  for (const table of SYNC_TABLES) {
    const rows = await listRows(schema, table);
    if (table === "documents") {
      Object.assign(out, splitDocs(rows));
    } else {
      out[TABLE_STORE[table]] = rows.map((r) => r.data);
    }
  }
  const meta = await metaGetAll(schema);
  const nowRow = await sql<{ now: string }>("select now()::text as now");
  return json({ user, stores: out, meta, now: nowRow[0].now });
}
```

**Vulnerability:** `/bootstrap` returns **every single record** in the schema to any logged-in user. No filtering by role, no pagination, no ownership scoping.

**Impact:** 
- Manager sees all customers, quotations, invoices, expenses, sessions, workers, attendance, stock, ledgers, vouchers
- Data exfiltration: single request downloads entire business database
- No "need to know" principle

---

### 3. Changes Poll Returns ALL Changes (CRITICAL)

**File:** `packages/core/src/server/api.ts:235-257`

Same issue — `/changes?since=...` returns all mutations across all tables for any authenticated user.

---

## High

### 4. No Role-Based Access Control (RBAC) (HIGH)

**Files:** 
- `packages/core/src/server/auth.ts` — only `owner` | `manager` roles exist
- `packages/core/src/server/api.ts` — no role checks anywhere

**Vulnerability:** Two roles defined (`owner`, `manager`) but **zero enforcement**. Both roles have identical API access.

**Expected Matrix:**
| Store | Owner | Manager |
|-------|-------|---------|
| customers | CRUD | R |
| quotations | CRUD | CRUD |
| invoices | CRUD | R (official only) |
| expenses | CRUD | R (unofficial only) |
| sessions | CRUD | R |
| workers | CRUD | R |
| attendance | CRUD | R |
| stock | CRUD | R |
| ledgers/vouchers | CRUD | R |
| collections | CRUD | R |
| payHolders | CRUD | - |
| meta/settings | RW | - |
| user management | RW | - |

**Current:** Both roles = full CRUD on everything.

---

### 5. IDOR on Document Access (HIGH)

**File:** `packages/core/src/server/api.ts:275-278`

```typescript
if (method === "GET") {
  const row = await getRow(schema, table, id);
  if (!row || row.deleted_at) return err(404, "Not found");
  return json({ data: row.data });
}
```

**Vulnerability:** Any authenticated user can read any document by ID (`/rec/documents/<id>`). No check if the document belongs to a customer they should see.

**Impact:** Manager can enumerate all quotation/invoice IDs and read full details (pricing, customer info, internal notes).

---

### 6. No Schema Isolation Enforcement at API Layer (HIGH)

**Context:** Two apps (`official`, `unofficial`) use separate Postgres schemas. API routes are bound per-app:
- `apps/unofficial/src/app/api/data/[[...path]]/route.ts` → `createDataApi("unofficial")`
- `apps/official/src/app/api/data/[[...path]]/route.ts` → `createDataApi("official")`

**Vulnerability:** If an attacker can make requests to the other app's API endpoint (same domain, different path), they could access the other schema. Cookies are `Path=/` and `SameSite=Lax`, so cross-app requests with cookies **will work** if the user has sessions in both.

**Impact:** Cross-app data access if user has valid session in both.

---

## Medium

### 7. Expense/Receipt Creation Allows Arbitrary `sourceId` (MEDIUM)

**File:** `packages/core/src/server/api.ts` — `PUT /rec/expenses/:id`

**Vulnerability:** Client can set any `sourceId` (e.g., `sourceId: "wkr:admin"` to fake wage payments, or link to arbitrary quotation for fake receipts).

**Impact:** Financial record manipulation, fake payment trails.

---

### 8. Meta Endpoint Allows Arbitrary Key/Value Writes (MEDIUM)

**File:** `packages/core/src/server/api.ts:283-287`

```typescript
if (a === "meta" && b && method === "PUT") {
  const body = (await req.json().catch(() => ({}))) as AnyRec;
  await metaSet(schema, decodeURIComponent(b), body.v);
  return json({ ok: true });
}
```

**Vulnerability:** Any authenticated user can write any key to `meta` table. No validation of keys, no role check.

**Impact:** Settings corruption, feature flag manipulation, potential logic bypasses.

---

### 9. No Audit Logging for Sensitive Operations (MEDIUM)

**Missing:** No audit trail for:
- Login/logout
- Password changes
- Document creation/deletion
- Payment recording
- User management
- Settings changes

**Impact:** No forensic capability after breach; compliance gap.

---

## Low

### 10. Soft Delete Only — No Hard Delete / Purge (LOW)

**File:** `packages/core/src/server/db.ts:118-124`

```typescript
export async function softDeleteRow(schema: AppSchema, table: string, id: string): Promise<void> {
  await q(`update ${tableRef(schema, table)} set deleted_at = now(), updated_at = now() where id = $1`, [id]);
}
```

**Status:** By design — soft delete is intentional for audit/sync. But no admin-only "purge" endpoint exists for GDPR/legal deletion.

---

### 11. No Request Size Limits (LOW)

**Missing:** No body size limits on API routes. Large payloads could DoS the serverless function.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| Critical | 3 | No ownership checks on writes, bootstrap/changes returns all data |
| High | 3 | No RBAC, IDOR on documents, cross-schema cookie leakage |
| Medium | 3 | Arbitrary sourceId, meta writes, no audit log |
| Low | 2 | No purge endpoint, no request size limits |

---

## Remediation Plan

### Phase 1: Critical (Do First)
1. Add ownership/role checks to all `PUT/DELETE /rec/:store/:id`
2. Filter `/bootstrap` and `/changes` by role (managers see subset)
3. Add document-level authorization (user can only read docs for customers they "own" or all if owner)

### Phase 2: High
4. Implement RBAC middleware: `requireRole("owner")`, `requireRole(["owner", "manager"])`
5. Scope document access by customer relationship
6. Separate cookie domains or add schema claim to session token

### Phase 3: Medium
7. Validate `sourceId` format on expense write
8. Restrict `meta` keys to allowlist
9. Add audit logging table + middleware

### Phase 4: Low
10. Add admin purge endpoint (owner only)
11. Add request size limits in `next.config.ts`