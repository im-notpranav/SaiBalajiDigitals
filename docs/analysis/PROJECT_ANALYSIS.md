# Sai Balaji Digitals OMS: Project Analysis (baseline v1.0)

| | |
|---|---|
| Version | 1.0 (baseline, before review) |
| Date | 2026-10-22 |
| Branch analysed | `feat/work-allocation-payments` (HEAD `1904d0e` plus uncommitted UI work) |
| Sources | Prisma schema, API routes and controllers, `utils/*` rule modules, web route tree and sidebar, `PORTALS_DISCOVERY.md` decisions log (2026-10-20/21), `README.md` |
| Method | Reverse-engineered from the code as built, cross-checked against the recorded business decisions |
| Status | Superseded in part by the gap review, [`GAP_REVIEW.md`](GAP_REVIEW.md) (v1.1 corrections) |

This document describes the system **as it is built and as it was decided**. It is not a wish list. Where the code and the decisions log disagree, the code is described here, and the disagreement is left for the review to raise.

---

## 1. Purpose and scope

Sai Balaji Digitals is a signage and printing company. The OMS tracks a customer order from creation, through production, installation, billing and collection, to closure. Since October 2026 it also runs two more portals:

- **Work allocation**: assigning Pasters, Helpers and Drivers (field staff) to order-linked field jobs, with leave and overtime registers. It replaces the WB1/WB2 workbooks.
- **Payment requests**: money the company pays *out* by UPI to a CSM or field-staff member against an order. It is never order revenue.

**In scope:** the web app (`apps/web`), the API (`apps/api`), the PostgreSQL schema, and the external channels (SMTP email, AskEva WhatsApp).
**Out of scope (decision 2a):** work with no billable order (recces, rectifications, events), payroll, GST/tax, customer-facing access.

## 2. System context

| Layer | Technology |
|---|---|
| Web | React 19, TanStack Router and Query, Tailwind 4, shadcn/ui |
| API | Express 4, Prisma, PostgreSQL (Neon). Hosted on Render behind Cloudflare |
| Auth | JWT in an httpOnly, SameSite=strict cookie (7 days); bcrypt cost 12 |
| Email | Nodemailer over SMTP. Optional: without `SMTP_HOST`, mail is skipped |
| WhatsApp | AskEva template API through an outbox table. `WHATSAPP_MODE=log` (the default) only writes to the log |
| Background work | In-process timers: the WhatsApp sender every 10 s, and the payment overdue digest every 15 min (it sends after 09:30 IST, not on Sundays) |
| Audit | Postgres triggers write `AuditLog` rows, attributed through `app.current_user_id` set in each transaction |

## 3. Roles and permissions

### 3.1 Roles

| ID | Role | Purpose | Home |
|---|---|---|---|
| R-01 | ADMIN | Runs the business. Approves payment requests at Admin review, approves overtime, closes and deletes orders | `/admin/dashboard` |
| R-01a | ADMIN + `is_super_admin` | Additionally creates and edits users, resets passwords and runs bulk import | same |
| R-02 | OPERATION_MANAGER (OM) | Read-only on orders and reports. **Writes** only in work allocation: jobs, field staff, masters, leave, overtime entry | `/admin/dashboard` |
| R-03 | CSM | Raises and edits own orders, confirms installation, raises payment requests on own orders | `/employee/*` |
| R-04 | ACCOUNTS | Raises invoices, records customer payments, adds follow-ups | `/accountant/*` |
| R-05 | PRODUCTION_MANAGER | Assigns line items to production staff | `/prod-manager/*` |
| R-06 | PRODUCTION | Completes their own assigned items | `/production/*` |
| R-07 | COST_CONTROL_MANAGER (CCM) | Reviews, pays (records the UTR) and closes payment requests | `/cost-control/*` |
| R-08/09/10 | PASTER / HELPER / DRIVER (field roles) | See own jobs, mark them started or completed, request leave, see own overtime, raise payment requests on orders of their jobs | `/field/*` |
| SYS-01 | AskEva webhook | Delivery reports and STOP/START replies. Authenticated by a shared secret | `/api/webhooks/askeva` |
| SYS-02 | Schedulers | WhatsApp sender and payment overdue digest | in-process |

### 3.2 Permission matrix (as built)

Key: **W** = write, **R** = read, **own** = only own records, **–** = no access.

