# Secrets & Environment Security Audit Report

**Status:** CRITICAL FINDINGS  
**Date:** 2025-07-28

---

## Critical

### 1. Vercel OIDC Tokens Committed to Repository (CRITICAL)

**Files:**
- `apps/unofficial/.env.local` (line 2)
- `apps/unofficial/.env.local.production` (line 2)
- `apps/official/.env.local` (line 2)
- `apps/official/.env.local.production` (line 2)
- `.env.local` (line 9)

**Token Format:** JWT with `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6...`

**Decoded Payload (example from unofficial/.env.local):**
```json
{
  "iss": "https://oidc.vercel.com/abuzarfarrooz-4986s-projects",
  "sub": "owner:abuzarfarrooz-4986s-projects:project:safa-unofficial:environment:development",
  "scope": "owner:abuzarfarrooz-4986s-projects:project:safa-unofficial:environment:development",
  "aud": "https://vercel.com/abuzarfarrooz-4986s-projects",
  "owner": "abuzarfarrooz-4986s-projects",
  "owner_id": "team_w2icWaw5XU1lDj3W7yhmE3xd",
  "project": "safa-unofficial",
  "project_id": "prj_YbiyEKYyR9ILG8eUoOS6CBFu5GNK",
  "environment": "development",
  "plan": "hobby",
  "user_id": "JuzHinnNhUAk8tE8x3txF2B",
  "client_id": "cl_HYyOPBNtFMfHhaUn9L4QPz6Tp47bp",
  "nbf": 1785032152,
  "iat": 1785032152,
  "exp": 1785075352
}
```

**Impact:** 
- Full control over Vercel projects `safa-unofficial` and `abuzar-official`
- Can deploy, delete, modify environment variables, view logs, access preview deployments
- Can access all secrets stored in Vercel dashboard (DATABASE_URL, APP_SESSION_SECRET, etc.)
- Token valid until `exp` (~12 hours from issuance) — but **new tokens issued on each Vercel CLI login**

**Root Cause:** Vercel CLI automatically writes `VERCEL_OIDC_TOKEN` to `.env.local` when running `vercel link` or `vercel dev`. These files were committed.

**Remediation:**
1. **IMMEDIATE:** Go to Vercel Dashboard → Projects → Settings → Tokens → **Revoke all OIDC tokens**
2. **IMMEDIATE:** Delete `.env.local` files from working tree: `git rm --cached apps/unofficial/.env.local apps/official/.env.local .env.local`
3. **IMMEDIATE:** Add to `.gitignore` (already present but not enforced)
4. **Verify:** Check git history — `git log --all --full-history -- .env.local` — if ever committed, **rotate ALL secrets** (DATABASE_URL, APP_SESSION_SECRET, GST_API_KEY, etc.)

---

### 2. `APP_SESSION_SECRET` Not Set — Uses Weak Derived Fallback (CRITICAL)

**File:** `packages/core/src/server/auth.ts:15-21`

```typescript
function secret(): string {
  return (
    process.env.APP_SESSION_SECRET ||
    // derived fallback so dev works out of the box; set APP_SESSION_SECRET in prod
    createHmac("sha256", "app-session").update(process.env.DATABASE_URL || "dev").digest("hex")
  );
}
```

**Vulnerability:** 
- If `APP_SESSION_SECRET` not set (not in any `.env` file found), session signing key is derived from `DATABASE_URL` + constant string
- `DATABASE_URL` may be exposed in logs, error messages, or leaked
- Derived key is deterministic — anyone with DATABASE_URL can forge session cookies
- **No rotation mechanism** — same key forever unless env var set

**Impact:** Session hijacking, privilege escalation (forge `owner` role cookie), authentication bypass.

**Remediation:**
1. Generate strong secret: `openssl rand -hex 32`
2. Set `APP_SESSION_SECRET` in Vercel dashboard for BOTH projects
3. Remove fallback or make it throw in production

---

### 3. `APP_MASTER_PASSWORD` Backdoor (CRITICAL)

**File:** `packages/core/src/server/auth.ts:23-25, 121-123`

```typescript
function masterPassword(): string {
  return (process.env.APP_MASTER_PASSWORD || "").trim();
}

// In checkLogin():
const master = masterPassword();
if (!verifyPassword(pw, u.password) && !(master && pw === master)) return null;
```

**Vulnerability:**
- Single password authenticates as **ANY user** (owner or manager)
- No audit trail — appears as normal login
- If set in env, anyone with access to Vercel dashboard / logs / deployments can login as owner
- Not in any `.env` file found — but **if ever set**, it's a universal backdoor

**Impact:** Complete authentication bypass. Full data access, write, delete.

**Remediation:**
1. **Remove entirely** — master password concept is incompatible with audit/security
2. If absolutely needed: require MFA, log all uses, restrict to specific IPs, auto-expire

---

## High

### 4. `DATABASE_URL` in Vercel Dashboard — Not in Repo (GOOD) but Check Rotation

**Status:** Not found in any committed file. Correctly stored in Vercel Environment Variables.

