# SBD OMS — Application Security Assessment

**Date:** 2026-11-08
**Scope:** `apps/api` (Express/Prisma), `apps/web` (React SPA), Cloudflare Worker proxy, deploy config. Authorized by the owner; testing done locally against a throwaway `sb_oms_sec_test` database. No production system was touched, no real data used, no application code changed.
**Method:** static review of all routes/controllers/middleware, dependency audit, and dynamic probes run through the real Express app with `supertest` (probe files kept in the session scratchpad, not committed).

---

## Executive summary

The application is in good shape. Access control is enforced server-side across all 66 reviewed routes, input is validated with Zod, uploads are checked by magic bytes, secrets are not committed, and the API carries a strong Helmet CSP and HSTS. The notable gaps are a login rate-limit that trusts a client-supplied header, sessions that survive a password change, and several vulnerable npm dependencies (one with no upstream fix, reachable through bulk upload).

| Severity | Count | Items |
|---|---|---|
| Critical | 0 | — |
| High | 2 | F1 login brute-force bypass, F2 vulnerable `xlsx` (reachable) |
| Medium | 2 | F3 no session revocation on password change, F4 SPA has no security headers |
| Low | 5 | F7 webhook secret in URL, F8 open email export, F9 username timing, F10 cookie flags, F15 500 on delete |
| Info | 4 | F11 proxy-addr, F13 seed password, F14 password policy / stale-role window, F16 User table unaudited |

Priority order to fix: **F1 → F2 → F3 → F4**, then the Low items.

---

## Confirmed findings

### F1 — Login rate limit bypassed by a spoofed client IP  (High)
- **OWASP:** A07 Identification & Authentication Failures. **CWE-307** (improper restriction of excessive auth attempts), **CWE-290** (auth bypass by spoofing).
- **Where:** `apps/api/src/utils/rate-limit.ts:13` (`clientIpKey` → `req.get("x-real-client-ip")`), applied by `apps/api/src/routes/auth.routes.ts` (`loginAddressLimiter`, `loginLimiter`) and the global limiter in `app.ts`.
- **Evidence (tested):** rotating `x-real-client-ip` across 25 failed logins → **0 blocked, 25 allowed through**. With a fixed header, the 11th attempt onward returns 429 as intended.
- **Why it happens:** the limiter keys off `x-real-client-ip`, a request header. In production the Cloudflare Worker overwrites that header from `cf-connecting-ip`, so traffic *through Cloudflare* is safe. But the Render origin (`saibalajidigitals.onrender.com`) is publicly reachable; a client hitting it directly sets the header itself and gets unlimited password guesses, and can also evade the per-user global limiter the same way.
- **Impact:** unlimited offline-speed credential guessing against any username; with an 8-character password minimum this is a realistic account-takeover path.
- **Fix:** do not trust `x-real-client-ip` unless the request actually came from Cloudflare. Either (a) restrict the Render service so only Cloudflare can reach it (Render private networking, or a shared secret header the Worker sets and the API requires), or (b) in `clientIpKey`, only honor `x-real-client-ip` when a Worker-only shared secret header is present, else fall back to `req.ip`. Keep `trust proxy` as is.

### F2 — Vulnerable `xlsx` (SheetJS) reachable through bulk upload  (High)
- **OWASP:** A06 Vulnerable & Outdated Components. **CWE-1321** (prototype pollution), **CWE-400** (ReDoS).
- **Where:** `xlsx@0.18.5` parsed at `apps/api/src/utils/order-template.ts:112` (`xlsx.read(file, { type: "buffer" })`), reached by `POST /api/orders/bulk/preview` and `POST /api/orders/bulk` (`orders.routes.ts:67-68`), open to any CSM (and the super-admin). Advisories: GHSA-4r6h-8v6p-xvw6 (prototype pollution), GHSA-5pgg-2g8v-p4x9 (ReDoS). **No fixed version is published on npm.**
- **Validation status:** confirmed reachable and confirmed-vulnerable version; a working exploit was deliberately not built. Exploitability is *potential* — treat as present because the code path accepts an attacker-controlled workbook.
- **Impact:** a malicious `.xlsx` from a logged-in CSM could pollute `Object.prototype` or hang the single-core free-tier instance.
- **Fix:** move to the maintained distribution (`xlsx` from the SheetJS CDN) which carries the prototype-pollution fix, or replace with `exceljs`. Keep the existing 10 MB cap and consider a row cap.

### F3 — Sessions are not revoked when the password changes  (Medium)
- **OWASP:** A07. **CWE-613** (insufficient session expiration).
- **Where:** `apps/api/src/controllers/auth.controller.ts` (login), `users.controller.ts:137` (`updateMe`), admin reset `resetUserPassword`. JWT is stateless with a 7-day TTL.
- **Evidence (tested):** a token minted before a password change still returned **200** on `/api/auth/me` after the change. (Good: deactivating the account *does* revoke within the 15 s cache — confirmed 401.)
- **Impact:** a stolen or shared token keeps working for up to 7 days even after the user resets their password in response to a suspected compromise.
- **Fix:** add a `password_changed_at` (or `token_version`) column; include it in the JWT and reject tokens older than it in `authenticate`. The existing 15 s user cache already re-reads the user, so the extra check is cheap.

