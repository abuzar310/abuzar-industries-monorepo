# Database Security Audit Report

**Status:** HIGH FINDINGS  
**Date:** 2025-07-28

---

## Architecture Overview

**Database:** PostgreSQL on Supabase (via PgBouncer pooler)  
**Connection:** `DATABASE_URL` with `ssl: { rejectUnauthorized: false }`  
**Schemas:** Two isolated schemas — `official` and `unofficial`  
**Tables per Schema:** 12 tables + `meta` + `users`  
**Pattern:** Every table = `id` (PK) + `data` (JSONB) + `created_at` + `updated_at` + `deleted_at` (soft delete)  
**Access:** Only via server API (`packages/core/src/server/api.ts`) — no direct client access

---

## Critical

### 1. TLS Certificate Verification Disabled (CRITICAL)

**File:** `packages/core/src/server/db.ts:54-59`

```typescript
_pool = new Pool({
  connectionString: url,
  max: 5,
  ssl: { rejectUnauthorized: false },  // <-- DANGEROUS
});
```

**Vulnerability:** MITM on database connection. Attacker on network path (Vercel → Supabase) can intercept/modify queries, steal data, inject rows.

**Why it exists:** Supabase pooler uses a certificate not in Node's default CA store.

**Fix:** 
```typescript
// Option 1: Use Supabase CA (recommended)
ssl: {
  rejectUnauthorized: true,
  ca: process.env.SUPABASE_CA_CERT, // base64 encoded CA cert
}

// Option 2: At minimum, pin the certificate fingerprint
ssl: {
  rejectUnauthorized: true,
  checkServerIdentity: (host, cert) => {
    const expectedFingerprint = "SHA256:..."; // from Supabase dashboard
    const fingerprint = cert.fingerprint256.replace(/:/g, "").toUpperCase();
    if (fingerprint !== expectedFingerprint.replace(/:/g, "").toUpperCase()) {
      throw new Error("Certificate fingerprint mismatch");
    }
  },
}
```

---

### 2. No Row-Level Security (RLS) — Relies Entirely on App Layer (CRITICAL)

**Status:** PostgreSQL RLS **not enabled** on any table. All access control in application layer (`api.ts`).

**Risk:** 
- Any bug in `api.ts` → full data exposure
- Direct DB access (Supabase dashboard, psql, compromised server) bypasses all auth
- No defense in depth

**Tables without RLS:** `documents`, `customers`, `suppliers`, `stock`, `expenses`, `sessions`, `ledgers`, `vouchers`, `collections`, `pay_holders`, `workers`, `attendance`, `users`, `meta`

**Fix:** Enable RLS with policies matching app logic:
```sql
-- Example for documents table
ALTER TABLE unofficial.documents ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see documents in their schema (enforced by app)
-- But add: users can only modify their own enteredBy documents
CREATE POLICY "documents_owner_modify" ON unofficial.documents
  FOR UPDATE USING (data->>'enteredBy' = current_setting('app.current_user_id', true))
  WITH CHECK (data->>'enteredBy' = current_setting('app.current_user_id', true));
```

---

## High

### 3. Single Database User for All Operations (HIGH)

**Status:** One `DATABASE_URL` used for all operations (read, write, admin, migrations).

**Risk:** Compromised app = full DB access. No principle of least privilege.

**Fix:** Create separate roles:
```sql
-- Read-only role for reporting/dashboards
CREATE ROLE app_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA unofficial TO app_readonly;

-- Write role for API
CREATE ROLE app_write;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA unofficial TO app_write;

-- Admin role for migrations
CREATE ROLE app_admin;
GRANT ALL ON ALL TABLES IN SCHEMA unofficial TO app_admin;
```

Use different connection strings per role.

---

### 4. Soft Delete Only — No Hard Delete / GDPR Purge (HIGH)

**File:** `packages/core/src/server/db.ts:118-124`

```typescript
export async function softDeleteRow(schema: AppSchema, table: string, id: string): Promise<void> {
  await q(`update ${tableRef(schema, table)} set deleted_at = now(), updated_at = now() where id = $1`, [id]);
}
```

**Vulnerability:** 
- `deleted_at` set but data remains forever
- No admin endpoint to permanently purge (GDPR Art. 17 "right to erasure")
- `bootstrap` and `changes` return soft-deleted rows (with `deleted: true` flag)

**Fix:** Add owner-only `DELETE /rec/:store/:id?purge=true` endpoint that hard-deletes.

---

### 5. `users` Table Stores Scrypt Hashes — No Migration Path (HIGH)

**File:** `packages/core/src/server/auth.ts:29-41`

```typescript
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw.normalize(), salt, 32).toString("hex");
  return `s1:${salt}:${hash}`;
}
```

**Assessment:** scrypt is good (memory-hard). But:
- No versioning beyond `s1:`
- No pepper (additional secret mixed in)
- Default users (`afsar`/`afsar786`, `ajju`/`ajju123`) created on first boot — **default credentials**

