# SBD OMS — Phase 2/3 Build Prompt: Line-Item Loss Accounting + Employee Flag Emails

> Grounded in the real repo. Single source of truth for the two coupled features below.
> Decisions locked by product owner: **employee proposes / admin confirms** losses; remarks **locked after save** (admin-only to change).

## Goal

Two coupled features:

1. **Loss accounting on line items.** A line item marked with a loss remark
   (`Reprint | Sample | UnderWarranty | FreeOfCost | Other`) is *not billed* — its value is
   excluded from the order's billable total and recorded as **loss** — **but only once an admin
   confirms it.** An employee (order creator) may **propose** a loss at entry; a proposal keeps
   counting in the billable total until an admin approves.
2. **Employee flag → email to admin.** Because saved line items are append-only, flagging is the
   employee's correction channel. Flagging a line item with a note ("rate changed", "size changed")
   **emails the admin** (+ in-app notification). The line stays uneditable by the employee.

## State model (the whole design hinges on this)

A line item's loss state is derived from two columns:

| `remarks` | `remarks_confirmed` | Meaning | Counts in billable total? | In loss report? |
|---|---|---|---|---|
| `null` | — | No loss (chargeable) | ✅ yes | no |
| set | `false` | **Proposed** (pending admin) | ✅ yes (not yet a loss) | no |
| set | `true` | **Confirmed loss** | ❌ excluded | ✅ yes |

**Single rule, applied everywhere a total is computed:**
```
isConfirmedLoss(item) = item.remarks != null && item.remarks_confirmed === true
billableTotal = Σ amount where !isConfirmedLoss
lossTotal     = Σ amount where  isConfirmedLoss
```

## Data model (Prisma)

Add to `OrderItem`:
- `remarks_confirmed     Boolean   @default(false)`
- `remarks_confirmed_at  DateTime?`
- `remarks_confirmed_by  Int?`  + relation `remarksConfirmer User? @relation("ItemRemarkConfirmer", ...)`
- `User` gets back-relation `confirmedItems OrderItem[] @relation("ItemRemarkConfirmer")`

Migration **backfill**: `UPDATE "OrderItem" SET remarks_confirmed = true WHERE remarks IS NOT NULL;`
(existing remarks predate the proposal concept — treat them as confirmed so current loss data is preserved).

## Backend changes (`apps/api/src`)

1. **`createOrder`** — allow `item.remarks` for **employee and admin** (revert the admin-only strip).
   `remarks_confirmed = isAdmin` (admin auto-confirms; employee proposes). Set `remarks_set_at/by`
   when a remark is present; `remarks_confirmed_at/by` when confirmed. If a non-admin proposes ≥1 loss,
   `notifyRole("ADMIN", …)` so admins know to review.
2. **`updateOrder`**
   - New items: same rule as create.
   - Existing items: keep the append-only 403 when an employee changes `remarks`. **Never** write
     `remarks_confirmed` from the form update path (preserve admin confirmation across employee edits).
3. **`setItemLossRemark`** (admin) — setting a remark ⇒ `remarks_confirmed=true, confirmed_at=now,
   confirmed_by=admin` (this both *sets* and *confirms a proposal*). Clearing (`remarks=null`) ⇒
   `remarks_confirmed=false, confirmed_at/by=null` (this is *reject*).
4. **`reconcileInvoice`** — `orderTotal = billableTotal`. Overpay guard + `isMatch` use `billableTotal`.
   Guard the all-loss edge case (`billableTotal === 0`).
5. **`exportOrders`** — total/pending use `billableTotal`; keep loss rows visible; add a `Loss?` column.
6. **`getOrders` / `getOrder` / create+update responses** — `total_amount = billableTotal`; add `loss_amount`.
7. **`getAdminDashboard`** pending ₹ — exclude confirmed losses.
8. **`getLossReport`** — filter `remarks_confirmed: true` (only confirmed losses are real losses).
9. **`flagOrderItem`** — on `is_flagged=true`: `sendItemFlagEmail(...)` → `ADMIN_EMAIL` + `notifyRole("ADMIN", …)`.

### Email (`email.service.ts`)
`sendItemFlagEmail(orderNo, employeeName, itemLabel, note)` → `ADMIN_EMAIL`,
subject `[Flag] {orderNo} — line item flagged by {employeeName}`, body includes item + note.

## Frontend changes (`apps/web/src`)

1. **`OrderForm`** — show the loss-remark selector on **new** lines for all roles (revert admin gate).
   Label: employee → "Propose loss remark (needs admin approval)"; admin → "Loss remark".
   Live summary: split **Billable** vs **Loss (proposed/applied)**.
2. **`OrderDetail`** — line badges: confirmed = amber "Loss: X"; proposed = blue "Proposed loss: X —
   pending approval". Totals block shows **Billable Total** + **Loss** (from `total_amount`/`loss_amount`).
   `RemarkDialog` (admin): proposed → Confirm / change / Reject(clear); none → set(confirm);
   confirmed → change / clear. Surface the confirmed vs proposed state.
3. **Accountant billing** (`_portal.accountant.billing_.$id.tsx`) — already uses `order.total_amount`
   (now billable); add a note "excludes ₹{loss} in loss items".
4. **Loss report** — no FE change (already reads `data.items`); backend now returns confirmed-only.

## Verification checklist (what the owner will test)

- [ ] Employee creates a 5-item order, proposes item #3 as *Sample* → order total = all 5; item #3 badged **proposed**; admins notified.
- [ ] Admin confirms item #3 → total drops to 4 items; item #3 appears in the loss report; billable = 4 items.
- [ ] Accountant billing max = billable (4 items); overpay blocked.
- [ ] Employee flags item #2 with "size changed" → admin receives **email** + in-app notification; employee still cannot edit the line.
- [ ] Append-only: employee cannot change item #3's remark after save (403).
- [ ] `npx tsc --noEmit` clean in both apps.
