# Gap Review of the Project Analysis (v1.0 → v1.1)

| | |
|---|---|
| Reviews | [`PROJECT_ANALYSIS.md`](PROJECT_ANALYSIS.md) v1.0 (2026-10-22) and the system it describes |
| Reviewer stance | Independent business analyst and system architect. Every finding was checked against the code on `feat/work-allocation-payments` |
| Output | Part A: issue register. Part B: corrected sections (v1.1), keeping the baseline IDs. Part C: what this review did not cover, and the decisions needed from you |

**How to read the register**

- **Severity.** *Critical*: money can leave the company, or a control can be bypassed, with no second person involved. *High*: data loss, privilege problems, or a workflow that dead-ends in normal use. *Medium*: a wrong result in an edge case, or a rule that is missing or ambiguous. *Low*: friction, documentation, hygiene.
- **Class.** **M** = mandatory correction: the spec or the system is wrong or unsafe as it stands. **O** = optional improvement. **D** = cannot be corrected until you decide (see Part C, §C.2).
- **Evidence.** **Confirmed** means I read the behaviour in the code (file references given). **Plausible** means it follows from the code but I did not reproduce it at runtime.

---

## Part A: Issue register

### A.0 Summary

| Severity | Count | Mandatory | Optional | Needs decision |
|---|---|---|---|---|
| Critical | 2 | 2 | 0 | 0 |
| High | 17 | 14 | 0 | 3 |
| Medium | 24 | 15 | 3 | 6 |
| Low | 14 | 3 | 9 | 2 |
| **Total** | **57** | **34** | **12** | **11** |

**Fix first** (critical or high, mandatory, small change): GAP-D01, GAP-D02, GAP-F01, GAP-A01, GAP-A03, GAP-E01, GAP-G01, GAP-C07, GAP-D03, then GAP-I01 (tests), so the rest can be changed safely.

### A.1 Missing roles, permissions, modules and functions

**GAP-A01 · High · M · §3.2, REQ-02, WF-08** · *Confirmed*
- **Finding.** The baseline gives the Operation Manager write access to their own profile, password and notifications. In the code, `denyReadOnlyMutations` runs on the whole `/api/users` and `/api/notifications` routers, so `PUT /users/me`, `PUT /notifications/read-all` and `PUT /notifications/:id/read` return 403 for OM. Evidence: `routes/users.routes.ts:8,11`, `routes/notifications.routes.ts:8,11-12`. The web app still shows OM a Profile page (`Sidebar.tsx:152`).
- **Consequence.** OM cannot rotate a leaked password or clear notifications. "Read-only" is enforced as "no POST/PUT anywhere", which is broader than the business rule.
- **Correction.** Define read-only as *no writes to business records*. Self-service routes (own profile, password, notification read-state) are exempt. Corrected §3.2, BR-29.

**GAP-A02 · Low · M · §3.2 (export row)** · *Confirmed*
- **Finding.** `POST /orders/export/email` lists `OPERATION_MANAGER` in its `authorize`, but `denyReadOnlyMutations` on the orders router blocks it (`routes/orders.routes.ts:50,53`).
- **Consequence.** Two rules contradict each other. OM sees an email-export control that always fails.
- **Correction.** An export changes no records, so allow it (§3.2). Otherwise remove OM from the route and hide the control.

**GAP-A03 · High · M · §3.2 (users rows), REQ-03** · *Confirmed*
- **Finding.** Creating, editing and resetting users requires the super admin. Deleting and deactivating requires only `ADMIN` (`routes/users.routes.ts:17-18`). Any Admin can deactivate or delete other Admins, the only Cost Control Manager, or Accounts. The only exceptions are themself and the super admin (`users.controller.ts:87`, `deleteUser`; `:169`, `toggleUserStatus`).
- **Consequence.** A non-super Admin can lock out peers, or stop the payment workflow by deactivating every CCM (see GAP-A05). Account lifecycle has two inconsistent levels of control.
- **Correction.** Activation, deactivation and deletion of non-field users become super-admin only. Deactivating the last active holder of a reviewer role is refused (BR-30).

**GAP-A04 · Medium · M · §4 M-03, BR-19** · *Confirmed*
- **Finding.** No function transfers order ownership. A CSM's list, line-item edits, installation confirmation and payment requests are all tied to `Order.created_by`. When a CSM leaves or is absent, nobody else can confirm installation (except an Admin) or raise payment requests on those orders.
- **Consequence.** Orders strand. Installation and payment eligibility stall, and field staff's CSM contact points to an inactive person.
- **Correction.** Add F-55, "Reassign order owner" (Admin), audited. Its notifications go to the new owner (REQ-31).

**GAP-A05 · High · M · §3.1 A-01, WF-06** · *Confirmed*
- **Finding.** Reviewer pools are assumed to be non-empty and present. With no active CCM, `notifyRole` and `queueWhatsAppRole` send nothing (`payment-requests.controller.ts:226`), requests sit in CCM_REVIEW, and only the Admin's digest mentions them. Nobody can act as CCM: the Admin cannot override (open question #15).
- **Consequence.** Payouts stop silently during leave or after an exit.
- **Correction.** (1) Refuse to deactivate the last active CCM or Admin (BR-30). (2) Whether the Admin may act at the CCM stage is decision D-05. (3) On submit, if the stage has no active reviewer, the API warns and alerts the super admin.

**GAP-A06 · Medium · D · §1 scope, M-07** · *Confirmed*
- **Finding.** Decision 5 keeps payouts apart from revenue "in every report", but there is no payout report or export at all. The only figure is "paid this month" on the CCM dashboard. Accounts has no access.
- **Consequence.** Money leaving the company has no export for bookkeeping or reconciliation against the bank (UTR).
- **Correction.** Add a payout register export (paid and closed requests with UTR, payee, order and category) for Admin and CCM, and Accounts if D-08 says so (REQ-32).

**GAP-A07 · Medium · M · WF-04, REQ-18, BR-14** · *Confirmed*
- **Finding.** Field-staff leave requests and withdrawals notify only `OPERATION_MANAGER` (`leave.controller.ts`, `requestMyLeave` and `withdrawMyLeave`), yet Admin can also decide them. Leave and overtime decisions send no WhatsApp. Field staff are the users least likely to open the app.
- **Consequence.** With no active OM, requests go unseen. Field staff miss approvals, rejections and cancellations.
- **Correction.** Notify every user who can decide (Admin and OM). Add WhatsApp templates for the leave decision and cancellation, and the overtime decision (REQ-33).

### A.2 Features without a complete end-to-end workflow

**GAP-B01 · High · D · WF-01 step 3, WF-03, BR-05, BR-18** · *Confirmed*
- **Finding.** Installation is recorded twice, with no link between the two. Field staff mark a *job* Completed. The CSM separately marks a *store* installed. Billing (BR-05) and payment eligibility (BR-18) read only the CSM's flag. Discovery question #23 is unanswered.
- **Consequence.** Stores can show installed with no field job, or jobs completed while the store reads uninstalled. Billing and payout eligibility rest on the less objective record.
- **Correction.** Decision D-03. Recommended: completing a job that names stores *proposes* installation for them, and the CSM confirms with one tap. A job without stores proposes nothing. Corrected WF-03 step 3a.