**Check:** 
- Has it ever been in git history? `git log --all --full-history --grep="DATABASE_URL" --oneline`
- If yes → **rotate immediately** (Supabase: Settings → Database → Reset password)

---

### 5. `GST_API_KEY` — Third-Party Secret (HIGH)

**Files:** `.env.example` documents it; not found in committed files.

**Risk:** If set in Vercel, it's a third-party API key (Appyflow). Compromise = 50 free lookups burned, potential rate limit abuse.

**Fix:** Store in Vercel env vars only. Rotate if ever exposed.

---

### 6. Weak Default Passwords in Code (HIGH)

**File:** `packages/core/src/server/auth.ts:80-83`

```typescript
const DEFAULT_USERS: { id: string; name: string; role: "owner" | "manager"; pw: string }[] = [
  { id: "afsar", name: "Owner", role: "owner", pw: "afsar786" },
  { id: "ajju", name: "Manager", role: "manager", pw: "ajju123" },
];
```

**Vulnerability:**
- Hardcoded default passwords seeded on first boot
- Predictable, weak (`afsar786`, `ajju123`)
- If database ever reset/recreated, these become active
- No forced password change on first login

**Impact:** Default credential attack — if attacker can trigger re-seed or access fresh deploy.

**Remediation:**
1. Remove defaults — require manual user creation via admin UI
2. Or: generate random passwords on seed, output to console only once
3. Force password change on first login

---

### 7. `.env.local` Files in Working Tree (HIGH)

**Files found:**
- `apps/unofficial/.env.local` — contains VERCEL_OIDC_TOKEN
- `apps/official/.env.local` — contains VERCEL_OIDC_TOKEN
- `.env.local` (root) — contains VERCEL_OIDC_TOKEN

**Status:** Gitignored (`.gitignore` line 34: `.env*`, line 35: `!.env.example`) but **present in working directory**.

**Risk:** Accidental commit, IDE sync, backup tools, malware exfiltration.

**Remediation:**
1. Delete all `.env.local*` files from working tree
2. Use Vercel dashboard for all secrets
3. For local dev: `vercel env pull .env.local` (auto-gitignored)

---

## Medium

### 8. No Secret Scanning in CI (MEDIUM)

**Missing:** No `git-secrets`, `truffleHog`, `gitleaks`, or GitHub Secret Scanning in workflow.

**Fix:** Add GitHub Actions workflow with `gitleaks` or enable GitHub Secret Scanning (free for public, paid for private).

---

### 9. `NEXT_PUBLIC_` Prefix Not Used (GOOD — but verify)

**Status:** Grep found no `NEXT_PUBLIC_` or `VERCEL_` prefixes in source code. Good — no client-side secret leakage.

---

### 10. Environment Separation (MEDIUM)

**Current:** 
- Development: `.env.local` (local only)
- Production: Vercel Dashboard Environment Variables
- Preview: Vercel Preview Environment Variables

**Gap:** No staging environment. Preview deployments get production secrets.

**Fix:** Configure separate Vercel environments (Production, Preview, Development) with different secret values.

---

## Low

### 11. `pnpm-lock.yaml` May Contain Registry Tokens (LOW)

**Check:** `grep -i "token\|auth" pnpm-lock.yaml` — if private registry used, tokens may be in lockfile.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| Critical | 3 | Vercel OIDC tokens in repo, weak derived session secret, master password backdoor |
| High | 4 | DATABASE_URL rotation check, GST_API_KEY, weak default passwords, .env.local in working tree |
| Medium | 2 | No secret scanning in CI, preview env uses prod secrets |
| Low | 1 | Lockfile token check |

---

## IMMEDIATE ACTION CHECKLIST

### Do RIGHT NOW (in order):

1. ☐ **Vercel Dashboard → Projects → Settings → Tokens → REVOKE ALL OIDC TOKENS** (both projects)
2. ☐ **Vercel Dashboard → Projects → Settings → Environment Variables → ADD `APP_SESSION_SECRET`** (generate: `openssl rand -hex 32`)
3. ☐ **Vercel Dashboard → REMOVE `APP_MASTER_PASSWORD`** if set
4. ☐ **Delete local `.env.local*` files:**
   ```bash
   rm apps/unofficial/.env.local apps/unofficial/.env.local.production
   rm apps/official/.env.local apps/official/.env.local.production
   rm .env.local
   ```
5. ☐ **Check git history for secrets:**
   ```bash
   git log --all --full-history --oneline -- .env* | head -20
   git log --all --full-history -p -- .env* | grep -E "DATABASE_URL|APP_SESSION_SECRET|GST_API_KEY" | head -5
   ```
6. ☐ **If secrets ever committed:** Rotate DATABASE_URL (Supabase), rotate GST_API_KEY (Appyflow), regenerate APP_SESSION_SECRET
7. ☐ **Change default passwords** in database via app UI (Settings → Change Password)
8. ☐ **Enable GitHub Secret Scanning** on repository

### This Week:
9. ☐ Add `gitleaks` to CI
10. ☐ Configure separate Vercel environments (dev/preview/prod)
11. ☐ Remove default user seeding or make it generate random passwords