# Gap Analysis, 2026-11-26

| | |
|---|---|
| Scope | Whole repo on `main` at `14dc946` (in sync with `origin/main`, so this is what production serves) |
| Baseline | [`GAP_REVIEW.md`](GAP_REVIEW.md) (57 issues, 2026-10-22), decisions D-01..D-12, [`../security/assessment-2026-11-08.md`](../security/assessment-2026-11-08.md) |
| Method | Read the code for each baseline gap; ran typecheck, lint, all tests and `npm audit`; reviewed deploy config and runbook |
| Not covered | Production database and Render/Cloudflare dashboards (no access); live UI walk-through; accessibility; load on current code |

## 0. Fixed the same day (uncommitted)

The report below describes the code before these fixes.

| Gap | Fix |
|---|---|
| A06 / D-08 | Accounts can open the Payments report. It is a new tab on the Accountant's Financial Reports page (`reports.controller.ts` `REPORT_TABS.payments`, `_portal.accountant.reports.tsx`). |
| C01 / N-13 | Deactivation still takes effect at once, so access is never held up. The response now carries a `warning` that lists open orders (CSM), open jobs, open payment requests and pending leave. The Users and Field Staff pages show it as a 10-second warning toast. Delete keeps its refusal. |
| E01 | `closeOrder` and `forceCloseOrder` re-check status inside the write and return 409 if the order has just moved. |
| New | `forceCloseOrder` had no status check. It could overwrite a closed order's remark, or turn a `PaymentReceived` order into `Completed`. It now refuses closed orders with 400. |
| R3 | `npm audit fix`; `express` 4.22.3 (fixes `qs`, `body-parser`, `proxy-addr`); `vite` 8.4.0; unused `@tanstack/react-start` removed. Production advisories went from 16 to 1. `__root.tsx` error boundary retyped (`error: unknown`) for the updated router. |

Still open from R3: `zod` needs v4 (major); the 1 MB JSON body limit (`app.ts:41`) bounds the memory issue meanwhile. Dev-only: `vitest` 5 (fixes `tinypool`, `@vitest/mocker`) and `nodemon` 3 are majors, not done.

Checks after the fixes: API and web typecheck pass, web build passes, 309 tests pass (103 unit, 206 API, 4 new). The Accountant Payments tab was checked in the browser with no console errors.

## 1. Summary

The code is in good shape. API and web typecheck clean, and all 305 tests pass (103 unit, 202 API). About two thirds of the October gap register is fixed in code, most of it with tests.

The biggest gaps are now **operational**, not functional:

1. **Production migrations are unverified.** Sixteen migrations dated November (the six Nov 22 ones included) must be applied by hand, and `main` deploys on push. If any is missing, the matching screens return 500.
2. **No CI and no automatic migrations.** Nothing stops a push that breaks the build or needs a migration.
3. **Seven critical and eight high npm advisories** in production dependencies. Most fixes are routine minor updates.
4. **Background work dies when Render sleeps.** WhatsApp sender, digests and payment reminders run inside the API process. The planned keep-alive cron was never added to `wrangler.json`.
5. **Five decided features (D-03, D-04 reopen, D-06, D-10, D-12) were never built.**

## 2. Top risks, in fix order

| # | Gap | Severity | Effort | Action |
|---|---|---|---|---|
| R1 | Production migration state unknown | Critical | 15 min | Run `npx prisma migrate status` against the Neon direct URL. Apply any pending migration. |
| R2 | Render build does not run migrations | High | 5 min | Add `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma` to the Render build command. |
| R3 | Vulnerable dependencies (7 critical, 8 high) | High | 1-2 h | `npm audit fix` (non-breaking), then retest. Remove `@tanstack/react-start` if unused. Details in §4.2. |
| R4 | No CI | High | 1-2 h | GitHub Actions: API and web typecheck, web build, unit tests, API tests against a Postgres service. |
| R5 | Schedulers stop when the API sleeps | High | 30 min | Add the office-hours cron trigger from the runbook (§6) to `wrangler.json` and a `scheduled()` handler in `worker/index.js` that calls `/health/ready`. |
| R6 | `Client.block_orders` defaults to `true` | Medium | 10 min | Confirm on the Order Blocks page which clients should block. Otherwise CSMs are blocked on old orders. |
| R7 | CSP still Report-Only | Medium | 15 min | After a week of clean console, rename the header in `apps/web/public/_headers` to `Content-Security-Policy`. |
| R8 | `PROXY_SHARED_SECRET` rollout not confirmed | Medium | 10 min | Set it in Cloudflare first, deploy, then set it on Render. Until then the rate limit trusts any `X-Forwarded-For`. |

