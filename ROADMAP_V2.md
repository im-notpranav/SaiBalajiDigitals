# SBD OMS — Roadmap V2 (Phases 8–13)

Derived from the owner's spec. Phases are ordered by dependency: roles and the TAT
engine are foundations that the dashboards and reports build on.

## Interpretations (voice-transcription cleanups — confirm if wrong)
- "orders in **building**" → orders in **billing**
- "total value in the **computer**" → total value in **payment**
- "**where** or tat module" → the TAT/aging module
- "It should be a **sheet** by the production manager" → an SFT report/sheet
- **CSM** (Client Service Manager) = the role currently called EMPLOYEE

## Two kinds of TAT (confirmed understanding)
1. **Company TAT** — production → billing. How long *we* take to deliver and invoice.
2. **Payment TAT** — through to payment received. How long the *customer* takes. Max 30 days.

Stage thresholds: **production ≤ 2 days**, **payment ≤ 30 days**, **>7 days in any stage = severe/aging**.
**Sundays are excluded from every TAT calculation in the system.**

---

## Phase 8 — Roles & User Management (foundation)
Everything downstream is role-scoped, so this goes first.

- Restructure the `Role` enum → `ADMIN`, `OPERATION_MANAGER`, `CSM`, `PRODUCTION_MANAGER`, `PRODUCTION`, `ACCOUNTS`.
  Data migration: `EMPLOYEE`→`CSM`, `OPERATOR`→`PRODUCTION_MANAGER`.
- **Operation Manager**: full *read* access to the admin portal; blocked from every mutation
  (no edit / approve / close / assign / confirm). Enforced server-side, not just hidden in UI.
- **Admin user portal fixes**:
  - Role dropdowns currently list only 4 roles and omit OPERATOR entirely — rebuild from a single source of truth.
  - Admin can **reset any account's password**.
- **Fix the duplicate-account bug** (diagnosed — see below) and clean up the 2 existing duplicates.
- Rename the Operator portal → **Production Manager** throughout.

## Phase 9 — TAT Engine (foundation)
- Working-day calculator that **excludes Sundays** — one helper used by every TAT computation.
- Per-order stage timeline: duration in each stage (created → assigned → produced → installed → billed → paid).
- Two TAT types (company / payment) + severity thresholds (2d production, 7d stage-aging, 30d payment).
- Backend endpoints exposing per-order and per-stage TAT so the UI never recomputes it.

## Phase 10 — Dashboards (largest; depends on 8 + 9)
One shared, fully-linked dashboard engine, role-scoped.

- **Date range**: defaults to the current month; from/to calendar picker.
- **Amount ⇄ Quantity toggle** — same six metrics, valued or counted:
  total orders, in production, in installation, in billing, in payment, completed.
- **Every tile is clickable** → drill-down list of the orders in that stage showing
  **that stage's TAT** per order, with >7 days flagged severe (badge, not just colour).
- **Completed orders** drill-down → full stage-by-stage TAT breakdown + delay per stage.
- Drill-down rows show order no, client, store, amount, and the rest of the order detail.
- **Scoping**: CSM sees only orders they created; Admin + Operation Manager see all.
- **Production Manager dashboard**: total SFT printed, orders received, in assignment,
  in installation, average SFT for the month.
- **Production team dashboard**: identical metrics, restricted to their own assignments.
- Existing graphs (employee performance etc.) may stay as-is; the new metrics must be live and linked.

## Phase 11 — Accountant & Payment
- **Financial year rollover → May 31**; order numbering **starts at 13** (1–12 reserved).
- **Billing captures a date** alongside invoice no + bill amount (and payment date at payment).
- **Edit billing / payment details** to correct human error → emails the admin a
  **detailed, structured** before/after description of what changed and who changed it.
- **Follow-ups** (payment stage, after billing): CSM *and* accountant can log repeated
  follow-ups with remarks; 1st, 2nd, 3rd… each with date, author and outcome.
  Visible in the order view for CSM, accountant and admin, including full history.
- **Payment-overdue dashboard**: orders pending payment, count + overdue amount,
  linked into the Phase 10 dashboard and the admin TAT module.

## Phase 12 — Email System
- Profile email is the delivery address: **order created → email that user** the order details.
- **Rewrite every template** into a detailed, structured format (currently far too thin):
  what happened, which order, which fields changed old→new, who did it, when, and a link.
- **Email the Excel export**: compose a message body, attach the generated workbook,
  send to a recipient; **recipient autocomplete** from previously-used addresses (type 3–4 chars).

## Phase 13 — Order creation: Excel import & edit window
- **Excel import when creating an order** (CSM portal) — recommended approach: *we* provide the
  template, parser tolerates column aliases/extra columns; imported data **populates the form
  for review** before saving, rather than saving blindly.
- **Line items may be added to an order until billing touches it** (currently locked earlier).

---

## Diagnosed bug: duplicate user accounts (root cause found)
**It is not caused by assigning a role.** The seed script (`prisma/seed.ts`) upserts demo users
keyed on **username**. When an account is later *renamed* in the admin portal, the seed no longer
matches it, so re-running `npm run db:seed` **creates a brand-new row with a new ID**.

Proven in the live DB — both duplicates were created in the same second (a seed re-run):

| Person | Original (renamed) | Duplicate created by seed |
|---|---|---|
| Bablu Goud | `bablugoud` (id 1, Jul 24) | `employee` (id 6, Jul 30 01:12) |
| Mahesh Goud | `maheshgoud` (id 4, Jul 24) | `admin` (id 7, Jul 30 01:12) |

**Fix (Phase 8):** make seeding safe — only seed when the user table is empty (or require an
explicit opt-in flag), so it can never resurrect renamed accounts. Then delete the 2 stray rows.
Note `maheshgoud` is the real super-admin; `admin` (id 7) is the stray.
