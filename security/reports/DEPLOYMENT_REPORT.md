# Deployment & Infrastructure Security Audit Report

**Status:** HIGH FINDINGS  
**Date:** 2025-07-28

---

## Critical

### 1. Vercel OIDC Tokens in Repository (CRITICAL)

**Covered in SECRETS_REPORT.md** — Full Vercel project takeover tokens committed to `.env.local` files.

---

## High

### 2. No Security Headers / CSP (HIGH)

**Files:** `apps/unofficial/next.config.ts`, `apps/official/next.config.ts`

**Missing Headers:**
- `Content-Security-Policy` — prevents XSS, data injection
- `X-Frame-Options: DENY` — prevents clickjacking
- `X-Content-Type-Options: nosniff` — prevents MIME sniffing
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — restricts browser features
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

**Impact:** XSS, clickjacking, MIME confusion, data leakage via referrer.

**Fix:** Add `async headers()` to both `next.config.ts`.

---

### 3. Session Cookie Missing `Secure` Flag (HIGH)

**File:** `packages/core/src/server/auth.ts:66-69`

```typescript
export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 86400;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
```

**Vulnerability:** No `Secure` flag. On HTTPS (Vercel), this should be set.

**Fix:**
```typescript
export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 86400;
  const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAge}`;
}
```

---

### 4. No Rate Limiting on Auth Endpoints (HIGH)

**File:** `packages/core/src/server/api.ts:195-212`

**Endpoints without rate limiting:**
- `POST /api/data/auth/login` — brute forceable
- `POST /api/data/auth/password` — change password
- `GET /api/data/auth/me` — session validation

**Impact:** Credential stuffing, brute force on known usernames (`afsar`, `ajju`).

**Fix:** Add rate limiting middleware (5 req/min per IP for login).

---

### 5. Master Password Backdoor (HIGH)

**File:** `packages/core/src/server/auth.ts:109-125`

**Covered in SECRETS_REPORT.md** — `APP_MASTER_PASSWORD` works for all users.

---

### 6. `DATABASE_URL` TLS Verification Disabled (HIGH)

**File:** `packages/core/src/server/db.ts:54-59`

```typescript
_pool = new Pool({
  connectionString: url,
  max: 5,
  ssl: { rejectUnauthorized: false },  // <-- DANGEROUS
});
```

**Vulnerability:** MITM on database connection. Supabase pooler cert chain not in Node default store.

**Fix:** Use Supabase's recommended connection string with `sslmode=require` and proper CA, or at minimum pin the certificate.

---

## Medium

### 7. No `vercel.json` for Security Configuration (MEDIUM)

**Missing:** Root `vercel.json` to configure:
- Security headers (fallback if next.config misses)
- Function timeout limits
- Region pinning
- Crons for cleanup jobs

**Current:** Only `.vercel/project.json` exists (project linking).

---

### 8. No Dependency Vulnerability Scanning (MEDIUM)

**Missing from `package.json`:**
- No `npm audit` in CI
- No Dependabot alerts configured
- No Snyk/GitHub Security Advisories integration

**Current deps with known issues (as of 2025-07):**
- `next@16.2.9` — check for CVEs
- `pg@8.22.0` — check for CVEs
- `jspdf@4.2.1`, `html2canvas@1.4.1` — client-side, lower risk

---

### 9. Source Maps May Be Exposed in Production (MEDIUM)

**Next.js default:** Source maps generated but not uploaded to error tracking. If `NEXT_PUBLIC_VERCEL_ANALYTICS_ID` or similar, maps could leak.

**Check:** Vercel dashboard → project → Source Maps → ensure "Upload source maps" is configured only for error tracking (Sentry), not public.

---

### 10. No CORS Configuration (MEDIUM)

**Files:** API routes don't set CORS headers explicitly.

**Current:** Next.js defaults to same-origin. But if API called from different subdomain (e.g., preview deployments), could be issue.

**Fix:** Explicit CORS headers in `next.config.ts` or middleware.

---

### 11. Error Messages Leak Stack Traces (MEDIUM)

**File:** `packages/core/src/server/api.ts:513-522`

```typescript
try {
  const { path } = await params;
  return await handle(req, path || []);
} catch (e) {
  console.error("[data-api]", e);
  return err(500, e instanceof Error ? e.message : "Server error");
}
```

**Vulnerability:** In production, `e.message` may leak internal details (SQL errors, file paths). Should return generic message in prod.

---

## Low

### 12. No Function Timeout Configuration (LOW)

**Missing:** `maxDuration` in `next.config.ts` for API routes. Default 60s (Vercel Hobby) / 300s (Pro). Long-running PDF generation could timeout.

---

### 13. No Health Check / Readiness Endpoint (LOW)

**Missing:** No `/health` or `/ready` endpoint for load balancer / Vercel health checks.

---

### 14. No Structured Logging / Observability (LOW)

**Current:** `console.error("[data-api]", e)` — unstructured, not queryable.

**Fix:** Add structured JSON logging with request ID, user ID, timestamp.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| Critical | 1 | Vercel OIDC tokens in repo |
| High | 5 | No security headers, cookie missing Secure, no rate limiting, master password, TLS verify disabled |
| Medium | 5 | No vercel.json, no dep scanning, source maps, CORS, error leakage |
| Low | 3 | Function timeouts, no health checks, unstructured logging |

---

## Remediation Plan

### Phase 1: Immediate (Critical/High)
1. **Rotate Vercel OIDC tokens** — Vercel dashboard NOW
2. **Delete `.env.local*` files** from working tree
3. **Add security headers** in both `next.config.ts`
4. **Add `Secure` flag** to session cookie
5. **Enable TLS verification** for PostgreSQL (use proper CA)
6. **Remove `APP_MASTER_PASSWORD`** or restrict heavily
7. **Add rate limiting** on auth endpoints

### Phase 2: High/Medium
8. Add `vercel.json` with security config
9. Enable Dependabot / `npm audit` in CI
10. Configure source map uploads only to Sentry
11. Add CORS headers
12. Sanitize production error messages

### Phase 3: Medium/Low
13. Add request size limits
14. Add health check endpoint
15. Add structured logging
16. Configure function timeouts