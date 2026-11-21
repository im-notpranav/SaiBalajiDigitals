# Change list 2026-11-17: decided spec

Source: the user's 17/11/2026 note, their spoken list (2026-11-22), and five templates in Downloads:
OMS Clients Data, OMS Line Items Template, OMS Locations Template, OMS User Template, Bulk_Order_Request (2).
All questions were answered on 2026-11-22. Build runs on a new branch off `main`, in batches. The user tests
each batch. Nothing reaches `main` (production) until the user says so. Migrations are applied by hand on Neon.

## Answers given by the user

| Topic | Decision |
|---|---|
| Extra / Less Amount | Changes the whole order, never a line. Shows as its own line at the bottom of the order, e.g. "Less Amount −₹1,000 (reason)". Real lines stay untouched. |
| Which store carries it | CSM or admin picks the store on the request (default store 1; single-store orders skip the box). |
| CSM editing | The CSM may change anything. Essential changes wait for admin approval: rate/size/qty, adding or removing a line, client/store/location, media (line item name). Other fields save at once. |
| Feature name | **Request Change** on the order view; admin queue "Change Requests". Types: rate/size/qty change, Extra Amount, Less Amount, Under Warranty, Reprint, Sample, Free of Cost, Combine orders, Other. Reason required; amount required for money types. Admin approves, edits the figure, or rejects (reason). |
| Combine orders | Same client only. The second order's stores and lines move into the first. The second number is kept as "Merged into ORD26xxxx" and never reused. Blocked if either order is invoiced. |
| Order notes | Running thread: anyone on the order adds a note with name, role and time; everyone sees every note. Nobody edits another's note. The Notes button is green when notes exist, plain when empty. |
| Paster send-back | CSM reopens the same completed job: back to Assigned, same team, new date, reason required. Paster and OM notified. History kept. |
| Rate card key | Client + line item. |
| No rate card entry | Rate box stays empty; CSM types it. No standard rate. |
| CSM rate differs from card | Any change, higher or lower, waits for admin approval. |
| Rate validity | Effective-from date with history. An order uses the rate valid on its order date. CSM-created rate cards need admin approval; admin's go live at once. Excel upload/download per client. |
| Role rename | "Production Team" becomes **Operator** everywhere. |
| Machines | CNC, Epson, Solvent, UV Machine, Outward, Order Sheet are all machines (Master Library). Each line item has a default machine (from the template). |
| Operators per machine | One machine per operator; a machine may have many operators. A new line goes to every operator on its default machine; the first to start it takes it. The operator can reject it (reason) and it goes to the Production Manager. The PM can change machine and team at any time, also while running. |
| Pending-order block | An order of the client not **closed** N days after its order date (default 90) blocks new order numbers for that client. |
| Payment block | An invoice still unpaid N days after its **invoice date** (default 120) blocks new order numbers. |
| Block settings | In Masters, per client: switch each block on/off and change its days. |
| When blocked | The CSM sees which orders/invoices block. A "Request exception" button lets the admin allow one order. Admins can still create orders. |
| New client approved | Welcome email to the client's Mail ID with client code, CSM name and contact (WhatsApp too once AskEva is live). |
| Paster Hold / Cancelled / Rejected | Reason required for each. All three send the job to the OM, who decides the next step. CSM and OM notified. |
| OM pending dashboard | Pending orders grouped by CSM and Local/Non-local, with aging from the **order date**, oldest first. 0–5 days green, 6–10 orange, 11+ red. |
| Payment request | Order number becomes compulsory. |
| Clients master | "CSM Name" is the client's usual CSM: shown and filterable, but any CSM may still order for the client. |
| Masters editing | Only the **super admin** (NMG) edits masters (clients, line items, locations, machines) and users. Ordinary admins edit orders, rates and lines directly, and approve requests. |
| Client codes | Format SBD + 3 digits (SBD1000 after SBD999). Named rows keep their file code. Blank rows SBD355–SBD362 are ignored. "Havells India Ltd" kept once as SBD264. Every client gets a unique code; new clients get the next free number automatically. |
| User import | Existing username: update name, role, mobile, email, machine; password changes only if the cell is filled. Export never includes passwords. Super admin only. |
| CSM day sheet | Each day: auto-list of orders the CSM created or touched, plus rows he adds for other work (follow-up, visit, call) with client, note, time. Admin and OM can view. |
| Shipping | Batches on one branch; user tests each. |
| Admin "Delay" report | Stage-by-stage: time in production, installation, invoice and payment, flagged per stage against limits in Settings. |

## Defaults picked without asking (object if wrong)

- Toasts move to bottom-right, last 2.5 s, have a close button, and never cover the Sign out menu.
- "Add item" becomes **Add Line Item**. Order view/edit gets an Add Line Item shortcut (essential change, so it goes as a request for CSMs).
- Force close (and normal close) need a written remark, always. Revised, Extra Amount and Less Amount leave the close menu.
- Every pipeline/dashboard row opens its order on click (like the Orders table).
- OM pipeline rows get an "Assign work" shortcut that opens the new-job form with the order filled in.
- CSM name shows beside every order number. Where space is tight, the CSM code shows, with the full name on hover.
- CSM dashboard: old (past, completed) field jobs leave the dashboard; today and upcoming stay.
- Order create gets an optional order-level remark box.
- Paster day sheet: an optional note per day of the work done.
- CSM creation requests (client, line item, location) carry every template field. Client: name, short name, contact person, number, email. Line item: name, default machine. Location: name, Hyderabad/Non-local, district, state.
- OMS-WAS on the OM dashboard (no preference given): dense sheet-style rows (date, order, client, area, team, status) instead of cards.
- Production reports by date range: operator downloads only their own work; PM downloads all, or one operator. Columns: date, order no, CSM, client, store, line item, machine, size, qty, SFT, started, completed. Admin and super admin get the same printing report.
- Admin reports add CSM business (orders and value per CSM) and turnover by date range.
- Locations master gains a State column (template has it).
- The PM dashboard is redesigned: machine board (queue per machine and operator), today's flow, stuck/rejected lines, operator load, aging.

## Build batches

1. **Quick fixes**: labels, toasts, close remarks, clickable rows, CSM name everywhere, notes thread, optional order remark, Operator rename, payment request order compulsory, CSM dashboard old jobs.
2. **Request Change**: order-level Extra/Less line, essential-change approvals, request types, combine orders, paster send-back, paster Hold/Cancelled/Rejected.
3. **Rate card**: table, effective dates, CSM requests, Excel upload/download, auto-fill on order lines, approval on rate change.
4. **Machines and operators**: machine master, default machine per line item, operator machine, auto-queue, reject to PM, PM change machine/team, PM dashboard.
5. **Masters and templates**: new clients/line items/locations/users templates, SBD codes, import/export, CSM creation requests, welcome email, 90/120-day blocks.
6. **Dashboards and reports**: OM pending aging, assign shortcut, OMS-WAS rows, production reports, admin reports, paster and CSM day sheets.