| Function | ADMIN | OM | CSM | ACC | PM | PROD | CCM | Field |
|---|---|---|---|---|---|---|---|---|
| Orders: list | R | R | own | R | R | R | – | – |
| Orders: open one | R | R | R (any) | R | R | own items, Active only | – | – |
| Orders: create, add items | W | – | W (own) | – | – | – | – | – |
| Orders: header and store edits | W | – | W (any CSM) | – | – | – | – | – |
| Orders: delete | W | – | – | – | – | – | – | – |
| Item: flag | W | – | W (own order) | – | – | – | – | – |
| Item: loss remark | W | – | – | – | – | – | – | – |
| Item: assign to production | W | – | – | – | W | – | – | – |
| Item: complete | W | – | – | – | W | own | – | – |
| Store: mark installed | W | – | W (creator) | – | – | – | – | – |
| Invoice: raise, record payment, edit | W | – | – | W | – | – | – | – |
| Follow-ups | W | R | W | W | R | R | – | – |
| Close / force-close order | W | – | – | – | – | – | – | – |
| Export, email export | W | W | W | W | – | – | – | – |
| Bulk import | super | – | – | – | – | – | – | – |
| Users: list | R | R | – | – | – | – | – | – |
| Users: create, edit, reset password | super | – | – | – | – | – | – | – |
| Users: delete, activate/deactivate | W | – | – | – | – | – | – | – |
| Field staff: create, edit, deactivate, reset password | W | W | – | – | – | – | – | – |
| Masters (areas, vehicles, CSM codes) | W | W | – | – | – | – | – | – |
| Work jobs, board, grid | W | W | – | – | – | – | – | own (`/my`) |
| Job start/complete (own) | – | – | – | – | – | – | – | W |
| Leave: record, edit, cancel, decide | W | W | – | – | – | – | – | request/withdraw own |
| Overtime: enter, edit, delete (pending) | W | W | – | – | – | – | – | R own |
| Overtime: approve/reject | W | – | – | – | – | – | – | – |
| Payment requests: raise | – | – | own orders | – | – | – | – | orders of own live jobs |
| Payment requests: review | Admin stage | – | – | – | – | – | CCM stage | – |
| Payment requests: mark paid, close | – | – | – | – | – | – | W | – |
| Payment requests: cancel | any unpaid | – | own, before approval | – | – | – | – | own, before approval |
| Payment settings (overdue days) | W | R | – | – | – | – | – | – |
| Order sequence settings | W | R | – | – | – | – | – | – |
| WhatsApp log and retry | W | – | – | – | – | – | – | – |
| Audit log, overdue, loss and FY reports | R | R | – | FY | – | – | – | – |
| Own profile and password | W | W | W | W | W | W | W | W |
| Own notifications: mark read | W | W | W | W | W | W | W | W |

**Enforcement.** `authenticate` re-reads the user on every request: an inactive user is rejected, and the live role is used, not the role in the token. `authorize(...roles)` gates each router. `denyReadOnlyMutations` blocks every non-GET request from OM on routers outside work allocation. Super-admin checks reload the flag from the database.

## 4. Modules and functions