**Fix:** 
1. Force password change on first login
2. Add pepper from `APP_PASSWORD_PEPPER` env var
3. Support algorithm upgrade (argon2id)

---

## Medium

### 6. JSONB Columns — No Schema Validation (MEDIUM)

**Pattern:** All business data in `data JSONB` column. No constraints, no triggers.

**Risks:**
- Inconsistent data shapes (client bugs = corrupt data)
- No referential integrity (e.g., `customerId` in quotation may not exist)
- Query performance degrades without indexes on JSONB paths

**Fix:** 
- Add `CHECK` constraints for critical fields
- Add JSONB path indexes: `CREATE INDEX ON unofficial.documents ((data->>'customerId'))`
- Consider generated columns for frequently queried fields

---

### 7. No Audit Log Table (MEDIUM)

**Status:** No `audit_log` table. Financial changes (payments, expenses, invoices) not traceable to who/when/what.

**Fix:** Add `audit_log` table + trigger or middleware:
```sql
CREATE TABLE unofficial.audit_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ DEFAULT now(),
  user_id TEXT,
  action TEXT, -- 'INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'PASSWORD_CHANGE'
  table_name TEXT,
  record_id TEXT,
  old_data JSONB,
  new_data JSONB,
  ip INET,
  ua TEXT
);
```

---

### 8. Advisory Locks for Numbering — No Monitoring (MEDIUM)

**File:** `packages/core/src/server/db.ts:146-165`

```typescript
await client.query("select pg_advisory_xact_lock(hashtext($1))", [schema + ":" + key]);
```

**Risk:** Long-held locks block all numbering (quotations, invoices, vouchers). No visibility.

**Fix:** Add `lock_timeout` and log slow locks:
```sql
SET LOCAL lock_timeout = '5s';
```
Log lock acquisition > 1s.

---

### 9. Counter Table for Invoice Numbering — No Gap Protection (MEDIUM)

**File:** `packages/core/src/server/api.ts:94-113` (`takenInSeries`)

**Logic:** Scans all live invoices to find "next free number" per series. Reuses gaps.

**Risk:** 
- Race condition if two invoices created simultaneously (advisory lock prevents)
- But: deleted invoices leave gaps that get reused — audit trail confusion
- No "voided" status — soft-deleted invoices still count in gap detection

**Fix:** Use `SEQUENCE` per series + separate display number mapping.

---

### 10. Pool Size = 5 — May Exhaust Under Load (MEDIUM)

**File:** `packages/core/src/server/db.ts:54-59`

```typescript
max: 5,
```

**Risk:** Vercel serverless functions scale horizontally. Each instance gets 5 connections. At scale, hits Supabase connection limit.

**Fix:** Use Supabase's recommended pooler settings. Consider `max: 3` + PgBouncer transaction mode.

---

## Low

### 11. No Connection Retry / Circuit Breaker (LOW)

**File:** `packages/core/src/server/db.ts:79-82`

```typescript
export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool().query(text, params);
  return r.rows as T[];
}
```

**Risk:** Transient network errors bubble up as 500. No automatic retry.

**Fix:** Add retry wrapper with exponential backoff for transient errors (PgBouncer disconnects, etc.).

---

### 12. No Query Timeout (LOW)

**Risk:** Runaway query (bad plan, missing index) hangs function until timeout (60s Vercel default).

**Fix:** `SET statement_timeout = '5s';` per transaction or in pool config.

---

### 13. `meta` Table — Unstructured Key-Value (LOW)

**File:** `packages/core/src/server/db.ts:126-139`

```typescript
export async function metaSet(schema: AppSchema, k: string, v: unknown): Promise<void> {
  await q(`insert into ${tableRef(schema, "meta")} (k, v) values ($1, $2::jsonb) ...`, [k, JSON.stringify(v ?? null)]);
}
```

**Risk:** Any key allowed. Could grow unbounded. No TTL.

**Fix:** Allowlist keys, add `expires_at` column.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| Critical | 2 | TLS verify disabled, no RLS |
| High | 3 | Single DB user, soft delete only, default passwords |
| Medium | 5 | No JSONB validation, no audit log, lock monitoring, gap reuse, pool size |
| Low | 3 | No retry, no query timeout, unstructured meta |

---

## Remediation Plan

### Phase 1: Critical (This Week)

1. **Enable TLS verification** — get Supabase CA cert, configure pool
2. **Enable RLS** on all tables with basic policies
3. **Create separate DB roles** (readonly, write, admin)

### Phase 2: High

4. **Add hard delete endpoint** (owner only)
5. **Force password change** on first login, add pepper
6. **Remove default credentials** — require setup flow

### Phase 3: Medium

7. **Add JSONB constraints + indexes**
8. **Add audit_log table + trigger**
9. **Add lock_timeout + monitoring**
10. **Fix invoice numbering** (sequences)
11. **Tune pool size** for serverless

### Phase 4: Operational

12. **Add query timeout**
13. **Add retry logic**
14. **Structure meta table**