## 3. Status of the October gap register

Legend: **Fixed** = seen in code (test named where one exists). **Partial** = part of the correction built. **Open** = not built. **Accepted** = closed by a decision. **Not re-checked** = low-priority item not verified this time.

### 3.1 Fixed

| Gap | What is in the code |
|---|---|
| A01, A02 | OM self-service exempt from read-only; email export allowed for OM (`orders.routes.ts:67`). Test: `permissions.test.ts` "Operation Manager self-service". |
| A03 | Delete, status, edit, reset all `requireSuperAdmin` (`users.routes.ts:32-35`). |
| A05 | Last active Admin or CCM cannot be removed, deactivated or moved (`users.controller.ts` `lastHolderBlock`). Admin acts as CCM only when no CCM is active (`payment-workflow.ts` `noActiveCcm`). |
| A07 | Leave requests notify Admin and OM (`leave.controller.ts:10`). |
| C07, D04 | Admin cannot cancel from PAYMENT_PENDING; CCM rejects instead. Test: `payments.test.ts`. |
| D01 / G04 | Rule changed by D-05 (2026-11-07): a bill is needed to close, not to approve. Implemented (`payment-workflow.ts:241`). |
| D02 | Material change on resubmit restarts the route (`materialChange`). |
| D05 | FY and dates computed in IST (several `Asia/Kolkata` call sites). |
| E01, E02 | Concurrent leave decisions, job complete/cancel, invoice and payment writes are guarded. Test: `concurrency.test.ts`. |
| F01 | Order delete is super admin only and refused once any store is installed (`orders.controller.ts:1214-1235`). |
| F02 | Invoice and payment writes re-check `invoice_id: null` and `amount_received: null` in the transaction. |
| F05 | Amount threshold sends a request to Admin first (`entryStage`, default ₹5,000). |
| F06 | R2 object store in place (`utils/object-store.ts`). |
| G01 | `password_changed_at` revokes older tokens on password change or reset. |
| I01 | Vitest unit and API suites, 305 tests, all passing. |
| A06 / D-08 (part) | Payments tab in Reports, with export, for Admin, OM and CCM. |

### 3.2 Partial

| Gap | Built | Missing |
|---|---|---|
| A06 / D-08 | Payments report and export | **Accounts** cannot open it. D-08 gave Accounts a read-only payout register. Add `ACCOUNTS` to `REPORT_TABS.payments.roles` (`reports.controller.ts:1627`). |
| C01 | **Delete** refuses while the person has open jobs, payment requests or pending leave | **Deactivate** (`toggleUserStatus`) skips that check. A deactivated paster stays on future jobs. Reuse the delete check. |
| C06 / D-04 | Close and force-close need a reason | Open jobs, open payment requests and unfinished production are not listed or acknowledged before closing. |
| G01 | Revocation on password change | Not bumped on role change or deactivation. No "sign out everywhere". The 15-second stale-role window (F14) remains. |
| J03 / D-11 | Jobs can be booked without an order (migration `20261107010000`) | No dedicated "Unavailable" block per person and day. Booking a dummy job works around it. |
| E01 | Guarded where tested | `closeOrder` and `forceCloseOrder` check status, then update `where: { id }` only. Low risk (Admin only), but two Admins can both close. |

### 3.3 Open (decided, not built)

