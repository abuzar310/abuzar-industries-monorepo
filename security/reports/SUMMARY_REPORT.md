# Full Security Audit Summary — Abuzar Industries Monorepo

**Audit Date:** 2025-07-28  
**Scope:** `apps/official`, `apps/unofficial`, `packages/core`  
**Deployments:** `safa-unofficial.vercel.app`, `abuzar-official.vercel.app`  
**Methodology:** vibe-sec skill (static analysis, config review, secret scanning)

---

## Executive Summary

**Overall Risk: CRITICAL**

The codebase has **solid architectural foundations** (parameterized SQL, React auto-escaping, server-only DB access, scrypt passwords, httpOnly cookies) but **critical operational security failures** that allow immediate compromise:

1. **Vercel OIDC tokens committed** — full project takeover possible
2. **No rate limiting** — brute force on known usernames (`afsar`, `ajju`)
3. **No authorization checks** — any authenticated user = full CRUD on all data
4. **TLS verification disabled** on database — MITM possible
5. **Master password backdoor** — single secret = all accounts

**Positive findings:** No SQL injection, no XSS in React code, no path traversal, no command injection, secrets not in client bundle.

---

## Findings by Category

### 🔴 CRITICAL (5)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | Vercel OIDC tokens in `.env.local` files | `apps/*/.env.local*`, `.env.local` | Full Vercel project takeover → deploy malware, read all secrets, destroy data |
| 2 | Zero authorization on write endpoints | `api.ts:260-310` | Any logged-in user (manager) can delete/modify all data across both apps |
| 3 | No rate limiting on auth | `api.ts:195-212` | Brute force `afsar`/`afsar786`, `ajju`/`ajju123` |
| 4 | Database TLS verification disabled | `db.ts:58` | MITM on DB connection → data theft/injection |
| 5 | Master password works for all users | `auth.ts:122` | Single env var = full admin access to both apps |

---

### 🟠 HIGH (12)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 6 | Session cookie missing `Secure` flag | `auth.ts:68` | Cookie sent over HTTP if HSTS fails |
| 7 | No security headers / CSP | `next.config.ts` | XSS, clickjacking, MIME sniffing |
| 8 | `/bootstrap` returns ALL data to any user | `api.ts:220-232` | Single request = full database dump |
| 9 | `/changes` returns ALL mutations | `api.ts:235-257` | Real-time data exfiltration |
| 10 | Mass assignment on `PUT /rec` | `api.ts:265-269` | Modify `finalPrice`, `paymentStatus`, `deleted_at` |
| 11 | `create-doc` RPC accepts arbitrary financial data | `api.ts:291-295` | Create fake invoices with arbitrary prices |
| 12 | Expense type spoofing (`sale`/`salary`) | `api.ts:265-269` | Fake receipts, payroll records |
| 13 | Single DB user for all operations | `db.ts` | Compromise = full DB access |
| 14 | Soft delete only — no GDPR purge | `db.ts:118-124` | Data never truly deleted |
| 15 | Default credentials (`afsar`/`afsar786`) | `auth.ts:81-82` | Known working credentials |
| 16 | No request body size limits | `next.config.ts` | DoS via large payloads |
| 17 | Cross-app session cookie sharing | `auth.ts:68` | Cookie `Path=/` + `SameSite=Lax` = works across both apps |

---

### 🟡 MEDIUM (10)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 18 | `APP_SESSION_SECRET` has insecure fallback | `auth.ts:15-21` | Predictable secret if env not set |
| 19 | No audit logging for financial changes | — | No forensic trail |
| 20 | Advisory locks have no timeout | `db.ts:155` | Numbering blocked indefinitely |
| 21 | GST API fetch has no timeout | `gst-server.ts:62` | Hang → function timeout |
| 22 | No JSONB schema validation | All tables | Data corruption, query perf |
| 23 | Invoice numbering reuses gaps | `api.ts:94-113` | Audit confusion |
| 24 | Pool size may exhaust Supabase limits | `db.ts:56` | Connection errors at scale |
| 25 | Legacy HTML files with `innerHTML` | `public/legacy.html` | XSS if served |
| 26 | PDF generation clones DOM with scripts | `pdf.ts:72` | Theoretical XSS during PDF render |
| 27 | No dependency vulnerability scanning | `package.json` | Unknown CVEs in deps |

---

### 🟢 LOW (5)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 28 | No health check endpoint | — | LB can't detect unhealthy |
| 29 | No structured logging | `api.ts:519` | Hard to debug/alert |
| 30 | `meta` table unstructured | `db.ts:126-139` | Unbounded growth |
| 31 | No CAPTCHA on login | — | Automated attacks easier |
| 32 | No query timeout | `db.ts` | Runaway queries |

---

## Reports Generated

