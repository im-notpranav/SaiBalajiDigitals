# Sai Balaji Digitals — Order Management System

Internal order management system for **Sai Balaji Digitals**, a signage and printing company. Tracks orders from creation through production, billing, payment, and completion — with role-based dashboards, email notifications, TAT tracking, and Excel import/export.

Built for **50–60 employees** across 6 roles.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TanStack Router, TanStack Query, Tailwind CSS 4, shadcn/ui (Radix), Recharts |
| **Backend** | Express 4, Prisma ORM, PostgreSQL |
| **Auth** | JWT (httpOnly cookie), bcrypt (cost 12), role-based authorization |
| **Email** | Nodemailer 9 with branded HTML templates |
| **Monorepo** | npm workspaces (`apps/api`, `apps/web`, `packages/shared-types`) |

---

## Project Structure

```
sb-oms-monorepo/
├── apps/
│   ├── api/                    # Express + Prisma backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Database schema
│   │   │   ├── seed.ts         # Production seed (users)
│   │   │   └── seed-test-data.ts # Test data seeder (temporary)
│   │   └── src/
│   │       ├── server.ts       # Express app entry point
│   │       ├── controllers/    # Route handlers
│   │       ├── middlewares/    # Auth, rate limiting
│   │       ├── routes/         # API route definitions
│   │       ├── services/       # Email service
│   │       └── utils/          # Config, validators, helpers
│   └── web/                    # React frontend
│       └── src/
│           ├── api/            # API client functions
│           ├── components/     # Reusable UI components
│           ├── lib/            # Hooks and utilities
│           └── routes/         # File-based routing (TanStack)
├── packages/
│   └── shared-types/           # Shared TypeScript types
├── package.json                # Workspace root
└── .env.example                # Frontend env template
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** ≥ 14
- **npm** ≥ 9

### 1. Clone and install

```bash
git clone https://github.com/im-notpranav/SaiBalajiDigitals.git
cd SaiBalajiDigitals
npm install
```

### 2. Configure environment

Copy the example env file and fill in your values:

```bash
cp apps/api/.env.example apps/api/.env
```

**Required variables:**

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Random string, ≥ 32 characters. **Server will not start without this.** |

**Optional variables (defaults shown):**

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_EXPIRES_IN` | `7d` | Token expiry duration |
| `PORT` | `3001` | API server port |
| `NODE_ENV` | `development` | Environment mode |
| `CLIENT_URL` | `http://localhost:5173` | Frontend URL (CORS origin) |
| `SMTP_HOST` | — | SMTP server for email notifications |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `ADMIN_EMAIL` | `admin@saibalaji.com` | Admin notification recipient |

### 3. Set up the database

```bash
cd apps/api
npx prisma migrate dev
npx tsx prisma/seed.ts
```

### 4. Run development servers

From the project root:

```bash
npm run dev
```

This starts both servers concurrently:
- **API** → `http://localhost:3001`
- **Web** → `http://localhost:5173`

---

## User Roles

| Role | Portal | Capabilities |
|------|--------|-------------|
| **ADMIN** | `/admin` | Full access — orders, users, dashboards, audit log, settings, bulk import, force-close |
| **OPERATION_MANAGER** | `/admin` (read-only) | View everything, modify nothing — oversight role |
| **CSM** (Client Service Manager) | `/employee` | Create/edit orders, flag items, view own dashboard |
| **ACCOUNTS** | `/accountant` | Invoice reconciliation, payment recording, billing edits, follow-ups |
| **PRODUCTION_MANAGER** | `/prod-manager` | Assign production items to staff, view team workload |
| **PRODUCTION** | `/production` | View assigned items, mark production complete |

---

## Order Pipeline

```
Active → Installed → BillingCompleted / Pending → PaymentReceived → Completed
```

| Stage | Trigger | Who |
|-------|---------|-----|
| **Active** | Order created by CSM | CSM, Admin |
| **Installed** | CSM marks installation complete | CSM, Admin |
| **BillingCompleted** | Accountant submits invoice (amount matches) | Accounts, Admin |
| **Pending** | Invoice amount doesn't match order total | Accounts, Admin |
| **PaymentReceived** | Accountant records payment | Accounts, Admin |
| **Completed** | Admin closes the order with a remark | Admin |

Orders can also be **force-closed** by Admin at any stage with a reason (Reprint, Sample, Under Warranty, Free of Cost, etc.).

---

## Key Features

### Dashboards
- **Admin** — Pipeline overview, KPIs, revenue trends, CSM leaderboard, payment overdue tracking
- **CSM** — Personal pipeline by stage, date range filtering, amount/quantity toggle, drill-down tables
- **Production Manager** — Active orders, team workload cards, pending items with aging badges
- **Accountant** — Billing queue, payment queue, overdue (>30 days), collected amounts

### TAT (Turn-Around Time) Tracking
- Business days calculated excluding Sundays
- Per-stage aging with configurable thresholds
- Overdue report with Excel export

### Email Notifications
- Branded HTML email templates for all workflow events
- Order creation, edits, status transitions, flag alerts
- Billing/payment edit diffs sent to admin
- Invoice mismatch alerts

### Excel Features
- **Export** — Download or email filtered order data as `.xlsx`
- **Line-item import** — CSMs can import items from Excel into the order form
- **Bulk import** — Super-admin can import full orders from `.xlsx` (all-or-nothing validation)
- **Template downloads** — Pre-formatted templates for both import types

### Billing & Payments
- Invoice reconciliation with mismatch detection
- Billing and payment edit history with admin notifications
- Payment follow-up remarks timeline
- Financial year configuration (June 1 – May 31)