| Gap | Decision | What is missing |
|---|---|---|
| A04 | — | No way to move an order to another CSM. A leaving CSM's orders strand: only Admin can mark them installed, nobody can raise payment requests. |
| B01 / D-03 | Job completion proposes installation; CSM confirms | Completing a job does not touch store installation. |
| B06 / D-04 | Admin can reopen a closed order with a reason | No reopen route (`orders.routes.ts`). A wrong close cannot be undone in the app. |
| B02 / D-12 | Overtime monthly export and month lock | Overtime routes have list/create/decide only. No export, no lock. |
| D06 / D-10 | Holiday list in Settings | No holiday model. Working days skip Sundays only. TAT and aging count holidays as working days. |
| F03 / D-06 | Verified payout handle on the profile | `User` has no UPI field. Every request types the payee fresh. A different payee is not flagged for Admin review. |
| G02 | Admin reset tells the user and forces a change | No WhatsApp or in-app notice on reset; no `must_change_password`. |
| C03 | Flag requests from inactive requesters | Not built. Partly covered once C01 is fixed. |
| C04 | Highlight leave still pending on its start date | Not built. |
| E03 | Admin "revoke decision" for overtime | Not built (depends on D-12 month lock). |
| H02 | Idempotent digest, heartbeat on `/health/ready` | `/health/ready` checks only the database. A dead sender or digest loop is invisible. |
| H03 | Admin health card (SMTP, WhatsApp mode, failures) | Not built. |
| H04 | WhatsApp go-live checklist | Still `WHATSAPP_MODE=log`. AskEva templates, contract and test sends not done. |
| I02 | CI workflow | No `.github/` folder. See R4. |

### 3.4 Accepted or closed by decision

- **B03 / D-09**: payout errors (bounce, wrong UTR, recovery) stay outside the app. Accepted risk. A super-admin DB runbook was meant to replace in-app correction; **that runbook does not exist in `docs/`**. Write it.
- **B05** (InvoicePayment table, optional): still open. An invoice holds one received amount, so part payments overwrite each other.

### 3.5 Not re-checked

B04, C02, C05, C08, F04, F07, F08, G03, H01, H05, H06, I03, J01, J02, J04, J05. Most are Low or optional. B04 and F04 carry code markers, so they are probably fixed.

## 4. New gaps found

### 4.1 Operations and release

| ID | Gap | Severity |
|---|---|---|
| N-01 | `docs/release-runbook.md` is stale. It still names `feat/operator-billing-split` as production, lists migrations only up to 2026-11-08, and has no step for the Nov 15-22 migrations. Rewrite it for `main`. | High |
| N-02 | No record of which migrations production has. Keep a release log (date, commit, migrations applied, who) in `docs/`. | Medium |
| N-03 | Render free tier: the load test measured 0.75 core and 821 MB for 150 users against 0.1 core and 512 MB. `NODE_OPTIONS=--max-old-space-size=400` is untested. Expect slowness at peak. | Medium |
| N-04 | No backup or restore drill. Neon point-in-time restore depends on plan; on free tier the window is short. Take a scheduled logical dump (`pg_dump`) weekly. | Medium |
| N-05 | No error monitoring. Errors go to `console.error` on Render only, with short log retention. Add Sentry (free tier) or a log drain. | Medium |
| N-06 | Root folder clutter: `1'` (empty file), `prompt*.txt`, `phase5*.txt`, `original_prompt.txt`, `full_prompt.txt`, `PHASE_2_3_BUILD_PROMPT.md`, `apps/api/{add-constraint.ts,fix-checksum.cjs,kill-pg.cjs,seed-new-media.ts}`. `AGENTS.md` is 1 byte. Remove or move to `docs/archive/`. | Low |
| N-07 | Eight local branches and three remote feature branches are merged or stale. Prune after confirming. | Low |

### 4.2 Security and dependencies

`npm audit --omit=dev` (2026-11-26): 16 advisories, 7 critical, 8 high, 1 moderate.