**GAP-B02 · Medium · D · WF-05, REQ-19** · *Confirmed*
- **Finding.** Approved overtime stops at APPROVED. It has no rates, no pay rules (#26 open), no export and no month-end lock.
- **Consequence.** The register cannot feed pay. Data is re-keyed elsewhere, or not used.
- **Correction.** Decision D-12. At minimum: a monthly overtime export per person (approved minutes, job and order) and a month lock (REQ-34).

**GAP-B03 · High · M · WF-06, SM-05, REQ-23** · *Confirmed*
- **Finding.** Nothing can follow a wrong payout. PAID and CLOSED have no reversal, no "payment failed or bounced" path, no recovery of an overpayment or duplicate, and no correction of the UTR.
- **Consequence.** A bounced UPI transfer stays PAID. A duplicate payout cannot be recorded as recovered. The paid totals in `orderMoney` and on the dashboard become wrong, permanently.
- **Correction.** New WF-10 and SM-05 transitions: `PAID → PAYMENT_PENDING` ("payment failed", CCM, reason, UTR cleared, history kept), and an "adjustment" event on PAID/CLOSED that records a recovery with amount and reference. Recovery mechanics are decision D-09.

**GAP-B04 · Medium · M · BR-23, WF-06 step 4** · *Confirmed*
- **Finding.** `paid_amount` may be lower than the amount asked, and no reason is required (`paymentMarkPaidSchema` makes `note` optional). The shortfall is never tracked. CLOSE then ends the request.
- **Consequence.** A requester is short-paid with no recorded reason and no way to claim the balance, except by raising a new request that reviewers cannot link to the first.
- **Correction.** When paid is less than asked, a note is mandatory and the shortfall is shown. The requester is told the shortfall in the PAYMENT_PAID message (BR-23 corrected).

**GAP-B05 · Medium · O · WF-01 step 5, BR-07** · *Confirmed*
- **Finding.** Each invoice holds one payment record. Instalments are entered by overwriting `amount_received` through "edit payment" (change log only).
- **Consequence.** No receipt-level history (dates and amounts of each instalment), which weakens collection follow-up and reconciliation.
- **Correction (optional).** An `InvoicePayment` child table (amount, date, mode, reference). The invoice's received amount becomes the sum.

**GAP-B06 · Medium · D · SM-01, BR-08** · *Confirmed*
- **Finding.** `Completed` is terminal, and force-close can be applied from any status. There is no reopen, so a wrong force-close can only be fixed in the database.
- **Consequence.** Operational errors are permanent. Revenue reports (REVENUE_STATUSES includes Completed) count a mistakenly closed order as realised.
- **Correction.** Decision D-04. Recommended: an Admin "Reopen" with a reason that restores the derived status (BR-31).

### A.3 Missing alternative paths, exceptions, retries, cancellations and recovery

**GAP-C01 · High · M · WF-08, REQ-04, REQ-16** · *Confirmed*
- **Finding.** Deactivating a field-staff member (`field-staff.controller.ts:121-136`) does not look at their future job slots, pending leave, pending overtime or open payment requests. The board and grid list only *active* staff (`work-jobs.controller.ts`, `dailyBoard` and `weeklyGrid`), so the person disappears while still booked.
- **Consequence.** Teams are silently short on site. Pending items assigned to that person never resolve.
- **Correction.** Deactivation shows what the person still has open and requires a choice: remove them from future jobs (the team and CSM are told), cancel pending leave and overtime, and leave open payment requests to the Admin. The board and grid still show deactivated people who have bookings, flagged (WF-08 corrected, BR-32).

**GAP-C02 · Medium · M · WF-08, REQ-03** · *Confirmed*
- **Finding.** The super admin can change any user's role (`users.controller.ts:225`, `updateUser`) with no check on history. A Paster changed to CSM keeps future job slots (with a stale `slot_role`). Their open payment requests stay attached to a role that can no longer raise on those orders.
- **Consequence.** The data is inconsistent, and the team-limit rules are invalid for the jobs concerned.
- **Correction.** Refuse a role change across the field and non-field boundary while the person has future job slots or open requests. List them, as in GAP-C01 (BR-32).

**GAP-C03 · Medium · M · WF-06, SM-05** · *Confirmed*
- **Finding.** When a requester is deactivated: an INFO_REQUESTED request can only be resubmitted by them, so it waits until an Admin cancels it. A PAYMENT_PENDING request still pays them. Nothing is flagged.
- **Consequence.** Requests are stuck, or money goes to a leaver with no deliberate decision.
- **Correction.** Deactivation lists open requests (GAP-C01). Open requests of inactive requesters are flagged "requester inactive" in the reviewer lists, and CCM must confirm before marking such a request paid.

**GAP-C04 · Medium · M · WF-04, SM-03** · *Confirmed*
- **Finding.** Pending leave never expires. `decideLeave` does not check dates, so a request whose days have passed can still be approved or rejected weeks later. Nobody is reminded.
- **Consequence.** The leave register is wrong after the fact, and attendance disputes follow.
- **Correction.** Requests still pending on their start date are highlighted and added to the decider's daily digest. Deciding after the start date requires a note (BR-33).

**GAP-C05 · Medium · O · WF-04** · *Confirmed*
- **Finding.** "Save anyway" or "approve anyway" leaves the person on jobs during their leave. Only the board flags it. The job's CSM and the team are not told.
- **Consequence.** A team expects someone who will not come.
- **Correction (optional).** After saving with clashes, offer "remove from these jobs" in the same step, or notify the job's CSM and creator.

**GAP-C06 · High · D · BR-08, SM-01, open #10** · *Confirmed*
- **Finding.** Close and force-close do not look at open field jobs or open payment requests (`orders.controller.ts:1328`, `closeOrder`; `:1477`, `forceCloseOrder`). Force-close also works on Active orders with items still in production.
- **Consequence.** An order is "Completed" while a team is still booked on it and requests are still being paid against it. Production items vanish from the PRODUCTION view, which shows only Active orders (`getOrder`, `orders.controller.ts:170-178`).
- **Correction.** Decision D-04. Recommended: close and force-close list the open jobs, open requests and unfinished production, and require them resolved or explicitly acknowledged with a reason (BR-08 corrected).

**GAP-C07 · High · M · BR-22, SM-05** · *Confirmed*
- **Finding.** An Admin may cancel a PAYMENT_PENDING request (`payment-workflow.ts`, the CANCEL rule). That is the stage in which CCM is making the bank transfer outside the system.
- **Consequence.** Money is sent on a request that is now CANCELLED. MARK_PAID is no longer possible, so the payout can never be recorded (and see GAP-B03).
- **Correction.** Remove the Admin's cancel from PAYMENT_PENDING. The Admin instead "asks CCM to hold", and CCM either returns it to CCM_REVIEW or cancels. Corrected BR-22 and SM-05.

**GAP-C08 · Low · D · WF-03, BR-10** · *Confirmed*
- **Finding.** A field job can be created on an order in any status, including PaymentReceived and Completed (`resolveJobInput` does not check order status).
- **Consequence.** This may be intended (rectification work), but field staff on such jobs can no longer raise payment requests (BR-18), and nobody is warned.
- **Correction.** Decision D-11 (part of 2a): allow, but show "order is closed; payment requests not possible" when creating the job.

### A.4 Conflicting or ambiguous business rules

**GAP-D01 · Critical · M · BR-20, BR-23, decision 13** · *Confirmed*
- **Finding.** Decision 13 says that with "bill details = Yes", bills and photos are **mandatory**. The code requires a bill only at **CLOSE**, which comes after payment (`payment-workflow.ts`, the CLOSE rule's `blockedBy`). APPROVE and MARK_PAID have no bill check. The requester also chooses the route: answering "Yes" skips Admin review entirely.
- **Consequence.** A requester can pick the lighter route by promising a bill, be approved and paid by a single CCM, and never supply the bill. The request then sits in PAID with a "bill missing" timer. The control the bill choice was meant to provide is bypassed.
- **Correction.** On a CCM_ONLY request, at least one live BILL is required before CCM approval (BR-20 corrected). Optional extra (D-05): if no bill is attached within N working days of submission, the request reroutes to Admin review.

**GAP-D02 · High · M · BR-21, decision F "Return for info"** · *Confirmed*
- **Finding.** On resubmit, the requester may change the **amount** and the **payee UPI** (`transition`, the RESUBMIT branch), and the request returns to the stage that returned it. If CCM returns an ADMIN_THEN_CCM request, the Admin never sees the increased amount or the new payee.
- **Consequence.** Admin approval is bypassed for the parts that matter most.
- **Correction.** A *material change* (amount up, or payee changed) on resubmit restarts the request at its route's first stage. Non-material changes (purpose, category, remarks, amount down) keep the current rule. Corrected BR-21.

**GAP-D03 · High · M · BR-05, BR-18** · *Confirmed*
- **Finding.** "No item is assigned to production" is read as "nothing needs production". A brand-new order is therefore immediately **billable** (BR-05, `storeBillingBlocker`) and **open to payment requests** (BR-18, `paymentEligibility`: "No items are tracked through production, so the order is open"), before the Production Manager has acted at all.
- **Consequence.** Payouts and invoices can happen before any work exists. The eligibility rule does not mean what decisions 6–9 intended.
- **Correction.** Make "needs production" explicit. Each item (or the order) carries a `production_required` flag set when the order is created. An order with required production is not eligible until that production is done. Corrected BR-05 and BR-18. Default for existing data: decision D-02.

**GAP-D04 · Low · M · BR-09** · *Confirmed*
- **Finding.** The delete error says "Cancel or move those jobs before deleting", but `WorkJob.order_id` is `ON DELETE RESTRICT` whatever the job's status, so cancelled jobs still block. Separately, *any* Prisma `P2003` is reported as "this order has field jobs" (`orders.controller.ts:975-977`).
- **Consequence.** Users get advice that cannot work, and other foreign-key failures are misdiagnosed.
- **Correction.** Corrected BR-09 (see also GAP-F01). Reword the message to "orders with field jobs cannot be deleted", and map only the WorkJob constraint name.

**GAP-D05 · Medium · M · BR-01, NFR-03** · *Plausible*
- **Finding.** The FY code uses the server's local month (`order-sequence.ts`, `deriveYY` calls `new Date().getMonth()`). Every other date rule in the system uses explicit IST. On a UTC host, orders created on 1 April between 00:00 and 05:30 IST get the previous year's code.
- **Consequence.** The order number's year is wrong for 5½ hours each year. The FY reports then disagree with the number.
- **Correction.** Compute the FY in IST, explicitly (BR-01 corrected).

**GAP-D06 · Low · D · BR-26, A-03** · *Confirmed*
- **Finding.** "Working day" excludes Sundays only. Public holidays count. That is the baseline's assumption A-03, but nobody has decided it.
- **Consequence.** Overdue flags fire over Diwali and similar holidays.
- **Correction.** Decision D-10. If holidays are excluded: a holiday list in settings, read by `workingDaysBetween` and the order TAT report alike.

### A.5 Invalid or incomplete state transitions

**GAP-E01 · High · M · SM-02, SM-03, SM-04, NFR-05** · *Confirmed*
- **Finding.** Payment transitions are guarded: the update includes the status that was read. Jobs, leave and overtime are not. `setJobStatus` and `myJobStatus` update `where { id }` after reading (`work-jobs.controller.ts:458, 690, 695`). `decideLeave` and `withdrawMyLeave` do the same. `decideOvertime` checks and then updates by id alone.
- **Consequence.** A manager's CANCEL and a field member's COMPLETE, sent together, both succeed, and the last write wins (for example, a "cancelled" job reads Completed, or the reverse). Leave can end up both withdrawn and approved.
- **Correction.** Every status write includes the expected current status in its WHERE and returns 409 when the row has moved. Corrected NFR-05 and SM-02/03/04.

**GAP-E02 · Medium · M · SM-01** · *Confirmed*
- **Finding.** The baseline's order state machine is incomplete. `deriveStatus` also produces: Active → BillingCompleted or Pending directly (stores without production skip installation); BillingCompleted or Pending → Installed (an edit removes a store from an invoice); PaymentReceived → Pending (a payment edited down).
- **Consequence.** The tests and reports designed from the baseline miss real transitions.
- **Correction.** Corrected SM-01 below.

**GAP-E03 · Medium · M · SM-04, BR-16** · *Confirmed*
- **Finding.** Overtime decisions cannot be changed. A wrong approval or rejection is permanent (`updateOvertime` and `deleteOvertime` accept PENDING entries only).
- **Consequence.** Errors have to be fixed in the database, outside the audit trail's intent.
- **Correction.** Admin "Revoke decision" with a reason returns the entry to PENDING, history kept. It is refused for months locked under D-12.

**GAP-E04 · Low · O · SM-02** · *Confirmed*
- **Finding.** HOLD and reopen (COMPLETED → STARTED) take no reason. Reopening is allowed even after payment requests on that job have closed.
- **Correction (optional).** Require a reason for hold and reopen, shown to the CSM.

### A.6 Data entities, relationships and validations

**GAP-F01 · High · M · BR-09, REQ-12, E-06/E-07** · *Confirmed*
- **Finding.** Any Admin (not only the super admin) can hard-delete an order that has invoices and recorded customer payments, provided it has no change-log rows, jobs or payment requests. `Invoice` cascades with the order. Only *edits* write the change log; `createInvoice` and `recordInvoicePayment` do not. Evidence: `orders.controller.ts:959-985`, schema `Invoice.order onDelete: Cascade`. The "guard" is an accidental side-effect of `OrderChangeLog` having no cascade.
- **Consequence.** Billed revenue and payment records can be erased. Only the audit-trigger JSON keeps them.
- **Correction.** Corrected BR-09: an order may be deleted only while it has no invoices and no installed stores (in practice, Active and untouched), and only by the super admin. All other removals use force-close. Make the guard explicit in code rather than relying on foreign keys.

**GAP-F02 · Medium · M · BR-06, BR-07, NFR-05** · *Plausible*
- **Finding.** `createInvoice` and `recordInvoicePayment` check that a store is uninvoiced and that payment is not yet recorded **before** opening the transaction, then write without re-checking.
- **Consequence.** Two accountants acting at once can put one store on two invoices, or overwrite a recorded payment.
- **Correction.** Re-check inside the transaction: `updateMany where invoice_id IS NULL` with a count check, and `where amount_received IS NULL` for payments.

**GAP-F03 · Medium · D · E-17, BR-19** · *Confirmed*
- **Finding.** "The requester is the payee", but the UPI ID or mobile is free text. No payee name is captured, nothing ties it to the requester's profile, and it can change at every resubmit.
- **Consequence.** Money can be directed to any account, and CCM cannot tell from the screen.
- **Correction.** Decision D-06. Recommended: a saved, verified payout handle on the user's profile (set by Admin or OM, changes audited and notified). Requests default to it, and a different payee needs a reason and Admin review.

**GAP-F04 · Medium · M · BR-25** · *Confirmed*
- **Finding.** The person who added a file can remove it while the request is open, including in PAYMENT_PENDING and PAID (`payment-files.ts`, `canRemoveFile`). So the evidence an approval rested on can be withdrawn after the approval.
- **Consequence.** The audit trail shows the file was removed, but reviewers acted on evidence that is no longer attached.
- **Correction.** After the first approval, requesters may *add* files but not remove them. Reviewers may remove, with a note (BR-25 corrected).

**GAP-F05 · Medium · D · BR-24, open #19** · *Confirmed*
- **Finding.** There is no per-request ceiling and no approval threshold. The amount validator allows up to ₹99,999,999.99 (`validators.ts:429-433`).
- **Consequence.** One CCM can approve and pay any amount on the bill route.
- **Correction.** Decision D-07. Recommended: above a configurable amount (settings), the request needs Admin review whatever the route.

**GAP-F06 · Low · O · E-19, INT-04** · *Confirmed*
- **Finding.** Attachment bytes live in Postgres: up to 10 × 5 MB per request.
- **Consequence.** The database and its backups grow quickly. The R2 move is already designed behind `FileStore`.
- **Correction (optional).** Switch new uploads to R2 once keys exist. Add a size dashboard.

**GAP-F07 · Low · O · E-14** · *Confirmed*
- **Finding.** `WorkJobStore` cascades when a store is deleted, so a job's store scope shrinks silently.
- **Correction (optional).** Refuse to delete a store that a non-cancelled job names.

**GAP-F08 · Low · M · §8 Data model** · *Confirmed*
- **Finding.** The baseline lists entities but not field validations (lengths, formats, ranges), so test cases cannot be derived from it.
- **Correction.** Validation table added in corrected §8.

### A.7 Authorisation gaps and privilege escalation

**GAP-G01 · High · M · REQ-01/02, M-01** · *Confirmed*
- **Finding.** A JWT stays valid for 7 days after a password change or an admin reset. `authenticate` checks only `is_active` and the role. Logout only clears the cookie.
- **Consequence.** A stolen session survives the password reset meant to end it.
- **Correction.** Add `User.session_version`. It is bumped on password change, reset, role change and deactivation, embedded in the token and compared in `authenticate`. Add a "sign out everywhere" button for the user and the super admin (REQ-35).

**GAP-G02 · High · M · F-06, WF-06** · *Confirmed capability; abuse inferred*
- **Finding.** OM (and Admin) can reset any field member's password (`field-staff.controller.ts:139-155`), log in as them, and raise payment requests in their name on orders of their jobs. With GAP-D01 and GAP-F03, the payee can be any UPI ID, and the request reaches a single CCM.
- **Consequence.** A manager could extract payouts under a field member's name. The audit log records the reset, but nothing alerts the member.
- **Correction.** On any admin password reset: the user is told on WhatsApp, the reset password must be changed at first login (`must_change_password`), and the reset is shown on the user's record (BR-34). GAP-F03 closes the payee half.

**GAP-G03 · Low · O · F-01** · *Confirmed*
- **Finding.** Login is rate-limited per IP only, with no per-account throttle. The "account is inactive" message appears only *after* a correct password, which confirms the credentials. Unknown users skip bcrypt, a timing difference that reveals which usernames exist.
- **Correction (optional).** Add a per-username throttle, a constant-time path, and check `is_active` without revealing whether the password was valid.

**GAP-G04 · High · D · BR-20, BR-23** · *Confirmed*
- **Finding.** On the CCM_ONLY route, one CCM approves, marks paid and closes, so no second person ever touches the payout. Together with GAP-D01, the only control left is the requester's own answer.
- **Consequence.** No segregation of duties on the money-out path.
- **Correction.** Decision D-05. Options: (a) the bill required before approval (GAP-D01), plus a threshold (GAP-F05); or (b) a second CCM or the Admin marks paid. Recommended: (a).

### A.8 Unhandled API, database, notification and third-party failures

**GAP-H01 · Medium · M · WF-07, BR-27** · *Confirmed*
- **Finding.** Notifications run in three consistency modes. Payments write in-app and WhatsApp rows **inside** the business transaction, so a notification insert failure rolls back the approval. Jobs, leave and overtime write **after** commit, and errors are swallowed (`notifyPeople`, `.catch(() => {})`). Emails are fire-and-forget, with no record.
- **Consequence.** Job, leave and overtime notifications can be lost with no trace. A payment approval can fail because of a notification-table problem.
- **Correction.** One rule (BR-35): notification rows are written in the business transaction everywhere (they are cheap local inserts). External sends (WhatsApp, email) go only through the outbox, after commit. Email joins the outbox as a channel.

**GAP-H02 · Medium · M · INT-02, INT-03, A-02** · *Confirmed*
- **Finding.** The sender and the digest are `setInterval`s inside the API process. If Render idles or restarts the instance, they stop. With more than one instance, the digest's "already sent today" check is read-then-insert, not atomic. The WhatsApp lease gives *at-least-once* delivery: a crash after AskEva accepts a message re-sends it 5 minutes later.
- **Consequence.** Missed or duplicate digests, occasional duplicate WhatsApp messages, and silent stops while the instance sleeps.
- **Correction.** Document at-least-once delivery as intended (BR-27 corrected). Make the digest idempotent with a unique `(user, digest_date)` row. Add a heartbeat (last sender pass, last digest) to `/health/ready`, and alert when it is stale (REQ-36).

**GAP-H03 · Medium · M (before WhatsApp go-live) · INT-01/02** · *Confirmed*
- **Finding.** Nothing alerts anyone to: FAILED WhatsApp messages piling up, SMTP not configured (a console warning only), or the webhook secret missing (the webhook returns 503 and messages stop at SENT for ever).
- **Consequence.** The channel fails quietly, and people think notifications are reaching staff.
- **Correction.** An Admin dashboard health card: SMTP set, WhatsApp mode, webhook secret set, FAILED in the last 24 h, oldest QUEUED. A daily in-app alert when failures exceed a threshold (REQ-36).

**GAP-H04 · High · M (dependency) · INT-02** · *Confirmed (decisions log, Phase G2)*
- **Finding.** AskEva's API documentation was offline. The token placement, the reply's message-id field, the webhook payload and signing, and the rate limits are all **unconfirmed**. Templates must be approved by Meta before sending.
- **Consequence.** Going live is blocked, or it fails in production in ways the log-only mode cannot reveal.
- **Correction.** A go-live checklist (§C.3): confirm the contract with AskEva, get templates approved, run one end-to-end message per template on a test number, then switch to `live`.

**GAP-H05 · Low · O · INT-01** · *Confirmed*
- **Finding.** Order emails leave no record of whether they were sent, and failures are not retried.
- **Correction (optional).** Covered by sending email through the outbox (GAP-H01).

**GAP-H06 · Low · O · §9** · *Confirmed*
- **Finding.** Unexpected errors return a generic 500 with no correlation ID, so support cannot match a user's report to a log line.
- **Correction (optional).** Add a request ID header, include it in the error body, and log it.

### A.9 Missing tests and broken traceability

**GAP-I01 · Critical · M · §13, §14** · *Confirmed*
- **Finding.** The repository has **no automated tests** and no test runner: no test files, and no `test` script in any `package.json`. The discovery plan's exit criteria are unmet: Phase F's "every transition covered by tests, including unauthorised ones" and Phase C's "double-booking rejected under concurrent requests". Every row of the baseline RTM ends in "manual".
- **Consequence.** None of the corrections in this review can be made safely. Regressions in derivation, permissions or payouts go unnoticed until users see them.
- **Correction.** Corrected §13 defines the test suites and cases, and the corrected §14 links each requirement to them. Set up a runner (Vitest for the pure rules; Supertest against a disposable Postgres for API and concurrency) before changing workflow code.

**GAP-I02 · High · M · NFR-06** · *Confirmed*
- **Finding.** There is no CI gate. The API has only `build`, and nothing typechecks or tests on push. Migrations are applied by hand and production deploys do not run them, so code can ship ahead of the schema.
- **Consequence.** Schema drift between code and database, and errors found in production.
- **Correction.** A CI workflow (typecheck the API and web, run the tests, run `prisma migrate diff` against the migrations folder). Add a deploy checklist step: `prisma migrate status` must be clean (REQ-37).

**GAP-I03 · Medium · M · §12, §14** · *Confirmed*
- **Finding.** The baseline's requirements have no acceptance criteria and no negative cases. The NFRs are not traced at all.
- **Correction.** Corrected §12 adds acceptance criteria to the new requirements, and corrected §14 traces NFRs.

### A.10 Hidden assumptions, unnecessary complexity and blocking dependencies

**GAP-J01 · Low · O · NFR-03** · *Confirmed*
- **Finding.** IST day arithmetic is implemented separately in `work-allocation.ts`, `payment-timers.ts`, `payment-reminders.ts` and the order TAT report. `order-sequence.ts` uses server time instead.
- **Consequence.** Rules drift, as GAP-D05 already shows.
- **Correction (optional).** One `ist.ts` module used everywhere.

**GAP-J02 · Low · O · E-12, E-17** · *Confirmed*
- **Finding.** The legacy `job_no` and `request_no` columns and the two unused sequences remain.
- **Correction (optional).** Keep them for search. Drop the sequences in a later cleanup migration.

**GAP-J03 · Medium · D · §1 scope (2a), REQ-16** · *Confirmed*
- **Finding.** Work with no billable order (recces, rectifications, events) stays outside the portal, yet it uses the same people. The board's "free" counts and the double-booking checks cannot see it.
- **Consequence.** People shown as free are actually out. Double booking happens in reality while the system reports none.
- **Correction.** Decision D-11. The lightest option: an "unavailable" block per person and day (reason: recce, event), which counts as busy, without needing an order.

**GAP-J04 · Low · O · BR-28** · *Confirmed*
- **Finding.** Phone numbers are not unique. A STOP reply opts out *every* user with that number, and a shared number receives other people's messages.
- **Correction (optional).** Warn when two active users share a number.

**GAP-J05 · Medium · O · R-01a** · *Confirmed*
- **Finding.** The super admin is a single account. User creation, role changes, password resets and bulk import all depend on it.
- **Correction (optional).** Allow two super admins, or keep a documented break-glass procedure.

---

## Part B: Corrected sections (v1.1)

Only the affected sections are reproduced. IDs from v1.0 are kept. New IDs continue each series. **[New]** marks additions, **[Changed]** marks rewrites, and `→ D-nn` marks wording that depends on a decision in §C.2. Each item is labelled **Built** or **Proposed (not built)**.

### §3.2 Permission matrix: corrected rows

| Function | ADMIN | OM | CSM | ACC | PM | PROD | CCM | Field | Status |
|---|---|---|---|---|---|---|---|---|---|
| Own profile, password, notification read-state **[Changed]** | W | **W** | W | W | W | W | W | W | Proposed (GAP-A01) |
| Export, email export **[Changed]** | W | W (email allowed) | W | W | – | – | – | – | Proposed (GAP-A02) |
| Users: delete, activate/deactivate **[Changed]** | super only | – | – | – | – | – | – | – | Proposed (GAP-A03) |
| Orders: delete **[Changed]** | super only, untouched orders | – | – | – | – | – | – | – | Proposed (GAP-F01) |
| Orders: reassign owner **[New]** | W | – | – | – | – | – | – | – | Proposed (GAP-A04) |
| Orders: reopen Completed **[New]** | W → D-04 | – | – | – | – | – | – | – | Proposed (GAP-B06) |
| Payment requests: cancel **[Changed]** | any *not yet approved by CCM* | – | own, before approval | – | – | – | **PAYMENT_PENDING** (with reason) | own, before approval | Proposed (GAP-C07) |
| Payment requests: act at CCM stage | only when no CCM is active (D-05) | – | – | – | – | – | W | – | Proposed (GAP-A05) |
| Payment requests: mark failed / adjustment | – | – | – | – | – | – | – | – | Dropped (D-09: handled outside the system) |
| Payout register export **[New]** | R | – | – | → D-08 | – | – | R | – | Proposed (GAP-A06) |
| Overtime: revoke decision **[New]** | W | – | – | – | – | – | – | – | Proposed (GAP-E03) |
| Leave requests: notified **[Changed]** | yes | yes | – | – | – | – | – | – | Proposed (GAP-A07) |
| Sign out everywhere **[New]** | own + super for all | own | own | own | own | own | own | own | Proposed (GAP-G01) |

**Enforcement [Changed].** `denyReadOnlyMutations` blocks OM writes to *business records*. Its allow-list is: own profile and password, own notification read-state, email export, and the work-allocation routers.

### §5 Business rules: changed and new

| ID | Rule (v1.1) | Status | Fixes |
|---|---|---|---|
| BR-01 **[Changed]** | The FY code is computed in IST: 1 April 00:00 IST begins the new code. | Proposed | GAP-D05 |
| BR-05 **[Changed]** | A store is billable when every item that *requires production* is production-complete, and, if any does, the store is installed. Whether an item requires production is set explicitly when the order is created (`production_required`, default per D-02), not inferred from assignments. | Proposed | GAP-D03 |
| BR-08 **[Changed]** | Close (from Pending) and force-close (any status) first list open field jobs, open payment requests and unfinished production. The Admin must resolve them or acknowledge them with a reason. → D-04 | Proposed | GAP-C06 |
| BR-09 **[Changed]** | Only the super admin may delete an order, and only while it has no invoices, no installed stores, no jobs (any status) and no payment requests. This is checked explicitly, not through foreign-key errors. Any other order is closed, not deleted. | Proposed | GAP-F01, GAP-D04 |
| BR-18 **[Changed]** | An order is open to new payment requests when every item that requires production is complete, or the order is Installed. It closes at the first invoice. An order whose items require no production is open from creation (→ D-02). | Proposed | GAP-D03 |
| BR-20 **[Changed]** | Route: "Bill details = No" → Admin review, then CCM review. "Yes" → CCM review only, and **CCM cannot approve until at least one live bill is attached**. A request over the approval threshold (→ D-07) always starts at Admin review. | Proposed | GAP-D01, GAP-F05 |
| BR-21 **[Changed]** | Approve, reject and return work as before. On resubmit, a **material change** (amount increased, or payee changed) restarts the request at its route's first stage. Other changes return it to the stage that returned it. | Proposed | GAP-D02 |
| BR-22 **[Changed]** | The requester may cancel at the first stage or while returned. The Admin may cancel in ADMIN_REVIEW, CCM_REVIEW or INFO_REQUESTED, with a reason. Only CCM may cancel in PAYMENT_PENDING, with a reason. | Proposed | GAP-C07 |
| BR-23 **[Changed]** | Only CCM marks paid (UTR required; paid ≤ asked) and closes. **When paid < asked, a note is required**, and the shortfall is recorded and told to the requester. A bill-details request cannot close without a live bill. | Proposed | GAP-B04 |
| BR-25 **[Changed]** | File rules are unchanged, with one addition: after the request's first approval, the requester can add files but not remove them. Reviewers remove with a note. | Proposed | GAP-F04 |
| BR-27 **[Changed]** | WhatsApp delivery is **at least once**: a crash during sending may repeat a message, which is accepted. Messages never block business work. | Built (now documented) | GAP-H02 |
| BR-29 **[New]** | Read-only (OM) means no writes to business records. Self-service is always allowed. | Proposed | GAP-A01, GAP-A02 |
| BR-30 **[New]** | The last active user holding ADMIN, or COST_CONTROL_MANAGER, cannot be deactivated or have their role changed. | Proposed | GAP-A03, GAP-A05 |
| BR-31 **[New]** | A Completed order can be reopened by the Admin with a reason. Its status is then re-derived. → D-04 | Decision | GAP-B06 |
| BR-32 **[New]** | Deactivating a user, or changing their role across the field and non-field boundary, first lists their future job slots, pending leave and overtime, and open payment requests. The super admin or manager must resolve each item (or the system does, by default: remove from future jobs, cancel pending leave and overtime) before the change saves. | Proposed | GAP-C01, GAP-C02, GAP-C03 |
| BR-33 **[New]** | A leave request still pending on its first day is flagged and added to the deciders' daily digest. Deciding after the first day requires a note. | Proposed | GAP-C04 |
| BR-34 **[New]** | An admin or manager password reset forces a change at next login, bumps the session version, and notifies the user (in-app and WhatsApp). | Proposed | GAP-G01, GAP-G02 |
| BR-35 **[New]** | In-app notification rows are written in the same transaction as the business change, in every module. External channels (WhatsApp, email) are queued in that transaction and sent after commit. | Proposed | GAP-H01 |
| BR-36 **[New]** | Every status change (jobs, leave, overtime, invoices, payments) is conditional on the status that was read. A lost race returns 409 "changed by someone else". | Proposed | GAP-E01, GAP-F02 |

### §6 Workflows: corrected

#### WF-03 Field job **[Changed]**

Main path (built): create → notify team and CSM → a member Starts (on or after the start date) → a member Completes → notify CSM and creator.

| Step | Alternative or exception path | Handling (v1.1) | Status |
|---|---|---|---|
| Create | A team member is on approved leave | 409 listing the clashes; "Allow 2nd job" does not override | Built |
| Create | Overlapping job, with no "Allow 2nd job" | 409 listing the clashes; the DB constraint backs it under concurrency | Built |
| Create | The order is PaymentReceived or Completed | Warn "payment requests not possible on this order" → D-11 | Proposed (GAP-C08) |
| Create | Work with no order (recce, event) | Out of scope; optional "unavailable" day block → D-11 | Decision (GAP-J03) |
| Start/complete | A manager changes the status at the same moment | Conditional update; the loser gets 409 and reloads | Proposed (GAP-E01) |
| Complete (3a) | The job names stores | Propose "mark these stores installed" to the CSM, who confirms → D-03 | Decision (GAP-B01) |
| Hold, reopen | – | A reason is required and shown to the CSM | Optional (GAP-E04) |
| Cancel | – | A reason is required; the team is freed and notified | Built |
| A team member is deactivated | – | Handled by WF-08 (BR-32) | Proposed (GAP-C01) |
| Notification failure | – | In-app rows in the transaction; WhatsApp via outbox (BR-35) | Proposed (GAP-H01) |

#### WF-04 Leave **[Changed]**

| Path | Handling (v1.1) | Status |
|---|---|---|
| Request (field) | From today onwards, a reason is required, no overlap with own live leave → PENDING. **Admin and OM** are notified, in-app and on WhatsApp | Proposed (GAP-A07) |
| Decide | Conditional on PENDING (BR-36). Approving over jobs needs "approve anyway"; then offer "remove from those jobs" or notify the job's CSM | Proposed (GAP-E01, GAP-C05) |
| Still pending at the start date | Flagged, added to the digest; deciding late needs a note (BR-33) | Proposed (GAP-C04) |
| Withdraw (field) | Only while PENDING; conditional update | Proposed (GAP-E01) |
| Cancel approved leave (manager) | A reason is required; the person is notified on WhatsApp too | Proposed (GAP-A07) |
| Recorded by a manager | Approved at once; "save anyway" over jobs as above | Built |

#### WF-06 Payment request **[Changed]**

| Step | Main path | Alternatives and exceptions (v1.1) | Status |
|---|---|---|---|
| 1 Pick order | Eligible orders first, with the reason when not eligible | Order needs production that is not done → not eligible (BR-18) | Proposed (GAP-D03) |
| 2 Enter | Amount, payee, purpose, category, bill choice | Payee defaults to the verified handle; a different payee needs a reason and Admin review → D-06 | Decision (GAP-F03) |
| 3 Submit | Idempotent; route fixed | Over the threshold → Admin review first (→ D-07). No active reviewer for the stage → warn, and alert the super admin | Proposed (GAP-F05, GAP-A05) |
| 4 Admin review | Approve / reject / return | Concurrent action → 409 (built) | Built |
| 5 CCM review | Approve / reject / return | **Bill route: approve blocked until a bill is attached** | Proposed (GAP-D01) |
| 6 Returned | Requester resubmits | Material change → back to the first stage (BR-21). Requester inactive → flagged, Admin cancels | Proposed (GAP-D02, GAP-C03) |
| 7 Payment pending | CCM pays outside the system | Only CCM may cancel here (BR-22). Requester inactive → CCM confirms first | Proposed (GAP-C07, GAP-C03) |
| 8 Mark paid | UTR, amount ≤ asked | Shortfall → note required, shown to the requester (BR-23) | Proposed (GAP-B04) |
| 9 Payment failed | – | Handled outside the system by the super admin, using the runbook (D-09) | Accepted risk (GAP-B03) |
| 10 Close | Bill present on the bill route | Files frozen for the requester after the first approval (BR-25) | Proposed (GAP-F04) |
| Any | – | Requester removed from the job → existing requests continue; new ones on that order blocked | Built (by query) |

#### WF-08 User lifecycle **[Changed]**

1. Create: the super admin creates staff; Admin or OM create field staff (built).
2. **Deactivate or role change [New].** Show open items (future job slots, pending leave and overtime, open payment requests, orders owned). Resolve each, or apply the defaults (BR-32). Refuse for the last active Admin or CCM (BR-30). Bump the session version.
3. **Password reset [Changed].** Force a change at next login, bump the session version, notify the user (BR-34).
4. **Order ownership [New].** Before deactivating a CSM, reassign their open orders (F-55). Their payment-request rights move with the orders.
5. Delete: only users with no history (built), and only by the super admin (GAP-A03).

#### WF-09 Order closure and deletion **[New]**

| Action | Who | Preconditions (v1.1) | Effect |
|---|---|---|---|
| Delete | super admin | No invoices, no installed stores, no jobs, no payment requests (BR-09) | Hard delete; audit row kept |
| Close | Admin | Status Pending; open jobs, requests and production listed and acknowledged (BR-08) | → Completed, with remark |
| Force-close | Admin | Any status; the same list, a reason required | → Completed, with remark |
| Reopen | Admin | Completed; a reason (→ D-04) | Status re-derived |

#### WF-10 Payout correction **[Dropped by D-09]**

Bounced transfers, wrong UTRs and recoveries are handled outside the system, through the super-admin runbook (§C.2). One part stays in the app: when a requester disputes a shortfall, they raise a new request linked to the original ("balance of …"), and reviewers see the link (`linked_request_id`, GAP-B04).

#### WF-11 Notification delivery and failure **[New]**

| Failure | Detection | Handling | Status |
|---|---|---|---|
| In-app insert fails | Transaction error | The business change rolls back with a 500 (BR-35), no silent loss | Proposed |
| AskEva 429, 5xx or timeout | Sender | Retry at 1, 5, 15 and 60 min, then FAILED | Built |
| AskEva 4xx (template or number) | Sender | FAILED at once with the reason; Admin "Send again" | Built |
| Process restarts mid-send | Lease expiry | Re-send (at-least-once, BR-27) | Built |
| Instance asleep, sender not running | Heartbeat in `/health/ready` | Uptime monitor alerts | Proposed (GAP-H02) |
| Webhook secret missing, SMTP missing, FAILED piling up | Admin health card and daily alert | Admin fixes the configuration | Proposed (GAP-H03) |
| Person has no number or opted out | Queue time | SKIPPED; in-app still delivered | Built |

### §7 State machines: corrected

**SM-01 Order [Changed]** (derived by `deriveStatus`; all transitions are built except reopen):

```
Active ─────────────► Installed        (all stores installed, not all invoiced)
Active ─────────────► BillingCompleted / Pending   (all stores invoiced; stores with no production skip installation)
Installed ──────────► BillingCompleted / Pending   (last store invoiced)
BillingCompleted ◄──► Pending          (short billing, part payment, edits)
BillingCompleted / Pending ─► Installed (a billing edit un-invoices a store)
BillingCompleted / Pending ─► PaymentReceived (every invoice settled in full)
PaymentReceived ────► Pending          (a payment edited down)
Pending ────────────► Completed        (close, BR-08)
any ────────────────► Completed        (force-close, BR-08)
Completed ──────────► (re-derived)     (reopen, BR-31, → D-04, Proposed)
```

**SM-02 WorkJob [Changed].** The transitions are unchanged. Every transition is now **conditional on the status read** (BR-36), and HOLD and reopen require a reason (optional, GAP-E04).

**SM-03 Leave [Changed].** `PENDING → APPROVED | REJECTED` (conditional, late decisions need a note); `PENDING → withdrawn` (requester, conditional); `APPROVED → cancelled` (manager, reason).

**SM-04 Overtime [Changed].** `PENDING → APPROVED | REJECTED` (conditional); **`APPROVED | REJECTED → PENDING` (Admin "revoke", reason; refused in a locked month, → D-12)**; PENDING may be deleted.

**SM-05 PaymentRequest [Changed]:**

```
SUBMIT ─► ADMIN_REVIEW  (route A, or route B over the threshold → D-07)
SUBMIT ─► CCM_REVIEW    (route B)
ADMIN_REVIEW ─approve─► CCM_REVIEW
CCM_REVIEW ─approve─► PAYMENT_PENDING          [route B: needs ≥1 live BILL]
ADMIN_REVIEW | CCM_REVIEW ─reject─► REJECTED   (reason)
ADMIN_REVIEW | CCM_REVIEW ─return─► INFO_REQUESTED (reason)
INFO_REQUESTED ─resubmit─► returned_from   (non-material change)
INFO_REQUESTED ─resubmit─► first stage     (material change: amount up or payee changed)
ADMIN_REVIEW | CCM_REVIEW | INFO_REQUESTED ─cancel─► CANCELLED (requester before approval; Admin with reason)
PAYMENT_PENDING ─cancel─► CANCELLED            (CCM only, reason)
PAYMENT_PENDING ─mark paid─► PAID              (UTR; shortfall needs a note)
PAID ─close─► CLOSED                           (route B: needs a live BILL)
```

Under D-09 there is no in-app transition out of PAID or CLOSED for payout errors; they are corrected outside the system.

### §8 Data model: corrections

**Schema deltas (all Proposed):**

| Entity | Change | Fixes |
|---|---|---|
| User | `session_version Int @default(0)`, `must_change_password Boolean @default(false)`, `payout_method` / `payout_handle` / `payout_verified_at` (→ D-06) | GAP-G01, GAP-G02, GAP-F03 |
| OrderItem | `production_required Boolean` (default per D-02) | GAP-D03 |
| Order | `reopened_at` / `reopened_by` / `reopen_reason` (→ D-04); owner change audited through the change log | GAP-B06, GAP-A04 |
| PaymentRequest | `shortfall_note String?`; `linked_request_id Int?` (balance requests) | GAP-B04, WF-10 |
| User (D-11) | "Unavailable" day block: a new `UnavailableDay` table (user, date, reason, created_by), counted as busy by the board, the grid and the clash checks | GAP-J03 |
| OvertimeEntry | revoke stamps (`revoked_at`, `revoked_by`, `revoke_reason`); month lock in `AppSetting` (→ D-12) | GAP-E03, GAP-B02 |
| DigestLog **[New]** | `(user_id, digest_date)` unique | GAP-H02 |
| AppSetting keys | `payment_admin_threshold` (→ D-07), `holidays` (→ D-10) | GAP-F05, GAP-D06 |

**Field validations [New]** (as built unless marked):

| Field | Rule |
|---|---|
| Password | ≥ 8 characters (create, reset, change) |
| Phone | Indian mobile 10 digits starting 6–9; stored `+91…`; or any E.164 |
| Payment amount | > 0, ≤ 99,999,999.99, at most 2 decimals |
| UPI ID | `name@bank`, lower-cased; **or** mobile, 10 digits starting 6–9 |
| Payment purpose | 3–300 chars; remarks ≤ 1000; notes ≤ 500; UTR 4–64 |
| Idempotency key | 8–100 chars, unique |
| Job | 1–5 members, distinct; ≤ 62 days; reason ≤ 300, required to cancel |
| Leave | ≤ 120 days per record; self-requests from today onwards; reason 2–300 for self-requests and cancellation |
| Overtime | `HH:MM`; start ≠ end; ≤ 5 people per entry; reason required to reject |
| Attachment | JPG, PNG, WEBP, HEIC or PDF by magic bytes; ≤ 5 MB; ≤ 10 live per request |
| Stores per order | ≤ 50; store name and location unique within the order |
| Payment overdue days | integer 1–90 |

### §10 Integrations: failure handling [Changed]

| ID | Failure mode | v1.0 behaviour | v1.1 behaviour |
|---|---|---|---|
| INT-01 SMTP | Not configured, or send error | Console warning; mail lost | Email through the outbox, with retries and a log; health card (GAP-H01, GAP-H03) |
| INT-02 AskEva | Contract unconfirmed | Log-only mode | Go-live checklist §C.3 (GAP-H04) |
| INT-02 AskEva | Crash mid-send | Possible duplicate | Accepted, documented (BR-27) |
| INT-03 Digest | Several instances or a restart | Read-then-insert dedupe | Unique `DigestLog` row (GAP-H02) |
| INT-04 DB | Unavailable | Generic 500; `/health/ready` 503 | Plus a request ID in errors (GAP-H06, optional) |
| INT-05 Render | Instance sleeps | Timers stop silently | Heartbeat in readiness; uptime alert (GAP-H02) |

### §11 Non-functional requirements: changed and new

| ID | Requirement (v1.1) | Status |
|---|---|---|
| NFR-05 **[Changed]** | Every status-changing write is conditional on the status read (BR-36), and booking constraints stay enforced in the DB. | Proposed |
| NFR-06 **[Changed]** | Migrations stay manual, but CI fails when `prisma migrate diff` shows code ahead of the migrations, and deploys check `migrate status`. | Proposed |
| NFR-07 **[New]** | Sessions are revocable within one request of a password change, reset, role change or deactivation. | Proposed |
| NFR-08 **[New]** | Automated tests run in CI on every push: pure-rule unit tests, an API permission matrix, concurrency tests. | Proposed |
| NFR-09 **[New]** | Background workers report a heartbeat. A stale heartbeat makes `/health/ready` fail. | Proposed |

### §12 Functional requirements: new and changed

| ID | Requirement | Acceptance criteria (abridged) | Fixes |
|---|---|---|---|
| REQ-02 **[Changed]** | Deactivated users, and users whose password or role changed, lose access on their next request | The old cookie returns 401 after a reset | GAP-G01 |
| REQ-12 **[Changed]** | Only untouched orders can be deleted, and only by the super admin | An invoiced order's delete returns 409 with the reason | GAP-F01 |
| REQ-21 **[Changed]** | Route B cannot be approved without a bill; requests over the threshold start at Admin | Approve with no bill → 409 | GAP-D01 |
| REQ-22 **[Changed]** | A material resubmit restarts at the first stage | CCM return + amount up → ADMIN_REVIEW | GAP-D02 |
| REQ-31 | The Admin can reassign an order's owner | The new owner can raise requests and confirm installation; the old owner cannot | GAP-A04 |
| REQ-32 | Payout register export (→ D-08 for Accounts) | Includes UTR, payee, order, category, paid date, adjustments | GAP-A06 |
| REQ-33 | Leave and overtime decisions reach field staff on WhatsApp; leave requests reach Admin and OM | Message rows exist for each decision | GAP-A07 |
| REQ-34 | Monthly overtime export and month lock (→ D-12) | A locked month refuses edits and revokes | GAP-B02 |
| REQ-35 | Sign out everywhere; forced password change after a reset | After a reset, login shows the change-password step | GAP-G01, GAP-G02 |
| REQ-36 | Health card and heartbeat for SMTP, WhatsApp, webhook and workers | A stale sender heartbeat → readiness 503 | GAP-H02, GAP-H03 |
| REQ-37 | CI gate: typecheck, tests, migration drift | A red pipeline blocks the merge | GAP-I02 |
| REQ-38 | Deactivation and role-change wizard (BR-32) | Cannot save while open items are unresolved | GAP-C01–C03 |
| REQ-39 | ~~Payout correction in the app~~. Dropped by D-09; replaced by a super-admin runbook in `docs/` | The runbook exists and names the fields and the history note | GAP-B03 |
| REQ-43 | "Unavailable" day block for off-order work (D-11) | A person marked unavailable is busy on the board and grid, and cannot be booked | GAP-J03 |
| REQ-44 | Holiday list in Settings used by every working-day count (D-10) | A holiday does not advance a payment timer | GAP-D06 |
| REQ-40 | Close, force-close and reopen with an open-items check (→ D-04) | Close lists open jobs and requests | GAP-C06, GAP-B06 |
| REQ-41 | Revoke an overtime decision | APPROVED → PENDING with a reason, notified | GAP-E03 |
| REQ-42 | Explicit production-required flag drives billing and eligibility (→ D-02) | A new order with required production is not eligible | GAP-D03 |

### §13 Test strategy and cases **[Changed]** (none exist today; all Proposed)

**Suites.** U = unit (Vitest, pure functions). A = API (Supertest against a disposable Postgres with migrations applied). C = concurrency (parallel requests against A). E = end-to-end (Playwright, one browser run per portal).

| TC | Suite | Case | Covers |
|---|---|---|---|
| TC-01 | U | `deriveStatus` table: every SM-01 transition, including Active → BillingCompleted, PaymentReceived → Pending, re-invoicing back to Installed | REQ-10, SM-01, GAP-E02 |
| TC-02 | U | `paymentEligibility`: production-required unfinished, done, Installed, first invoice, no production required | REQ-20, BR-18, GAP-D03 |
| TC-03 | U | `checkTransition`: every action × every status × every role, including unauthorised ones (403) and wrong status (409) | REQ-21–23, SM-05 |
| TC-04 | U | Route B approve without a bill → blocked; with a bill → ok | GAP-D01 |
| TC-05 | U | Resubmit with amount up or payee changed → first stage; purpose only → the returning stage | GAP-D02 |
| TC-06 | U | Cancel: Admin in PAYMENT_PENDING → 403; CCM with a reason → ok | GAP-C07 |
| TC-07 | U | `paymentTimers`: each status timer, the bill timer, the threshold boundary (10 vs 11 days), Sundays skipped, holidays (→ D-10) | REQ-25, BR-26 |
| TC-08 | U | `overtimeSpan`: same day, past midnight, equal times refused | BR-15 |
| TC-09 | U | `teamLimitErrors`, `gridLabel`, `blocksCalendar` | BR-11 |
| TC-10 | U | `deriveYY` in IST at 31 Mar 23:59 and 1 Apr 00:01 IST | GAP-D05 |
| TC-11 | A | Permission matrix: each role × each route returns the expected 2xx/403 (generated from §3.2) | §3.2, GAP-A01–A03 |
| TC-12 | A | OM updates own profile and marks notifications read → 200 | GAP-A01 |
| TC-13 | A | Non-super Admin deactivates another Admin → 403 | GAP-A03 |
| TC-14 | A | Deactivating the last CCM → 409 | BR-30 |
| TC-15 | A | Old cookie after a password reset → 401 | GAP-G01 |
| TC-16 | A | Delete an invoiced order → 409; delete an untouched order (super) → 200 | GAP-F01 |
| TC-17 | A | Field staff read another person's job → 404; start before the start date → 400 | REQ-17, BR-17 |
| TC-18 | A | Requester sees only their own requests; CCM and Admin see all; OM → 403 | BR-19 |
| TC-19 | A | Payment on an ineligible order → 409 with the reason | REQ-20 |
| TC-20 | A | Idempotent submit: the same key twice → one row, `duplicate: true` | F-41 |
| TC-21 | A | Attachment: a renamed .exe → 415; 6 MB → 413; 11th file → 409; duplicate → 409 | BR-25 |
| TC-22 | A | Requester removes a bill after approval → 403 | GAP-F04 |
| TC-23 | A | Mark paid below the asked amount without a note → 400 | GAP-B04 |
| TC-24 | A | Dropped (D-09). Replacement: no API route can move a request out of PAID or CLOSED except CLOSE → 409 for every other action | SM-05 |
| TC-25 | A | Job create with a member on leave → 409; with an overlap → 409; "Allow 2nd job" → 201 | BR-12, BR-13 |
| TC-26 | A | Leave approve over jobs without acknowledge → 409; with → 200 | WF-04 |
| TC-27 | A | Leave decided after its start date without a note → 400 | GAP-C04 |
| TC-28 | A | Overtime revoke → PENDING; in a locked month → 409 | GAP-E03 |
| TC-29 | A | Deactivate field staff with future slots → 409 listing them; with resolution → slots removed, team notified | GAP-C01 |
| TC-30 | A | Close or force-close with an open job or request → requires acknowledgement | GAP-C06 |
| TC-31 | A | Invoice: bill > covered value → 400; store already invoiced → 409 | BR-06 |
| TC-32 | A | Store installed before production completes → 400 | BR-05 |
| TC-33 | A | Line-item edit or delete by a CSM → 403; adding after billing → 403 | BR-03 |
| TC-34 | A | Webhook without or with a wrong key → 403; no secret configured → 503; report moves only forward | INT-02 |
| TC-35 | A | WhatsApp: opted-out user → SKIPPED; invalid phone → SKIPPED; Admin resend → QUEUED | BR-28 |
| TC-36 | C | 2 parallel job creates booking the same person → exactly one 201 | BR-12, NFR-05 |
| TC-37 | C | Parallel job cancel (manager) and complete (field) → one 200, one 409 | GAP-E01 |
| TC-38 | C | Parallel approve by two CCMs → one 200, one 409 | NFR-05 |
| TC-39 | C | Parallel invoices covering the same store → one 201, one 409 | GAP-F02 |
| TC-40 | C | Leave approve and withdraw in parallel → one wins | GAP-E01 |
| TC-41 | C | Digest run twice at once → one notification per user | GAP-H02 |
| TC-42 | A | Sender: 429 → retried with backoff; 4xx → FAILED; 5 attempts → FAILED | WF-11 |
| TC-43 | E | Order → production → install → job → payment request (route A and B) → paid → close → invoice → payment received | WF-01, WF-03, WF-06 |
| TC-44 | E | Field portal at 375 px: My Work start and complete, request leave, raise a payment request with a photo | NFR-02, REQ-17 |
| TC-45 | A | Bulk import: one bad row → nothing imported; non-super → 403 | REQ-30 |
| TC-46 | A | FY rollover: the first order after 1 Apr IST → `ORD{YY+1}0013` | BR-01 |

### §14 Requirement traceability matrix **[Changed]**

Status key: **B** = built and matches the rule. **B\*** = built, but a gap changes it. **P** = proposed (not built). **D** = waits for a decision.

| REQ | BR | WF / SM | Tests | Gaps | Status |
|---|---|---|---|---|---|
| REQ-01 | BR-29 | WF-08 | TC-11, TC-12 | GAP-G03, GAP-A01 | B\* |
| REQ-02 | BR-34 | WF-08 | TC-15 | GAP-G01 | B\* |
| REQ-03 | BR-30, BR-32 | WF-08 | TC-11, TC-13, TC-14 | GAP-A03, GAP-A05, GAP-C02 | B\* |
| REQ-04 | BR-32, BR-34 | WF-08 | TC-11, TC-29 | GAP-C01, GAP-G02 | B\* |
| REQ-05 | BR-01 | WF-01 | TC-10, TC-46 | GAP-D05 | B\* |
| REQ-06 | BR-03 | WF-01 | TC-33 | – | B |
| REQ-07 | BR-05 | WF-02 | TC-01 | – | B |
| REQ-08 | BR-05 | WF-01, WF-03 | TC-32 | GAP-B01 | B\* / D |
| REQ-09 | BR-06, BR-07, BR-36 | WF-01 | TC-31, TC-39 | GAP-F02, GAP-B05 | B\* |
| REQ-10 | BR-02 | SM-01 | TC-01 | GAP-E02 | B |
| REQ-11 | BR-08 | WF-09, SM-01 | TC-30 | GAP-C06 | B\* / D |
| REQ-12 | BR-09 | WF-09 | TC-16 | GAP-F01, GAP-D04 | B\* |
| REQ-13 | – | – | TC-11 | GAP-A02 | B |
| REQ-14 | BR-10, BR-11 | WF-03, SM-02 | TC-09, TC-25 | GAP-C08, GAP-E04, GAP-F07 | B |
| REQ-15 | BR-12, BR-36 | WF-03 | TC-25, TC-36 | – | B |
| REQ-16 | BR-13 | WF-03 | TC-25 | GAP-C01, GAP-J03 | B\* / D |
| REQ-17 | BR-17, BR-36 | WF-03, SM-02 | TC-17, TC-37 | GAP-E01 | B\* |
| REQ-18 | BR-13, BR-14, BR-33 | WF-04, SM-03 | TC-26, TC-27, TC-40 | GAP-A07, GAP-C04, GAP-C05, GAP-E01 | B\* |
| REQ-19 | BR-15, BR-16 | WF-05, SM-04 | TC-08, TC-28 | GAP-B02, GAP-E03 | B\* / D |
| REQ-20 | BR-18, BR-19 | WF-06 | TC-02, TC-19, TC-20 | GAP-D03, GAP-F03 | B\* / D |
| REQ-21 | BR-20 | WF-06, SM-05 | TC-03, TC-04 | GAP-D01, GAP-F05, GAP-G04 | B\* |
| REQ-22 | BR-21, BR-22 | WF-06, SM-05 | TC-03, TC-05, TC-06, TC-38 | GAP-D02, GAP-C07 | B\* |
| REQ-23 | BR-23 | WF-06, SM-05 | TC-03, TC-23 | GAP-B04 | B\* |
| REQ-24 | BR-25 | WF-06 | TC-21, TC-22 | GAP-F04, GAP-F06 | B\* |
| REQ-25 | BR-26 | WF-06 | TC-07 | GAP-D06 | B |
| REQ-26 | BR-26 | INT-03 | TC-41 | GAP-H02 | B\* |
| REQ-27 | BR-35 | WF-07, WF-11 | TC-35 | GAP-H01 | B\* |
| REQ-28 | BR-27, BR-28 | WF-11, SM-06 | TC-34, TC-35, TC-42 | GAP-H02, GAP-H03, GAP-H04 | B\* |
| REQ-29 | – | – | TC-11 | – | B |
| REQ-30 | – | – | TC-45 | – | B |
| REQ-31 | – | WF-08 | TC-11 | GAP-A04 | P |
| REQ-32 | – | – | TC-11 | GAP-A06 | D |
| REQ-33 | BR-35 | WF-04, WF-05 | TC-35 | GAP-A07 | P |
| REQ-34 | – | WF-05 | TC-28 | GAP-B02 | D |
| REQ-35 | BR-34 | WF-08 | TC-15 | GAP-G01, GAP-G02 | P |
| REQ-36 | – | WF-11 | TC-42 | GAP-H02, GAP-H03 | P |
| REQ-37 | – | – | (pipeline) | GAP-I01, GAP-I02 | P |
| REQ-38 | BR-32 | WF-08 | TC-29 | GAP-C01–C03 | P |
| REQ-39 | – | WF-10 | TC-24 (replacement) | GAP-B03 | Dropped (D-09), accepted risk |
| REQ-43 | – | WF-03 | TC-25 | GAP-J03 | P |
| REQ-44 | BR-26 | – | TC-07 | GAP-D06 | P |
| REQ-40 | BR-08, BR-31 | WF-09 | TC-30 | GAP-C06, GAP-B06 | D |
| REQ-41 | – | SM-04 | TC-28 | GAP-E03 | P |
| REQ-42 | BR-05, BR-18 | WF-01, WF-06 | TC-02 | GAP-D03 | D |
| NFR-02 | – | – | TC-44 | – | B (manual) |
| NFR-05 | BR-36 | – | TC-36–TC-40 | GAP-E01, GAP-F02 | B\* |
| NFR-06 | – | – | (pipeline) | GAP-I02 | B\* |
| NFR-07 | BR-34 | – | TC-15 | GAP-G01 | P |
| NFR-08 | – | – | all | GAP-I01 | P |
| NFR-09 | – | WF-11 | TC-42 | GAP-H02 | P |

Every gap in Part A appears in at least one row above, with two exceptions. The optional hygiene items (GAP-H05, GAP-H06, GAP-J01, GAP-J02, GAP-J04, GAP-J05) have no requirement, on purpose. The documentation items (GAP-F08, GAP-I03) are resolved by this document itself: the §8 validation table, and the acceptance criteria in §12.

### §15 Completeness audit **[Changed]**

| Area | v1.0 rating | v1.1 rating | Why |
|---|---|---|---|
| Roles defined and guarded | Complete | **Partial** | OM self-service blocked (A01); peer deactivation by Admin (A03); no reviewer cover (A05) |
| Order to cash | Complete | **Partial** | Invoiced orders deletable (F01); unassigned = no production (D03); close ignores open work (C06); no reopen (B06) |
| Work allocation | Complete | **Partial** | Unguarded status races (E01); deactivation leaves ghost bookings (C01); installation not linked (B01) |
| Leave and overtime | Complete for registers | **Partial** | Stale pending leave (C04); irreversible overtime decisions (E03); no payroll output (B02) |
| Payment requests | Complete through close | **Partial, control gaps** | Bill-route bypass (D01); resubmit bypass (D02); unsafe cancel (C07); no correction path (B03) |
| Notifications | In-app complete | **Partial** | Lossy after-commit writes (H01); unmonitored channel (H03); AskEva unconfirmed (H04) |
| Security | not assessed | **Partial** | Non-revocable sessions (G01); reset-based impersonation (G02) |
| Data model and validations | not assessed | **Mostly complete** | Validations now listed (§8); payee unverified (F03) |
| Tests and traceability | Planned | **Missing** | No tests or CI (I01, I02); the RTM now points at the planned tests |
| Operations | not assessed | **Partial** | In-process workers without heartbeat (H02); manual migrations (I02) |

---

## Part C: Limits, uncertainties and decisions

### C.1 What this review did not cover

These scenarios are **not** claimed as covered:

- **Web UI behaviour beyond routing.** I checked role routing, the sidebar and the read-only flags. I did not walk every form's client-side validation, empty, error and loading state, or the offline behaviour on field phones.
- **Controllers read only in part.** `import.controller.ts` (bulk import), `dashboard.controller.ts` (KPI maths), `admin.controller.ts` (overdue, loss and FY reports) and the email templates. Their numbers were not verified.
- **Migration SQL.** Exclusion constraints and triggers were taken from comments and the decisions log, not read line by line. Audit-trigger coverage of the newer tables is unverified.
- **Runtime.** Nothing was executed. The *Plausible* findings (GAP-D05, GAP-F02) need a reproduction.
- **Performance and scale.** Unbounded reads (for example, the dashboard loading every open request) are fine at today's volume. They were not load-tested.
- **Backups, restore, retention and data-protection obligations** for staff phone numbers, UPI handles and bill images.
- **Production data.** Legacy rows (pre-installation-checkpoint orders, imported field staff) may violate the v1.1 rules, so migration back-fill rules are needed for D-02 and D-06.

### C.2 Decisions (taken 2026-10-22)

All twelve are decided. The `→ D-nn` markers in Part B now resolve to the **Decision** column below. Where a decision differs from my recommendation, the affected sections were changed to match it.

| ID | Question | Decision | Effect on v1.1 | Gaps |
|---|---|---|---|---|
| D-01 | Who may deactivate or delete non-field users? | **Super admin only** | As written (§3.2, BR-30) | GAP-A03 |
| D-02 | How is "needs production" set? | **Per item, default Yes.** Existing items: Yes if they were ever assigned, No otherwise | `OrderItem.production_required`; BR-05 and BR-18 as written; REQ-42 | GAP-D03 |
| D-03 | Does completing a job mark stores installed? (#23) | **Propose, the CSM confirms** | WF-03 step 3a as written | GAP-B01 |
| D-04 | Close with open work, and reopen? (#10) | **Acknowledge with a reason; the Admin can reopen with a reason** | BR-08, BR-31, WF-09, REQ-40 as written | GAP-C06, GAP-B06 |
| D-05 | Second safeguard on the bill route (#15) | **No preference given, so the recommendation applies:** a bill is required before CCM approval, plus the D-07 threshold. The Admin may act at the CCM stage only when no CCM is active | BR-20 as written; §3.2 "act at CCM stage" row | GAP-D01, GAP-G04, GAP-A05 |
| D-06 | Must the payee be the requester's? | **A verified handle on the profile.** A different payee needs a reason and Admin review | `User.payout_*` fields; WF-06 step 2 | GAP-F03 |
| D-07 | Approval threshold (#19) | **A setting, default ₹10,000** | `AppSetting.payment_admin_threshold` = 10000 | GAP-F05 |
| D-08 | Does Accounts see payouts? | **A read-only payout register** | REQ-32 includes Accounts | GAP-A06 |
| D-09 | How are payout errors handled? | **Outside the system** (differs from my recommendation) | WF-10, the new SM-05 correction transitions, `PaymentAdjustment`, REQ-39 and TC-24 are **dropped**. GAP-B03 becomes an accepted risk (see below) | GAP-B03 |
| D-10 | Do public holidays stop the clocks? | **A holiday list in Settings** | `AppSetting.holidays`, read by every working-day calculation | GAP-D06 |
| D-11 | Off-order work and jobs on closed orders (2a) | **An "Unavailable" day block.** Jobs on closed orders are allowed, with a warning | New "unavailable" record per person and day; it counts as busy | GAP-J03, GAP-C08 |
| D-12 | Overtime output (#26) | **Export plus month lock.** Pay rates later | REQ-34, REQ-41 as written | GAP-B02, GAP-E03 |

**Accepted risk from D-09 (GAP-B03).** A bounced transfer, a wrong UTR, or a duplicate payment or overpayment will stay recorded as paid in the app. The paid totals on the dashboards and in the payout register will then be wrong until someone fixes the database by hand. To keep that manageable:

- The fix is done only by the super admin, through a written runbook.
- Every database fix is recorded as a `PaymentRequestEvent` note, so the request's history still explains itself.

The runbook should be a short page in `docs/` saying which fields to change and what note to add.

Still open from the discovery document, and not resolved by this review: **#4** (meaning of the remaining CSM codes), **#32** (scheduled 9:30, 15:00 and 19:00 summaries), **#33** (migrating the workbook history).

### C.3 Dependencies that could block implementation

1. **Test harness first** (GAP-I01). Most corrections change workflow rules that have no tests today.
2. **AskEva contract and Meta template approval** (GAP-H04), before `WHATSAPP_MODE=live`.
3. **Hand-applied migrations** for the schema deltas in §8. Each needs a back-fill rule (D-02, D-06), and production deploys do not run them.
4. **R2 keys**, only if GAP-F06 is taken up.
5. **Decisions D-02, D-04 and D-05.** They change BR-05, BR-08, BR-18 and BR-20, which the derivation and eligibility logic depend on.

### C.4 Mandatory and optional at a glance

- **Mandatory (34):** A01, A02, A03, A04, A05, A07, B03, B04, C01, C02, C03, C04, C07, D01, D02, D03, D04, D05, E01, E02, E03, F01, F02, F04, F08, G01, G02, H01, H02, H03, H04, I01, I02, I03.
- **Optional (12):** B05, C05, E04, F06, F07, G03, H05, H06, J01, J02, J04, J05.
- **Needs your decision first (11):** A06, B01, B02, B06, C06, C08, D06, F03, F05, G04, J03.

Some mandatory items also have a part that depends on a decision. GAP-A05, for example, is mandatory, but whether the Admin may stand in for the CCM is D-05. In those cases the mandatory part can be built now, and the decision only shapes the rest.

### C.5 Fix log

**Batches 0–1 (2026-10-30, uncommitted).** These are the fixes that need no migration. Tests: 32 unit tests (`npm run test:unit`) and 25 API tests against a throwaway `<db>_test` database (`npm run test:api`).

| Issue | Status | What changed |
|---|---|---|
| I01 | Partly fixed | Vitest unit and API harness. Covers the payment workflow, permissions and concurrency. Jobs, leave and overtime have only race tests so far. |
| A01, A02 | Fixed | The Operation Manager can change their own profile and notifications and email the export. Business records stay read-only to them. |
| A03 | Fixed | Delete and deactivate are super admin only (D-01). The last active Admin or CCM can't be deleted, deactivated or moved to another role (BR-30). |
| A05 | Fixed | With no active CCM, the Admin approves at Cost Control review, cancels, pays and closes. The queue and notifications fall back to the Admin (D-05). |
| A07 | Partly fixed | Leave requests and withdrawals notify both Admin and OM. Leave and overtime decisions still send no WhatsApp. |
| B04 | Fixed | Paying less than asked needs a note. The shortfall goes into the request's history and the requester's notification. |
| C02 | Partly fixed | The last active Admin or CCM can't change role. Role changes are still not checked against future job slots. |
| C07 | Fixed | In PAYMENT_PENDING only Cost Control cancels, with a reason. |
| D01 | Fixed | A bill request can't be approved at Cost Control review without a bill. Above the threshold (setting, default ₹10,000, D-07), every request starts with the Admin. |
| D02 | Fixed | A resubmission that asks for more or changes the payee goes back to the entry stage. |
| D04, F01 | Fixed | Only the super admin may delete an order, and an order with invoices, installed stores, jobs (any status) or payment requests can't be deleted. Each refusal names the reason. |
| D05 | Fixed | The FY code is worked out in India time. |
| E01 | Fixed | Jobs, leave and overtime take a row lock before the read-check-write, so the second of two people gets "already decided". |
| F02 | Fixed | Invoice store claims and payment recording are conditional inside the transaction, and a lost race gets a 409. |
| F04 | Fixed | A requester can't remove their own files after the first approval. A reviewer must give a reason to remove someone else's file. |
| G04 | Mitigated | Above the threshold the Admin now sees bill-route requests too. Below it, one CCM still approves, pays and closes. |
| I02 | Open, and wider than recorded | There is still no CI. Also, the migration history can't be replayed from an empty database: `20260802010000_add_notification_order_link` alters `Notification`, which no migration creates, because it was made with `db push`. The test harness uses `prisma db push` plus `tests/api/db-extras.sql` (triggers, CHECK and EXCLUDE constraints copied from the migrations) until a baseline migration exists. |

All other mandatory items are in batches 2 and 3.