### F4 — The SPA is served with no security headers  (Medium)
- **OWASP:** A05 Security Misconfiguration.
- **Where:** `apps/web/public/_headers` sets caching only; the Cloudflare Worker (`worker/index.js`) serves `apps/web/dist` without CSP/HSTS/etc. Helmet protects API responses only (confirmed: the API returns a strong CSP, HSTS, `X-Frame-Options`, `nosniff`, `no-referrer`, and strips `X-Powered-By`; CORS rejects an unknown origin).
- **Impact:** defense-in-depth gap. Actual XSS risk is low — React escapes by default and the one `dangerouslySetInnerHTML` (`apps/web/src/components/ui/chart.tsx:73`) injects only theme CSS, not user data — but a CSP would contain any future injection and stop clickjacking of the app shell.
- **Fix:** add security headers for HTML in `_headers` (CSP `default-src 'self'`, `X-Frame-Options: DENY` / `frame-ancestors 'self'`, `Referrer-Policy`, `X-Content-Type-Options: nosniff`), or set them in the Worker.

---

## Low severity

- **F7 — Webhook secret in the URL query** (`whatsapp.controller.ts:199`, `?key=`). Lands in Cloudflare/Render access logs. The compare itself is constant-time (good). Prefer a header (`X-Webhook-Secret`) over a query param. **CWE-598.**
- **F8 — Email export to any address** (`orders.controller.ts:2639`): CSM/Accounts/Operation-Manager can mail an orders export anywhere (15 / 15 min). Insider data-exfiltration path and a business decision — consider restricting to a company-domain allowlist or logging recipients. **A04.**
- **F9 — Username enumeration by timing** (`auth.controller.ts:19`): tested median 77 ms for a known user vs 4 ms for an unknown one — a valid username skips bcrypt. Optionally compare against a dummy hash for unknown users. **CWE-204.**
- **F10 — Cookie policy** (`auth.controller.ts:53`): `maxAge` is hardcoded to 7 days and ignores `JWT_EXPIRES_IN`; `Secure` is set only when `NODE_ENV==="production"` — verify Render actually sets that. `HttpOnly` + `SameSite=Strict` confirmed present.
- **F15 — 500 on deleting a missing user** (`users.controller.ts:126`): `DELETE /api/users/:id` with an unknown id throws Prisma P2025 → HTTP 500 instead of 404 (seen in the role matrix run). Handle P2025. **A09 / error handling.**

## Informational

- **F11 — `proxy-addr` advisory (GHSA-jqcg-44mw-7w3h):** not exploitable here; `app.set("trust proxy", 1)` is a hop count, not a trusted-subnet list.
- **F13 — Seed password `demo1234`** (`prisma/seed.ts:33`): confirm no production account still uses it (not checkable without prod access). The committed localhost DB creds in `kill-pg.cjs` are dev-only.
- **F14 — Password policy / stale role:** 8-character minimum (`validators.ts`); and a 15 s window (`auth.middleware.ts`) where a demoted/deactivated user keeps old access. Both acceptable; noted.
- **F16 — `User` table is not audited:** audit triggers (`tests/api/db-extras.sql`) cover orders, payments, jobs, masters, etc., but not `User`, so admin role changes / password resets leave no audit row. **A09.**

## Dependency audit (npm)

18 advisories total (7 critical, 10 high, 1 moderate). Most critical ones are **TanStack Start** (reflected XSS) — the package is installed but the app is a plain Vite SPA with no server functions, so it appears **unused**; removing `@tanstack/react-start` likely clears all of those. Other server-side ones to schedule: `axios`, `body-parser` (DoS), `nodemailer ≤10.1.3`, `qs`, `zod` (memory exhaustion), `seroval`. `vite`/`launch-editor`/`source-map-js` are dev-only. `xlsx` is F2 (no fix).

## What was verified as secure

- Server-side RBAC on all 66 reviewed routes (role matrix × 11 roles matched intent; unauthenticated calls all 401).
- Mass assignment blocked: `is_super_admin`/`role` cannot be set via create-user or `updateMe` (strict schema).
- No password hashes or secrets in any API response (`/me`, user list checked).
- JWT handling: `alg:none`, wrong-key, and role-tampered tokens all rejected; live DB role overrides the token claim.
- Upload type enforced by magic bytes — a script renamed `bill.pdf` is refused (415); downloads carry `nosniff` and a sanitized `Content-Disposition`.
- Order list scoped per CSM; notifications/payment-requests/field-staff scoped to owner/target; `$queryRawUnsafe` uses only a typed table literal; all other SQL is parameterized.
- No committed `.env` or secrets in git history; no user-controlled URL reaches server-side `fetch` (no SSRF surface).

## Retest checklist

- [ ] F1: through Cloudflare the 11th direct-origin login attempt is 429 regardless of `x-real-client-ip`; Render origin not reachable except from the Worker.
- [ ] F2: `xlsx` replaced/upgraded; `npm audit` shows no `xlsx` advisory; bulk upload still works.
- [ ] F3: a token minted before a password change returns 401 after it.
- [ ] F4: `curl -I` on the app URL shows CSP + `X-Frame-Options` on the HTML.
- [ ] F7: webhook authenticates via header, not `?key=`.
- [ ] F15: `DELETE /api/users/<missing>` returns 404.
- [ ] Deps: `@tanstack/react-start` removed if unused; server-side advisories cleared.