| Package | Severity | Exposure | Fix |
|---|---|---|---|
| `proxy-addr` (via Express) | Critical | **Real.** API runs behind a proxy with `trust proxy` set; IP spoofing weakens rate limiting. | `npm audit fix` |
| `@tanstack/react-start` and 4 sub-packages | Critical | Low if unused: no `createServerFn` or Start import in `apps/web/src`. Still shipped as a dependency. | Remove from `apps/web/package.json` if the build does not need it; else update. |
| `seroval` | Critical | Pulled in by TanStack. | Update with TanStack. |
| `body-parser`, `qs` | High / Moderate | **Real.** DoS on the API body parser. | `npm audit fix` |
| `axios`, `follow-redirects` | High | Web client; low server exposure. | `npm audit fix` |
| `vite`, `source-map-js`, `js-yaml`, `nanoid` | High | Build-time or dev server. | `npm audit fix` |
| `zod` | High | Fix needs zod 4 (major). Memory exhaustion on oversized arrays. | Add `.max()` limits to array schemas now; plan zod 4 later. |

Other items from the November assessment still open: F13 (check production seed passwords), F14 (8-character minimum, 15-second stale role). See R7 and R8 for the two rollout steps.

### 4.3 Code quality

| ID | Gap | Severity |
|---|---|---|
| N-08 | Web lint: 7,959 errors. 7,772 are Prettier formatting (auto-fixable); 187 are `no-explicit-any`. Lint is not run anywhere, so it drifts. Run `eslint --fix` once in its own commit, then gate it in CI. | Low |
| N-09 | No web tests at all (0 test files). Route guards, role menus and forms are only checked by hand. Add a few Playwright smoke tests per portal. | Medium |
| N-10 | Main web chunk is 732 KB and `xlsx` 484 KB. Code splitting is on. Acceptable on office Wi-Fi; check on field staff phones over mobile data. | Low |
| N-11 | `orders.controller.ts` is 3,011 lines. Changes there carry the most regression risk. Split invoices, production and closing into their own controllers when next touched. | Low |
| N-12 | API tests build the schema with `prisma db push`, not the migrations, because the history does not replay onto an empty DB. Tests therefore cannot catch a broken migration. Add a CI step: `prisma migrate diff --from-migrations --to-schema-datamodel` must be empty. | Medium |

### 4.4 Product and workflow

| ID | Gap | Severity |
|---|---|---|
| N-13 | A CSM's open orders are not counted when that CSM is deactivated or deleted. Together with A04, this strands orders. | High |
| N-14 | Order Blocks (90-day close, 120-day unpaid) start on for every client (`block_orders @default(true)`). No warning period before a block applies. Consider a "warn only" mode for the first weeks. | Medium |
| N-15 | WhatsApp is log-only, so field staff get job and leave news only in-app. Field staff rarely open the app. Until go-live, decide on a fallback (SMS or a daily printout). | Medium |
| N-16 | User guide (`docs/user-guide/*.pdf`, `.html`) predates the Nov 15-22 changes: Operator rename, Request Change, rate cards, machines, Order Blocks, day sheets. Update it before staff training. | Medium |

## 5. Recommended order

1. **This week (ops, under a day):** R1, R2, R5, R6, R8. Rewrite the runbook (N-01) while doing R1.
2. **Next:** R3 dependency updates with a full test run; R4 CI with N-12 and lint gating.
3. **Small code fixes (each under an hour):** Accounts on the payments report (A06); deactivate uses the delete check plus CSM open orders (C01, N-13); status guard on close (E01).
4. **Features already decided:** order reopen (D-04), reassign order owner (A04), holiday list (D-10), payout handle (D-06), overtime export and month lock (D-12), job completion proposes installation (D-03), reset notice (G02).
5. **Before WhatsApp go-live:** H02, H03, H04.
6. **Housekeeping:** N-06, N-07, N-08, N-16.

## 6. Verification run

| Check | Result |
|---|---|
| `apps/api` `tsc --noEmit` | Pass |
| `apps/web` `tsc --noEmit` | Pass |
| `apps/web` `eslint src` | 7,959 errors (7,772 Prettier, 187 `no-explicit-any`) |
| `apps/api` unit tests | 103 / 103 pass |
| `apps/api` API tests (local `sb_oms_test`) | 202 / 202 pass |
| `npm audit --omit=dev` | 7 critical, 8 high, 1 moderate |
| Production DB, Render, Cloudflare | Not checked (no access) |
