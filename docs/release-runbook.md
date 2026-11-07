# Release runbook: November 2026 changes

Nothing here has been run against production. Each step changes the live site or its data, so
each needs a separate decision. Production is still on `feat/operator-billing-split` at `a297321`.

Pushing to that branch deploys immediately. Migrations do not run on deploy.

## 1. Back up production

Take a Neon backup or branch, and confirm it can be read, before anything else.

## 2. Apply the migrations

Use the Neon **direct** URL, not the `-pooler` one, from `apps/api`:

    npx prisma migrate deploy

First check that the history recorded in production matches its real schema. These migrations are
newer than what production runs:

    20261020000000_add_field_roles_and_masters
    20261021000000_add_work_jobs
    20261022000000_add_leave_and_overtime
    20261023000000_add_job_started_completed_by
    20261024000000_add_payment_requests
    20261025000000_add_payment_attachments
    20261026000000_add_whatsapp_messages
    20261027000000_add_whatsapp_link
    20261028000000_add_app_settings
    20261029000000_order_number_only
    20261030000000_leave_requests
    20261106000000_payment_reference_optional
    20261107000000_user_photo_key
    20261107010000_job_order_area_optional
    20261108000000_performance_indexes

## 3. Set the variables on Render

| Variable | Value | Why |
| --- | --- | --- |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from Cloudflare | Files and profile pictures. Without them, payment files go to the database and picture uploads are refused. |
| `R2_BUCKET` | `saibalajidigitals` | The bucket is shared with local work. |
| `R2_PREFIX` | `prod/` | The default in production. Local work uses `dev/`, so the two stay apart. |
| `DATABASE_URL` | the Neon pooled URL with `pgbouncer=true&connection_limit=5` | Keeps the API within the free database's connections. |
| `NODE_OPTIONS` | `--max-old-space-size=400` | Makes Node collect garbage before Render's 512 MB limit. Not yet tested. |

## 4. Deploy

Merge `feat/work-allocation-payments` into `feat/operator-billing-split`, keeping `wrangler.json` and
`worker/index.js`, which exist only there. Pushing deploys.

The Render build command should also gain `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`,
so this step cannot be forgotten again.

## 5. Wipe production's old data

Local was wiped on 2026-11-07 with these rules. Apply the same ones after looking at production's
own list of accounts, areas, vehicles and client names, since it differs from local:

- Empty: Order, OrderItem, OrderStore, Invoice, OrderItemAssignment, OrderChangeLog, Notification,
  PaymentFollowUp, EmailRecipient, WorkJob, WorkJobMember, WorkJobStore, LeaveRecord, OvertimeEntry,
  PaymentRequest, PaymentRequestEvent, PaymentAttachment, PaymentAttachmentBlob, WhatsAppMessage, AuditLog.
- Keep real staff and the masters. Delete test accounts and test rows from the masters.
- Set `OrderSequence` to `year_code = '26', last_number = 12`, so the next order is `ORD260013`. The
  Settings screen refuses a lower number, so this is done directly.
- Clear the bucket under `prod/` only, and keep any profile picture a kept user points to.

## 6. Keep the API awake in office hours

Render's free instance sleeps after about 15 idle minutes. A Cloudflare scheduled job on the existing
worker pings `/health`, which does not touch the database, so Neon can still sleep.

In `wrangler.json`, 8:00 to 21:00 India time written in UTC:

    "triggers": { "crons": ["30,40,50 2 * * *", "*/10 3-15 * * *"] }

In `worker/index.js`, beside `fetch`:

    async scheduled(_event, env, ctx) {
      ctx.waitUntil(fetch(`${env.API_ORIGIN}/health`));
    },

## 7. WhatsApp

The job templates were reworded for jobs with no order. They need AskEva approval before go-live.
Sending stays log-only until then.

## Load test results

`npx tsx tests/load/run.ts` from `apps/api`. Measured on the development PC on 2026-11-07, with local
Postgres, 150 users, 3,000 orders and five database connections. The run came before the accountant
dashboard and user cache changes, which are not measured yet.

| Scenario | Requests per second | Median | 95th percentile | Failed | CPU | Memory peak |
| --- | --- | --- | --- | --- | --- | --- |
| Everyone opens a page every 5-15 s | 30 | 12 ms | 237 ms | 0 of 3,605 | 0.75 core | 821 MB |
| Everyone clicks every 1-3 s | 92 | 641 ms | 3.6 s | 36 of 4,128 | 2.4 cores | 1,326 MB |

Twenty people signing in together took 9.9 s and 9.2 CPU seconds. Before the change to the login limit,
10 of those 20 were refused. That burst was at password cost 12. The cost is now 10, which should be about
four times cheaper but has not been measured. Production's existing passwords move to 10 at each person's
next login, so that first login after the release costs a little more than later ones.

Render's free tier gives 0.1 core and 512 MB. At about 25 ms of CPU per request, that is roughly
4 requests per second on this PC's speed. Treat these as limits to confirm, because Render's CPU differs,
Neon adds network time, and the memory figure includes the TypeScript runner. To test it properly, run
the compiled build with the memory cap above.