### Production Management
- Multi-team assignment per line item
- Production completion tracking per assignment
- Team workload visualization

### Audit & Compliance
- Database-level audit triggers (full before/after snapshots)
- Order change log with field-level diffs
- In-app notifications with bell icon and unread count

---

## API Endpoints

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | No | Login (rate limited: 10/15min) |
| POST | `/api/auth/logout` | Yes | Logout |
| GET | `/api/auth/me` | Yes | Current user info |

### Orders
| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/api/orders` | All | List orders (paginated, filterable) |
| GET | `/api/orders/:id` | All | Order detail |
| POST | `/api/orders` | CSM, Admin | Create order |
| PUT | `/api/orders/:id` | CSM, Admin | Update order |
| DELETE | `/api/orders/:id` | Admin | Delete order |
| PUT | `/api/orders/:id/install` | CSM, Admin | Mark installed |
| PUT | `/api/orders/:id/invoice` | Accounts, Admin | Submit invoice |
| PUT | `/api/orders/:id/payment` | Accounts, Admin | Record payment |
| PATCH | `/api/orders/:id/billing` | Accounts, Admin | Edit billing |
| PATCH | `/api/orders/:id/payment-edit` | Accounts, Admin | Edit payment |
| PUT | `/api/orders/:id/close` | Admin | Close order |
| PUT | `/api/orders/:id/force-close` | Admin | Force-close order |
| PATCH | `/api/orders/:orderId/items/:itemId/flag` | CSM, Admin | Flag line item |
| PATCH | `/api/orders/:orderId/items/:itemId/assign` | Prod Manager, Admin | Assign production |
| PATCH | `/api/orders/:orderId/items/:itemId/complete` | Production, Prod Manager, Admin | Mark complete |
| GET | `/api/orders/export` | CSM, Admin, OpMgr, Accounts | Download Excel |
| POST | `/api/orders/export/email` | CSM, Admin, OpMgr, Accounts | Email Excel (rate limited: 15/15min) |
| POST | `/api/orders/import` | Super-admin | Bulk import from Excel |

### Dashboards
| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/api/dashboard/admin` | Admin, OpMgr | Admin dashboard |
| GET | `/api/dashboard/csm` | CSM, Admin, OpMgr | CSM dashboard |
| GET | `/api/dashboard/prod-manager` | Prod Manager, Admin | Production dashboard |
| GET | `/api/dashboard/accountant` | Accounts, Admin | Accountant dashboard |

### Users
| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/api/users` | Admin, OpMgr | List all users |
| POST | `/api/users` | Super-admin | Create user |
| PUT | `/api/users/:id` | Super-admin | Update user |
| DELETE | `/api/users/:id` | Admin | Delete user |
| PUT | `/api/users/:id/status` | Admin | Activate/deactivate |
| PUT | `/api/users/:id/password` | Super-admin | Reset password |

---

## Database Schema

### Core Models

- **User** — Employees with roles, credentials, active status
- **Order** — Main order record with client, status, billing, payment fields
- **OrderItem** — Line items (media, dimensions, qty, rate, SFT, amount)
- **OrderItemAssignment** — Production assignment per item per team member
- **OrderChangeLog** — Field-level change tracking
- **AuditLog** — Database-trigger audit trail (full JSON snapshots)
- **PaymentFollowUp** — Remarks timeline after billing
- **Notification** — In-app notification bell
- **EmailRecipient** — Recently-used export email addresses (autocomplete)
- **Client / Media** — Lookup tables for autocomplete suggestions
- **OrderSequence** — Tracks order numbering per financial year

---

## Security

| Measure | Implementation |
|---------|---------------|
| **Authentication** | JWT in httpOnly cookie, `sameSite: strict`, `secure` in production |
| **Password hashing** | bcrypt with cost factor 12 |
| **Authorization** | Role-based middleware on every route, read-only enforcement for Operation Manager |
| **Rate limiting** | Global (200 req/min), login (10/15min), email export (15/15min) |
| **Input validation** | Zod schemas on all mutating endpoints with sanitized error responses |
| **SQL injection** | Prisma ORM with parameterized queries |
| **XSS** | React auto-escaping, no `dangerouslySetInnerHTML`, API returns JSON only |
| **CSRF** | `sameSite: strict` cookie policy |
| **Security headers** | Helmet middleware (X-Frame-Options, HSTS, CSP, etc.) |
| **Secrets** | All secrets via environment variables; server crashes at boot if `JWT_SECRET` is missing |
| **JWT re-validation** | Every request checks `is_active` and current `role` from the database |
| **Audit trail** | Database triggers record all changes with full before/after snapshots |

---

## Order Numbering

Orders follow the format `ORD{YY}{NNNN}` where:
- `YY` = 2-digit financial year code (FY starts June 1)
- `NNNN` = sequential number, starting from 13 each new FY (first 12 reserved)

Example: `ORD260013` = first order of FY 2026–27.

---

## Test Data

A test data seeder is included for development:

```bash
# Seed 16 test orders across all pipeline stages
cd apps/api
npx tsx prisma/seed-test-data.ts

# Remove all test data
npx tsx prisma/seed-test-data.ts --cleanup
```

Test orders use `TEST` prefix numbers (TEST0001–TEST0016) and `[TEST]` client name prefix for easy identification.

---

## Build for Production

```bash
# Build both apps
npm run build

# Start the API server
cd apps/api
node dist/server.js
```

The web app builds to `apps/web/dist/` — serve with any static file server (Nginx, Vercel, etc.).

---

## License

Private — internal use only.
