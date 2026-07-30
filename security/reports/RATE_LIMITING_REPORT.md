# Rate Limiting & DoS Protection Audit Report

**Status:** HIGH FINDINGS  
**Date:** 2025-07-28

---

## Critical

### 1. No Rate Limiting on Authentication Endpoints (CRITICAL)

**File:** `packages/core/src/server/api.ts:194-213`

```typescript
if (a === "auth") {
  if (b === "login" && method === "POST") {
    const body = (await req.json().catch(() => ({}))) as AnyRec;
    const user = await checkLogin(schema, String(body.userId || ""), String(body.password || ""));
    if (!user) return err(401, "Wrong password");
    return json({ user }, 200, { "Set-Cookie": sessionCookie(makeSessionToken(user)) });
  }
  // ... logout, me, password change
}
```

**Vulnerability:** 
- `POST /api/data/auth/login` — **unlimited attempts** per IP/user
- `POST /api/data/auth/password` — unlimited password changes
- `GET /api/data/auth/me` — unlimited session checks

**Attack Vectors:**
- Credential stuffing (known users: `afsar`, `ajju`)
- Brute force on weak passwords (`afsar786`, `ajju123`)
- Account enumeration via timing (401 vs 404 — but both return 401 currently)
- Session validation spam

**Impact:** Full account takeover via brute force.

---

### 2. No Rate Limiting on Write Endpoints (HIGH)

**File:** `packages/core/src/server/api.ts:260-280`

```typescript
if (a === "rec") {
  const table = STORE_TABLE[b];
  // ...
  if (method === "PUT") {
    const data = (await req.json().catch(() => null)) as AnyRec | null;
    if (!data || typeof data !== "object") return err(400, "Bad record");
    const row = await (await import("./db")).upsertRow(schema, table, id, data);
    return json({ data: row.data, updatedAt: row.updated_at });
  }
  // DELETE, GET also unlimited
}
```

**Vulnerability:** Unlimited `PUT/DELETE` on all stores (customers, quotations, expenses, stock, workers, attendance, sessions, ledgers, vouchers, collections, payHolders).

**Attack Vectors:**
- Data destruction (soft-delete all records)
- Data injection (millions of fake records → storage bloat, DoS)
- Expense fraud (fake receipts/salaries)
- Quotation spam

---

### 3. No Rate Limiting on RPC Endpoints (HIGH)

**File:** `packages/core/src/server/api.ts:289-308`

```typescript
if (a === "rpc" && method === "POST") {
  if (b === "create-doc") {
    const data = body.data as AnyRec;
    const doc = await createDocAtomic(schema, data);
    return json({ data: doc });
  }
  if (b === "next-voucher-no") { ... }
  if (b === "next-invoice-number") { ... }
}
```

**Vulnerability:** 
- `create-doc` — unlimited quotation/invoice creation
- `next-invoice-number` — sequence exhaustion (gaps in numbering)
- `next-voucher-no` — ledger sequence abuse

---

### 4. `/bootstrap` Returns Entire Dataset Unlimited (HIGH)

**File:** `packages/core/src/server/api.ts:220-232`

```typescript
if (a === "bootstrap" && method === "GET") {
  const out: AnyRec = {};
  for (const table of SYNC_TABLES) {
    const rows = await listRows(schema, table);
    // ... no pagination, no limit
  }
  return json({ user, stores: out, meta, now: nowRow[0].now });
}
```

**Vulnerability:** Single request returns **all data** (117 quotations, 218 expenses, 56 customers, 72 attendance, etc.). No pagination, no compression hint, no conditional request support (ETag/If-None-Match).

**Impact:**
- Bandwidth DoS (repeated bootstrap requests)
- Data exfiltration (one request = full database dump)
- Mobile clients on slow connections crash/timeout

---

### 5. `/changes` Polling Unlimited (MEDIUM-HIGH)

**File:** `packages/core/src/server/api.ts:235-257`

```typescript
if (a === "changes" && method === "GET") {
  const since = req.nextUrl.searchParams.get("since") || "1970-01-01";
  // ... loops all SYNC_TABLES, no limit on results
}
```