| Report | Path | Focus |
|--------|------|-------|
| `SECRETS_REPORT.md` | `security/reports/SECRETS_REPORT.md` | Env files, tokens, secrets management |
| `ACCESS_CONTROL_REPORT.md` | `security/reports/ACCESS_CONTROL_REPORT.md` | AuthZ, IDOR, RBAC, ownership |
| `INJECTION_REPORT.md` | `security/reports/INJECTION_REPORT.md` | SQLi, XSS, mass assignment, prototype pollution |
| `RATE_LIMITING_REPORT.md` | `security/reports/RATE_LIMITING_REPORT.md` | Auth brute force, API abuse, DoS |
| `DATABASE_REPORT.md` | `security/reports/DATABASE_REPORT.md` | RLS, TLS, roles, audit, soft delete |

---

## Immediate Action Plan (Do Today)

### 1. Rotate Vercel OIDC Tokens (5 min)
- Vercel Dashboard → Settings → Tokens → **Revoke all** → Create new
- Delete all `.env.local*` files from working tree
- Add to `.gitignore` (already there but files tracked)

### 2. Set `APP_SESSION_SECRET` in Vercel (2 min)
```bash
# Generate:
openssl rand -hex 32
# Add to BOTH Vercel projects: safa-unofficial, abuzar-official
```

### 3. Remove `APP_MASTER_PASSWORD` or Restrict (5 min)
- Delete from Vercel env vars OR set to 64-char random string
- Add IP allowlist check if kept

### 4. Add Rate Limiting to Login (30 min)
Create `packages/core/src/server/rate-limit.ts`:
```typescript
const loginAttempts = new Map<string, { count: number; reset: number }>();

export function rateLimitLogin(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, reset: now + 60000 };
  if (now > record.reset) { record.count = 0; record.reset = now + 60000; }
  record.count++;
  loginAttempts.set(ip, record);
  return record.count <= 5; // 5/min
}
```
Apply in `api.ts:195` before `checkLogin`.

### 5. Add Security Headers (15 min)
Both `next.config.ts`:
```typescript
export default {
  transpilePackages: ["@abuzar/core"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none';" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};
```

### 6. Add `Secure` Flag to Session Cookie (5 min)
`auth.ts:68`:
```typescript
const secure = process.env.NODE_ENV === "production" ? "Secure; " : "";
return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAge}`;
```

### 7. Enable TLS Verification on DB (30 min)
Get Supabase CA cert → add to Vercel env → update `db.ts:58`.

---

## Short-Term (This Week)

| Priority | Task | Effort |
|----------|------|--------|
| 1 | Add ownership checks to `PUT/DELETE /rec/:store/:id` | 2h |
| 2 | Add role-based field allowlists (mass assignment fix) | 3h |
| 3 | Validate `create-doc` input server-side (Zod) | 2h |
| 4 | Enable RLS on all tables | 3h |
| 5 | Create separate DB roles (readonly/write/admin) | 2h |
| 6 | Add hard delete endpoint (owner only) | 1h |
| 7 | Force password change on first login | 1h |
| 8 | Add request body size limit (`512kb`) | 5min |
| 9 | Add timeout to GST fetch (`5s`) | 10min |
| 10 | Remove `legacy.html` / `prototype.html` from `public/` | 5min |
| 11 | Add lock timeout in `withAdvisoryLock` | 10min |
| 12 | Add audit log table + trigger | 2h |

---

## Medium-Term (This Month)

- Dependency scanning (Dependabot + `npm audit` in CI)
- Structured JSON logging with request IDs
- Health check endpoint (`/health`)
- CAPTCHA on login after 3 failures (Turnstile/hCaptcha)
- JSONB constraints + indexes
- Invoice numbering via sequences
- Separate cookie domains or schema claim in session
- Monitoring/alerting on 429 rate limit hits

---

## Risk Acceptance (Deferred)

- `meta` table structure — low business impact
- Pool size tuning — monitor first
- Full RBAC matrix — implement after critical/high fixed

---

## Verification Checklist

After fixes, verify:
- [ ] `git ls-files .env*` returns nothing
- [ ] `curl -I https://safa-unofficial.vercel.app` shows CSP, HSTS headers
- [ ] `POST /api/data/auth/login` returns 429 after 5 attempts
- [ ] Manager login cannot `DELETE /rec/customers/:id`
- [ ] Manager login cannot set `finalPrice` on quotation
- [ ] `openssl s_client -connect db.xxx.supabase.co:5432` shows valid cert chain
- [ ] `SELECT * FROM pg_policies WHERE schemaname = 'unofficial'` returns policies
- [ ] Hard delete endpoint requires `owner` role
- [ ] Default credentials rejected / force-change enforced

---

## Contact

For questions on this audit, reference the individual reports in `security/reports/`.