| ID | Module | Key functions |
|---|---|---|
| M-01 | Auth and session | F-01 login (rate limit 10 per 15 min per IP), F-02 logout, F-03 who-am-I |
| M-02 | Users and field staff | F-04 user CRUD (super admin), F-05 activate/deactivate, F-06 field-staff CRUD and password reset (Admin/OM), F-07 own profile, phone and WhatsApp opt-out |
| M-03 | Orders | F-08 create order (≥1 store, ≥1 item; number `ORD{YY}{NNNN}`), F-09 add line items (append-only for CSM), F-10 header and store edits, F-11 add/remove store (≤50 stores), F-12 flag item, F-13 loss remark, F-14 delete order |
| M-04 | Production | F-15 assign item to one or more production users, F-16 complete an assignment (the item is complete when every assignment is) |
| M-05 | Installation | F-17 mark a store installed (creator CSM or Admin; order Active; that store's assigned items complete) |
| M-06 | Billing and collection | F-18 raise an invoice on a set of stores (bill ≤ covered billable value), F-19 record payment (one entry per invoice, ≤ bill), F-20 edit billing, F-21 edit payment, F-22 follow-ups (after billing) |
| M-07 | Closure and reporting | F-23 close order (from Pending, with remark), F-24 force-close (any status), F-25 export and email export, F-26 overdue, loss and FY reports, F-27 audit log, F-28 role dashboards |
| M-08 | Work allocation | F-29 masters (areas with locality, vehicles, CSM codes), F-30 create/edit job, F-31 job status, F-32 daily board, F-33 weekly grid, F-34 field "My Work" with start/complete |
| M-09 | Leave and overtime | F-35 record/edit/cancel leave, F-36 request/withdraw own leave, F-37 decide leave, F-38 enter/edit/delete overtime (up to 5 people per entry), F-39 decide overtime (bulk) |
| M-10 | Payment requests | F-40 order picker with eligibility, F-41 raise request (idempotent), F-42 review transitions, F-43 mark paid, F-44 close, F-45 attachments, F-46 overdue timers, F-47 payment dashboard, F-48 daily overdue digest |
| M-11 | Notifications | F-49 in-app notifications, F-50 email (order events, exports), F-51 WhatsApp outbox, sender, retry, delivery reports and opt-out |
| M-12 | Settings and import | F-52 order sequence (lock, next number), F-53 payment overdue days (1–90), F-54 bulk order import (all-or-nothing, super admin) |

## 5. Business rules

| ID | Rule | Source |
|---|---|---|
| BR-01 | The order number is `ORD{YY}{NNNN}`. YY is the year the financial year (1 April – 31 March) started. Numbering restarts at 13 each FY, because 1–12 are reserved for manual use. | `order-sequence.ts` |
| BR-02 | Order status is **derived** from stores, items and invoices, never set by hand, except `Completed`, which only an Admin sets. | `order-derive.ts` |
| BR-03 | A CSM may add line items only while the order is Active or Installed. Saved items cannot be edited or removed: flag them and add a corrected line. | orders controller |
| BR-04 | Header fields stay editable until the order is settled. An Admin may always edit. | `order-status.ts` |
| BR-05 | A store can be invoiced only when every assigned item is production-complete and the store is marked installed. A store with no assigned items can be invoiced at once. | `storeBillingBlocker` |
| BR-06 | An invoice's bill amount is at most the billable total of the stores it covers. A store sits on at most one invoice. Invoice numbers are unique within an order. | orders controller |
| BR-07 | A payment received is at most the bill amount. Each invoice holds one payment record; corrections go through "edit payment". | orders controller |
| BR-08 | Only Pending orders can be closed with a remark. Force-close works from any status. | orders controller |
| BR-09 | An order cannot be deleted while it has payment requests, field jobs or change-log history. | DB foreign keys |
| BR-10 | A field job always links to an order (decision 2). | schema |
| BR-11 | A team has at most 2 Pasters, 2 Helpers and 1 Driver, and at least one person. A job runs whole days, at most 62. | `work-allocation.ts` |
| BR-12 | Nobody is booked on two overlapping jobs unless the job is marked "Allow 2nd job". Enforced in the API and by an exclusion constraint. | migration |
| BR-13 | Approved leave blocks allocation outright. "Allow 2nd job" does not override it. | `work-allocation.ts` |
| BR-14 | Leave recorded by a manager is approved at once. A field member's own request is PENDING until a manager decides. Pending and approved leave for one person never overlap. | leave controller |
| BR-15 | Overtime hours come from the start and close times. A close at or before the start means the work ran past midnight. One person's entries never overlap, and no overtime is allowed on a leave day. | `overtimeSpan` |
| BR-16 | Only Admin approves or rejects overtime. Only pending entries can be edited or deleted. | overtime routes |
| BR-17 | A field member may start an Assigned job from its start date, and complete a Started one. Hold, cancel and reopen are for managers. | `myJobStatus` |
| BR-18 | **Payment eligibility:** an order is open to new requests once every item sent to production is complete, or it is Installed. An order with no items in production is open. It closes to new requests at the first invoice. | `paymentEligibility` |
| BR-19 | The requester is the payee. A CSM may raise on orders they created. A field member may raise on orders where they are on a non-cancelled job. | payment controller |
| BR-20 | **Route:** "Bill details required?" = No → Admin review, then CCM review. Yes → CCM review only. The route is fixed at submission. | `payment-workflow.ts` |
| BR-21 | The reviewer of the current stage may approve, reject (with a reason) or return for information (with a reason). Resubmission goes back to the stage that returned it. | same |
| BR-22 | The requester may cancel at the first stage or while returned. An Admin may cancel any unpaid request, with a reason. | same |
| BR-23 | Only CCM marks a request paid (UTR required; paid amount ≤ amount asked) and closes it. A bill-details request cannot close without a live bill. | same |
| BR-24 | There is no cap on the number of requests or their total per order. The UI warns when the total asked exceeds the order value. | decision 11 |
| BR-25 | Attachments may be JPG, PNG, WEBP, HEIC or PDF (type detected from the bytes), up to 5 MB each and 10 live files per request, with no duplicates. Removal is a soft delete. | `payment-files.ts` |
| BR-26 | Overdue: a payment timer turns red after more than N working days (N from settings, default 10). Days are counted in IST, Sundays excluded. | `payment-timers.ts` |
| BR-27 | WhatsApp never blocks business work. Payment messages are queued in the same transaction; job and order messages after commit. Retries come after 1, 5, 15 and 60 min, then the message is marked FAILED. | `outbox.ts` |
| BR-28 | People who opt out, or have no valid mobile, are logged as SKIPPED and still get in-app notifications. | `outbox.ts` |

## 6. Workflows

### WF-01 Order to cash

1. A CSM (or Admin) creates an order with stores and line items, and gets an `ORD` number. Accounts and Admin are notified; the creator gets an email.
2. The PM assigns items to production users. Each user completes their part, and the item completes when every assignment is done.
3. When every assigned item of a store is done, the creator CSM marks that store installed. When all stores are installed, the order derives **Installed**.
4. Accounts raises one or more invoices, each covering a set of stores. Status derives **BillingCompleted**, or **Pending** when billed short.
5. Accounts records each invoice's payment. Full payment on every invoice → **PaymentReceived**. A shortfall → **Pending**, and follow-ups are logged.
6. The Admin closes a Pending order with a remark, or force-closes any order → **Completed**.

### WF-02 Production
The PM assigns (multiple assignees allowed). Assignees see the item in their queue and mark it complete. A flagged item cannot be completed until an Admin resolves the flag.

### WF-03 Field job
1. Admin/OM picks an order (and optionally its stores), the dates, area, vehicle, CSM code and team. The system checks team limits, active people, approved leave and overlaps.
2. The team is notified in-app and on WhatsApp. The CSM hears that a team was assigned.
3. A team member marks it **Started** (on or after its start date), then **Completed**, with an optional note. The CSM and the job's creator are notified.
4. Managers can Hold, Cancel (with a reason, which frees the team's dates) or reopen a Completed job.

### WF-04 Leave
- **Manager-recorded:** created APPROVED. If the person is on jobs over those dates, the manager must tick "save anyway".
- **Self-requested:** a field member asks for leave from today onwards → PENDING, and OM users are notified. A manager approves (acknowledging job clashes) or rejects with a reason. The requester can withdraw while it is PENDING. A manager can cancel approved leave, with a reason.

### WF-05 Overtime
Admin/OM logs entries, for up to 5 people at once, optionally linked to a job. The Admin approves or rejects them in bulk, and each person is notified.

### WF-06 Payment request
1. The requester picks an eligible order, optionally a job of theirs on it, and enters the amount, UPI ID or mobile, purpose, category and the bill choice. Files can be attached.
2. The request enters ADMIN_REVIEW or CCM_REVIEW according to its route. That stage's reviewers are notified.
3. The reviewer approves, rejects or returns it. A returned request is corrected and resubmitted by the requester.
4. CCM approval → PAYMENT_PENDING. CCM pays outside the system and records the UTR → PAID, and the requester is notified.
5. CCM closes it (a bill must be attached on bill-details requests) → CLOSED.

### WF-07 Notifications
In-app rows are written for each event. Email goes out for order events and exports. WhatsApp messages are queued in the outbox, the sender delivers them, and AskEva's delivery reports move them to DELIVERED or READ. The Admin can resend FAILED or SKIPPED messages.

### WF-08 User lifecycle
The super admin creates staff users. Admin/OM create field staff. Users are deactivated rather than deleted once they have history. Passwords are reset by the super admin, or by Admin/OM for field staff, and changed by the user on Profile.

## 7. State machines

**SM-01 Order** (derived): `Active → Installed → BillingCompleted ⇄ Pending → PaymentReceived`; `Pending → Completed` (close); `any → Completed` (force-close). `Completed` is terminal.

**SM-02 WorkJob:** `ASSIGNED → STARTED | HOLD | CANCELLED`; `STARTED → COMPLETED | HOLD | CANCELLED`; `HOLD → ASSIGNED | STARTED | CANCELLED`; `COMPLETED → STARTED` (reopen); `CANCELLED` is terminal.

**SM-03 Leave:** `PENDING → APPROVED | REJECTED`; `PENDING | APPROVED → cancelled` (a flag, not a status).

**SM-04 Overtime:** `PENDING → APPROVED | REJECTED`; PENDING entries may be deleted.

**SM-05 PaymentRequest:**
```
ADMIN_REVIEW --approve--> CCM_REVIEW --approve--> PAYMENT_PENDING --mark paid--> PAID --close--> CLOSED
ADMIN_REVIEW | CCM_REVIEW --reject--> REJECTED
ADMIN_REVIEW | CCM_REVIEW --return--> INFO_REQUESTED --resubmit--> (stage it came from)
ADMIN_REVIEW | CCM_REVIEW | INFO_REQUESTED | PAYMENT_PENDING --cancel--> CANCELLED
```

**SM-06 WhatsAppMessage:** `QUEUED → SENT → DELIVERED → READ`; `QUEUED → FAILED | SKIPPED | LOGGED`; `SENT | DELIVERED → FAILED`; `FAILED | SKIPPED → QUEUED` (Admin resend).

## 8. Data model

| ID | Entity | Key fields and relations | Notable constraints |
|---|---|---|---|
| E-01 | User | role, is_active, is_super_admin, emp_code (unique), phone, whatsapp_opt_out | username unique |
| E-02 | Order | order_no (unique), client_name, status, po_number, created_by, remarks | status derived |
| E-03 | OrderStore | order, s_no, store_name, location, po_number, installed_at/by, invoice_id | (order, s_no) unique; ≤50 per order (API) |
| E-04 | OrderItem | order + store (composite FK), media, size, qty, sft, rate, amount, remark, flag, production_completed | the item's order must match its store's order |
| E-05 | OrderItemAssignment | item, user, completed | (item, user) unique |
| E-06 | Invoice | order, invoice_no, bill_amount, billing_date, amount_received, payment_received_at/by | (order, invoice_no) unique; cascades with the order |
| E-07 | OrderChangeLog | order, field, old/new value, changed_by | no cascade |
| E-08 | AuditLog | table, record, action, old/new JSON | trigger-written |
| E-09 | Notification | user, title, body, kind, read, order? | |
| E-10 | PaymentFollowUp | order, note, author | |
| E-11 | CsmCode, Area, Vehicle | allocation masters | code, name and reg_no unique |
| E-12 | WorkJob | order (Restrict), dates, area (Restrict), locality copy, vehicle, CSM codes, status, start/complete/cancel stamps | max 62 days (API) |
| E-13 | WorkJobMember | job, user (Restrict), slot_role, dates copy, blocks_calendar | exclusion: no overlap where blocks_calendar |
| E-14 | WorkJobStore | job, store (Cascade) | |
| E-15 | LeaveRecord | user, from/to, status, decided/cancelled stamps | exclusion: no overlap for live records |
| E-16 | OvertimeEntry | user, work_date, start/end, minutes, start_minute, job?, status | exclusion: no overlap |
| E-17 | PaymentRequest | order (Restrict), job?, requester (Restrict), amount, upi_method/upi_id, purpose, bill flag, route, status, returned_from, paid fields, idempotency_key (unique) | |
| E-18 | PaymentRequestEvent | request, action, from/to, actor, role, note | append-only (trigger) |
| E-19 | PaymentAttachment and Blob | kind, mime, size, sha256, storage, soft delete | no duplicate live sha per request |
| E-20 | WhatsAppMessage | event, template, user, to_phone, params, status, attempts, provider id | provider id unique |
| E-21 | AppSetting | key, JSON value, updated_by | |
| E-22 | OrderSequence | year_code, last_number, is_locked | single row |

## 9. API surface (summary)

| Router | Guard | Notes |
|---|---|---|
| `/api/auth` | public / cookie | login rate-limited |
| `/api/orders` | OMS roles + read-only OM | per-route role lists, email export limited to 15 per 15 min |
| `/api/users` | authenticated + read-only OM | super-admin gates on create, update and reset |
| `/api/dashboard`, `/api/clients`, `/api/media`, `/api/notifications`, `/api/admin` | role lists + read-only OM | |
| `/api/field-staff`, `/api/masters`, `/api/work-jobs`, `/api/leave`, `/api/overtime` | ADMIN, OM (writable) | overtime decision Admin-only |
| `/api/my` | field roles | own records only; 404 for others' jobs |
| `/api/payment-requests` | requester and reviewer roles | per-request rules in `payment-workflow.ts` |
| `/api/whatsapp` | ADMIN | |
| `/api/webhooks/askeva` | shared secret | sits ahead of the global rate limit |
| `/health`, `/health/ready` | public | readiness checks the DB |

## 10. Integrations and background jobs

| ID | Integration | Behaviour |
|---|---|---|
| INT-01 | SMTP | Optional. Order created/edited, item flag, invoice and status mails, and Excel exports. Failures are logged. |
| INT-02 | AskEva WhatsApp | Outbox, a sender every 10 s (batch of 20, 5-minute lease), retries on 429/5xx/timeouts, delivery-report webhook, STOP/START opt-out. Log-only until switched to live. |
| INT-03 | Overdue digest | One in-app digest per person per day after 09:30 IST, Monday to Saturday. |
| INT-04 | Neon PostgreSQL | Exclusion constraints, audit triggers, advisory locks (`lockPeople`). |
| INT-05 | Render + Cloudflare | `trust proxy`, health endpoints for uptime pings. |

## 11. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | 50–60 internal users. Global rate limit of 200 requests/min per IP. |
| NFR-02 | Phone layouts at 375 px for every portal, with no sideways page scroll. |
| NFR-03 | Times and dates in IST. Working days exclude Sundays. |
| NFR-04 | Every write is attributed in the audit log. |
| NFR-05 | Concurrency safety on bookings (exclusion constraints and advisory locks) and on payment transitions (status-guarded update). |
| NFR-06 | Migrations are applied by hand. Production deploys do not run them. |

## 12. Functional requirements

| ID | Requirement | Module |
|---|---|---|
| REQ-01 | Users log in with a username and password and are kept signed in for 7 days | M-01 |
| REQ-02 | Deactivated users lose access on their next request | M-01 |
| REQ-03 | Only the super admin creates non-field users and changes roles | M-02 |
| REQ-04 | Admin/OM create, edit, deactivate and reset field staff | M-02 |
| REQ-05 | A CSM creates orders with stores and items, numbered per FY | M-03 |
| REQ-06 | Saved line items are append-only for CSMs | M-03 |
| REQ-07 | The PM assigns items; production completes them | M-04 |
| REQ-08 | The creator CSM confirms installation per store | M-05 |
| REQ-09 | Accounts invoices sets of stores and records payments | M-06 |
| REQ-10 | Order status is derived consistently from stores and invoices | M-03/06 |
| REQ-11 | The Admin closes or force-closes orders with a remark | M-07 |
| REQ-12 | Orders with history cannot be deleted | M-03 |
| REQ-13 | Reports: overdue, loss, FY, audit; exports and email exports | M-07 |
| REQ-14 | Admin/OM create, edit and change the status of field jobs on orders | M-08 |
| REQ-15 | Double booking is refused unless "Allow 2nd job" is set | M-08 |
| REQ-16 | The daily board and weekly grid show who is busy, free or on leave | M-08 |
| REQ-17 | Field staff see only their own jobs and can start or complete them | M-08 |
| REQ-18 | Leave is recorded or requested, decided, and blocks allocation | M-09 |
| REQ-19 | Overtime is logged and approved by the Admin | M-09 |
| REQ-20 | Requesters raise payment requests on eligible orders only | M-10 |
| REQ-21 | Requests follow the route fixed by the bill choice | M-10 |
| REQ-22 | Reviewers approve, reject and return; requesters resubmit or cancel | M-10 |
| REQ-23 | CCM records payment with a UTR and closes | M-10 |
| REQ-24 | Bills, photos and receipts can be attached with type and size checks | M-10 |
| REQ-25 | Overdue timers and a dashboard show where requests wait | M-10 |
| REQ-26 | A daily overdue digest goes to the people who must act | M-10 |
| REQ-27 | In-app notifications for every workflow event | M-11 |
| REQ-28 | WhatsApp mirrors notifications without blocking work | M-11 |
| REQ-29 | The Admin sets the payment overdue limit and the order sequence | M-12 |
| REQ-30 | The super admin bulk-imports orders all-or-nothing | M-12 |

## 13. Test approach (as planned in the discovery document)

- Unit tests for `payment-workflow.ts`, `paymentEligibility`, `order-derive.ts` and `payment-timers.ts`, which are all pure functions.
- API tests for the permission matrix.
- A concurrency test for double booking.
- An end-to-end smoke run from order to payment close.

Verification so far has been manual, in the browser, after each phase.

## 14. Requirement traceability matrix (baseline)

| REQ | BR | WF | SM | API | Test |
|---|---|---|---|---|---|
| REQ-01/02 | – | WF-08 | – | `/auth`, `authenticate` | manual |
| REQ-03/04 | – | WF-08 | – | `/users`, `/field-staff` | manual |
| REQ-05/06 | BR-01, BR-03 | WF-01 | SM-01 | `POST/PUT /orders` | manual |
| REQ-07 | – | WF-02 | – | `/orders/:id/items/*` | manual |
| REQ-08 | BR-05 | WF-01 | SM-01 | `PUT …/install` | manual |
| REQ-09 | BR-06, BR-07 | WF-01 | SM-01 | `/orders/:id/invoices*` | manual |
| REQ-10 | BR-02 | WF-01 | SM-01 | `recomputeOrderStatus` | manual |
| REQ-11 | BR-08 | WF-01 | SM-01 | `close`, `force-close` | manual |
| REQ-12 | BR-09 | – | – | `DELETE /orders/:id` | manual |
| REQ-13 | – | – | – | `/admin/*`, export | manual |
| REQ-14/15 | BR-10–12 | WF-03 | SM-02 | `/work-jobs` | manual |
| REQ-16 | BR-13 | WF-03 | – | `/work-jobs/board`, `/grid` | manual |
| REQ-17 | BR-17 | WF-03 | SM-02 | `/my/work-jobs` | manual |
| REQ-18 | BR-13, BR-14 | WF-04 | SM-03 | `/leave`, `/my/leave` | manual |
| REQ-19 | BR-15, BR-16 | WF-05 | SM-04 | `/overtime` | manual |
| REQ-20 | BR-18, BR-19 | WF-06 | – | `/payment-requests/order-options`, `POST /` | manual |
| REQ-21/22 | BR-20–22 | WF-06 | SM-05 | `/:id/{approve,…}` | manual |
| REQ-23 | BR-23 | WF-06 | SM-05 | `mark-paid`, `close` | manual |
| REQ-24 | BR-25 | WF-06 | – | `/:id/attachments` | manual |
| REQ-25/26 | BR-26 | WF-06 | – | `/dashboard`, digest | manual |
| REQ-27/28 | BR-27, BR-28 | WF-07 | SM-06 | outbox, webhook | manual |
| REQ-29 | – | – | – | `/admin/*-settings` | manual |
| REQ-30 | – | – | – | `/orders/import` | manual |

## 15. Completeness audit (baseline)

| Area | Status |
|---|---|
| Roles defined and guarded | Complete |
| Order to cash workflow | Complete |
| Work allocation workflow | Complete |
| Leave and overtime | Complete for registers and approval; overtime pay rules open (#26) |
| Payment requests | Complete through close |
| Notifications | In-app complete. WhatsApp built but in log-only mode. Leave/OT WhatsApp not built |
| Tests | Planned, manual so far |

## 16. Assumptions and open questions (baseline)

- A-01: one CCM pool and one Admin pool act on requests; any member of the pool may act.
- A-02: The Render instance stays awake, kept warm by uptime pings, so the in-process timers run.
- A-03: Public holidays count as working days.
- Open from the discovery document: #4 (some CSM codes), #10 (closing an order with open requests), #15 (Admin override of CCM), #19 (amount limits), #23 (does job completion mark the store installed?), #26 (overtime rules), #32 (scheduled summaries), #33 (workbook history migration).