**Vulnerability:** Polling endpoint called frequently by clients. No rate limit, no max results.

---

## High

### 6. No Request Body Size Limits (HIGH)

**Missing:** No `bodyParser` size limit in `next.config.ts`. Next.js default is 1MB for API routes, but:
- JSON parsing happens in `api.ts` via `req.json()`
- Large payloads (10MB+) can OOM the serverless function
- `PUT /rec/:store/:id` accepts arbitrary JSONB

**Fix:** Add to both `next.config.ts`:
```typescript
export default {
  api: {
    bodyParser: { sizeLimit: '512kb' },
  },
};
```

---

### 7. No Concurrency Control on Advisory Locks (MEDIUM)

**File:** `packages/core/src/server/db.ts:146-165`

```typescript
export async function withAdvisoryLock<T>(
  schema: AppSchema,
  key: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [schema + ":" + key]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
```

**Vulnerability:** 
- No timeout on lock acquisition
- No max waiters
- Malicious caller could hold lock indefinitely (long-running transaction)
- Blocks all other numbering operations (quotations, invoices, vouchers)

**Fix:** Add `SET LOCAL lock_timeout = '5s';` after BEGIN.

---

## Medium

### 8. `/all-transactions` Endpoint No Pagination Enforcement (MEDIUM)

**File:** `packages/core/src/server/api.ts:312-507`

```typescript
const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "500", 10), 2000);
const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);
```

**Vulnerability:** 
- `limit` capped at 2000 but `offset` unbounded
- Complex query with multiple subqueries and in-memory sorting
- Could be abused for CPU DoS (large offset + limit)

---

### 9. No AbortSignal Handling for Long Operations (MEDIUM)

**Files:** `packages/core/src/server/api.ts` — no `req.signal` checks in long loops.

**Vulnerability:** Client disconnects but server continues processing (wasted CPU).

---

### 10. Webhook/External Call No Timeout (MEDIUM)

**File:** `packages/core/src/lib/gst-server.ts:62-78`

```typescript
async function lookupAppyflow(gstin: string, key: string): Promise<GstLookup> {
  const url = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { "content-type": "application/json" } });
  // NO TIMEOUT
}
```

**Vulnerability:** External API hang → serverless function timeout (60s) → wasted execution time, potential queue buildup.

**Fix:** Add `AbortSignal.timeout(5000)`.

---

## Low

### 11. No CAPTCHA / Challenge on Login (LOW)

**Status:** No CAPTCHA, no device fingerprinting, no "too many attempts" lockout.

---

### 12. No API Key / Client Identification (LOW)

**Status:** All API calls anonymous (only session cookie). No way to rate limit per-client vs per-IP.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| Critical | 1 | Zero rate limiting on auth |
| High | 4 | Zero rate limiting on writes, RPC, bootstrap, no body size limits |
| Medium | 3 | Advisory lock timeout, all-transactions DoS, external fetch timeout |
| Low | 2 | No CAPTCHA, no client identification |

---

## Remediation Plan

### Phase 1: Critical (Implement Now)

1. **Add rate limiter middleware** — create `packages/core/src/server/rate-limit.ts`
   - Use in-memory Map (Vercel isolates per-instance) + Upstash Redis for cross-instance
   - Limits: login 5/min/IP, writes 30/min/user, bootstrap 2/min/user

2. **Apply to auth endpoints** — wrap `auth/login`, `auth/password`

3. **Add body size limit** in both `next.config.ts`

4. **Add lock timeout** in `withAdvisoryLock`

### Phase 2: High

5. **Rate limit `rec` endpoints** — per-user (from session) + per-IP
6. **Rate limit RPC endpoints** — per-user
7. **Add pagination/limits to `/bootstrap`** — chunked response or require `since` cursor
8. **Add timeout to GST fetch**

### Phase 3: Medium

9. **Add request abort handling** in long loops
10. **Add `all-transactions` query optimization** — cursor-based pagination
11. **Add CAPTCHA** on login after 3 failures (hCaptcha or Turnstile)

### Phase 4: Monitoring

12. **Add rate limit metrics** — log blocked requests
13. **Add alerting** — spike in 429 responses