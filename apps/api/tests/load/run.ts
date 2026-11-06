/**
 * Load test: 150 staff using the API at once, against a throwaway database.
 *
 *   npx tsx tests/load/run.ts [results.json]
 *
 * It creates `<dev db>_load`, fills it with 150 users and a year of orders, starts a copy of
 * the API on port 3101, measures, then stops the API and drops the database. Nothing touches
 * the dev database or the bucket. The API's CPU time is reported because the free hosting
 * allows 0.1 of a core, which is what decides whether this load fits.
 */
import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Client } from "pg";
import { config } from "dotenv";

const API_DIR = path.resolve(__dirname, "../..");
config({ path: path.join(API_DIR, ".env") });
const PORT = 3101;
const RESULT_FILE = process.argv[2];

const STAFF: [string, number][] = [
  ["ADMIN", 2], ["OPERATION_MANAGER", 3], ["CSM", 25], ["ACCOUNTS", 5], ["PRODUCTION", 20],
  ["PRODUCTION_MANAGER", 3], ["COST_CONTROL_MANAGER", 2], ["PASTER", 45], ["HELPER", 30], ["DRIVER", 15],
];
const ORDERS = 3000;
const PASSWORD = "load-test-only";

const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

/** What each role's pages ask for. One inner list is one page, whose requests go out together. */
const FIELD_PAGES = [["/api/my/work-jobs"], ["/api/payment-requests"], ["/api/my/leave"]];
const PAGES: Record<string, string[][]> = {
  ADMIN: [["/api/dashboard/admin"], ["/api/orders?section=active&limit=50&page=1"], ["/api/work-jobs/grid?days=7"], ["/api/payment-requests/dashboard"]],
  OPERATION_MANAGER: [[`/api/work-jobs/overview?from=${weekAgo}&to=${today}`], ["/api/work-jobs/grid?days=7"], ["/api/work-jobs/board"], ["/api/orders?section=active&limit=50&page=1"]],
  CSM: [["/api/dashboard/csm"], ["/api/orders?section=active&limit=50&page=1"], ["/api/orders?q=Client&limit=50&page=1"], ["/api/csm-jobs"], ["/api/payment-requests"]],
  ACCOUNTS: [["/api/dashboard/accountant"], ["/api/orders?section=active&limit=100"]],
  PRODUCTION: [["/api/orders?status=Active"], ["/api/orders?status=Active&limit=50", "/api/dashboard"]],
  PRODUCTION_MANAGER: [["/api/dashboard/prod-manager"], ["/api/orders?limit=100"]],
  COST_CONTROL_MANAGER: [["/api/payment-requests/dashboard"], ["/api/payment-requests"]],
  PASTER: FIELD_PAGES,
  HELPER: FIELD_PAGES,
  DRIVER: FIELD_PAGES,
};

const agent = new http.Agent({ keepAlive: true, maxSockets: 200 });

interface Reply { status: number; ms: number; bytes: number; cookie?: string }

/** One request, counting the bytes on the wire: this is what a phone has to download. */
function call(method: string, url: string, cookie?: string, body?: unknown): Promise<Reply> {
  return new Promise((resolve) => {
    const started = performance.now();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: url,
        method,
        agent,
        headers: {
          "Accept-Encoding": "gzip",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let bytes = 0;
        res.on("data", (c: Buffer) => (bytes += c.length));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, ms: performance.now() - started, bytes, cookie: res.headers["set-cookie"]?.[0]?.split(";")[0] }),
        );
      },
    );
    req.on("error", () => resolve({ status: 0, ms: performance.now() - started, bytes: 0 }));
    if (payload) req.write(payload);
    req.end();
  });
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (a: number, b: number) => a + Math.random() * (b - a);

/** The API process's CPU seconds and memory, from Windows. */
function processStats(pid: number) {
  const out = execSync(
    `powershell -NoProfile -Command "$p = Get-Process -Id ${pid}; '{0} {1}' -f $p.TotalProcessorTime.TotalSeconds, $p.WorkingSet64"`,
  ).toString().trim().replace(",", ".");
  const [cpu, mem] = out.split(/\s+/).map(Number);
  return { cpu: cpu!, mem: mem! };
}

async function seed(url: string) {
  const db = new Client({ connectionString: url });
  await db.connect();
  const fast = await bcrypt.hash(PASSWORD, 4);
  const real = await bcrypt.hash(PASSWORD, 12);
  try {
    let n = 0;
    for (const [role, count] of STAFF) {
      for (let i = 0; i < count; i++) {
        n += 1;
        // The first twenty carry the real hashing cost, for the login burst.
        await db.query(
          `INSERT INTO "User" (name, username, password, role, phone, is_super_admin, updated_at) VALUES ($1,$2,$3,$4::"Role",$5,$6,now())`,
          [`${role} ${i}`, `u${n}`, n <= 20 ? real : fast, role, `90000${String(n).padStart(5, "0")}`, role === "ADMIN"],
        );
      }
    }
    await db.query(`SELECT setseed(0.42)`);
    await db.query(`INSERT INTO "OrderSequence" (id, year_code, last_number) VALUES (1, '26', 50000)`);
    await db.query(`
      INSERT INTO "Order" (order_no, client_name, date, status, created_by, creator_name, created_at, updated_at)
      SELECT 'ORD26' || lpad(g::text, 4, '0'),
             'Client ' || (g % 60),
             now() - (g * interval '2.9 hours'),
             (CASE WHEN g <= ${ORDERS * 0.12} THEN 'Active' WHEN g <= ${ORDERS * 0.2} THEN 'Installed' WHEN g <= ${ORDERS * 0.3} THEN 'BillingCompleted' ELSE 'Completed' END)::"OrderStatus",
             c.id, c.name,
             now() - (g * interval '2.9 hours'), now()
      FROM generate_series(1, ${ORDERS}) g
      JOIN LATERAL (SELECT id, name FROM "User" WHERE role = 'CSM' ORDER BY id OFFSET g % 25 LIMIT 1) c ON true`);
    await db.query(`
      INSERT INTO "OrderStore" (order_id, s_no, store_name, location, updated_at)
      SELECT o.id, s, 'Store ' || (o.id % 90) || '-' || s, 'Area ' || (o.id % 30), now()
      FROM "Order" o, generate_series(1, 3) s`);
    await db.query(`
      INSERT INTO "OrderItem" (order_id, order_store_id, s_no, media, width_inches, height_inches, qty, total_sft, rate, amount)
      SELECT st.order_id, st.id, i, 'Vinyl', 48, 36, 2, 24, 40, 960
      FROM "OrderStore" st, generate_series(1, 3) i`);
    await db.query(`
      INSERT INTO "OrderItemAssignment" (order_item_id, user_id)
      SELECT it.id, p.id
      FROM "OrderItem" it
      JOIN "Order" o ON o.id = it.order_id AND o.status = 'Active'
      JOIN LATERAL (SELECT id FROM "User" WHERE role = 'PRODUCTION' ORDER BY id OFFSET it.id % 20 LIMIT 1) p ON true`);
    await db.query(`
      INSERT INTO "Notification" (user_id, title, body)
      SELECT u.id, 'Order update ' || g, 'Something happened on an order.' FROM "User" u, generate_series(1, 50) g`);

    // Fifteen crews a day, for the last two months and the next two weeks.
    await db.query(`
      CREATE TEMP TABLE crew AS
      SELECT row_number() OVER (ORDER BY id) - 1 AS k, id FROM "User" WHERE role = 'PASTER'`);
    await db.query(`
      CREATE TEMP TABLE drv AS
      SELECT row_number() OVER (ORDER BY id) - 1 AS k, id FROM "User" WHERE role = 'DRIVER'`);
    await db.query(`
      WITH made AS (
        INSERT INTO "WorkJob" (order_id, csm_user_id, start_date, end_date, locality, work_details, updated_at)
        SELECT (SELECT id FROM "Order" ORDER BY id OFFSET (d * 15 + k + 1500) % ${ORDERS} LIMIT 1),
               (SELECT id FROM "User" WHERE role = 'CSM' ORDER BY id OFFSET k % 25 LIMIT 1),
               current_date + d, current_date + d, (CASE WHEN k % 3 = 0 THEN 'NON_LOCAL' ELSE 'LOCAL' END)::"AreaLocality",
               'Pasting ' || k, now()
        FROM generate_series(-60, 14) d, generate_series(0, 14) k
        RETURNING id, start_date, work_details
      )
      INSERT INTO "WorkJobMember" (job_id, user_id, slot_role, start_date, end_date)
      SELECT m.id, c.id, 'PASTER'::"Role", m.start_date, m.start_date FROM made m
      JOIN crew c ON c.k = split_part(m.work_details, ' ', 2)::int
      UNION ALL
      SELECT m.id, dr.id, 'DRIVER'::"Role", m.start_date, m.start_date FROM made m
      JOIN drv dr ON dr.k = split_part(m.work_details, ' ', 2)::int`);
    await db.query(`
      INSERT INTO "PaymentRequest" (order_id, requested_by, amount, upi_id, purpose, bill_details_required, route, status, idempotency_key, updated_at)
      SELECT (SELECT id FROM "Order" ORDER BY id OFFSET g LIMIT 1),
             f.id, 500 + g % 4000, 'staff@upi', 'Materials', g % 2 = 0,
             (CASE WHEN g % 2 = 0 THEN 'CCM_ONLY' ELSE 'ADMIN_THEN_CCM' END)::"PaymentRoute",
             (CASE WHEN g % 10 < 2 THEN 'CCM_REVIEW' WHEN g % 10 < 3 THEN 'ADMIN_REVIEW' ELSE 'REJECTED' END)::"PaymentRequestStatus",
             'load-' || g, now()
      FROM generate_series(1, 1500) g
      JOIN LATERAL (SELECT id FROM "User" WHERE role IN ('PASTER','HELPER','DRIVER') ORDER BY id OFFSET g % 90 LIMIT 1) f ON true`);
    await db.query(`ANALYZE`);
  } finally {
    await db.end();
  }
}

interface Sample { path: string; status: number; ms: number; bytes: number }

/** Each person opens a page, reads it for a while, and opens another. */
async function runPhase(users: { role: string; cookie: string }[], seconds: number, thinkMs: [number, number]) {
  const samples: Sample[] = [];
  const stopAt = Date.now() + seconds * 1000;
  await Promise.all(
    users.map(async (u, i) => {
      await sleep(Math.random() * thinkMs[1]);
      const pages = PAGES[u.role]!;
      let step = i;
      while (Date.now() < stopAt) {
        step += 1;
        // Now and then a CSM saves an order, so the writes are in the mix too.
        if (u.role === "CSM" && Math.random() < 0.02) {
          const r = await call("POST", "/api/orders", u.cookie, {
            client_name: "Client 1",
            date: new Date().toISOString(),
            stores: [{ store_name: `New ${step}-${i}`, location: "Bajaj", items: [{ media: "Vinyl", width_inches: 48, height_inches: 36, qty: 2, rate: 40 }] }],
          });
          samples.push({ path: "POST /api/orders", status: r.status, ms: r.ms, bytes: r.bytes });
        } else {
          const page = pages[step % pages.length]!;
          await Promise.all(
            [...page, "/api/notifications"].map(async (p) => {
              const r = await call("GET", p, u.cookie);
              samples.push({ path: p.split("?")[0] + (p.includes("q=") ? "?q" : ""), status: r.status, ms: r.ms, bytes: r.bytes });
            }),
          );
        }
        await sleep(between(thinkMs[0], thinkMs[1]));
      }
    }),
  );
  return samples;
}

function summarize(samples: Sample[], seconds: number, stats: { cpu: number; memPeak: number }) {
  const all = samples.map((s) => s.ms).sort((a, b) => a - b);
  const byPath = new Map<string, Sample[]>();
  for (const s of samples) byPath.set(s.path, [...(byPath.get(s.path) ?? []), s]);
  const endpoints = [...byPath.entries()]
    .map(([p, list]) => {
      const ms = list.map((s) => s.ms).sort((a, b) => a - b);
      return {
        path: p,
        count: list.length,
        p50: Math.round(pct(ms, 0.5)),
        p95: Math.round(pct(ms, 0.95)),
        kb: Math.round(list.reduce((n, s) => n + s.bytes, 0) / list.length / 102.4) / 10,
        failed: list.filter((s) => s.status >= 400 || s.status === 0).length,
      };
    })
    .sort((a, b) => b.p95 - a.p95);
  return {
    requests: samples.length,
    per_second: Math.round((samples.length / seconds) * 10) / 10,
    p50_ms: Math.round(pct(all, 0.5)),
    p95_ms: Math.round(pct(all, 0.95)),
    p99_ms: Math.round(pct(all, 0.99)),
    failed: samples.filter((s) => s.status >= 400 || s.status === 0).length,
    cpu_core_share: Math.round((stats.cpu / seconds) * 1000) / 1000,
    cpu_ms_per_request: Math.round((stats.cpu * 1000 / samples.length) * 10) / 10,
    memory_peak_mb: Math.round(stats.memPeak / 1048576),
    endpoints,
  };
}

async function measured(pid: number, users: { role: string; cookie: string }[], seconds: number, think: [number, number]) {
  const before = processStats(pid);
  let memPeak = before.mem;
  const meter = setInterval(() => (memPeak = Math.max(memPeak, processStats(pid).mem)), 5000);
  const samples = await runPhase(users, seconds, think);
  clearInterval(meter);
  const after = processStats(pid);
  return summarize(samples, seconds, { cpu: after.cpu - before.cpu, memPeak: Math.max(memPeak, after.mem) });
}

async function main() {
  const base = new URL(process.env.DATABASE_URL!);
  base.search = "";
  const name = `${base.pathname.slice(1)}_load`;
  const server = new URL(base.toString());
  server.pathname = "/postgres";
  const loadUrl = new URL(base.toString());
  loadUrl.pathname = `/${name}`;

  const recreate = async (create: boolean) => {
    const pg = new Client({ connectionString: server.toString() });
    await pg.connect();
    await pg.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    if (create) await pg.query(`CREATE DATABASE "${name}"`);
    await pg.end();
  };

  await recreate(true);
  console.log("building the database");
  execSync("npx prisma db push --skip-generate --accept-data-loss", { cwd: API_DIR, env: { ...process.env, DATABASE_URL: loadUrl.toString() }, stdio: "pipe" });
  const extras = new Client({ connectionString: loadUrl.toString() });
  await extras.connect();
  await extras.query(readFileSync(path.join(API_DIR, "tests/api/db-extras.sql"), "utf8"));
  await extras.end();
  await seed(loadUrl.toString());

  // Five connections, as on the free database. NODE_ENV=test keeps uploads off the real bucket.
  const api = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: API_DIR,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "test", PORT: String(PORT), DATABASE_URL: `${loadUrl.toString()}?connection_limit=5`, SMTP_HOST: "", WHATSAPP_MODE: "log" },
  });

  try {
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const ok = await call("GET", "/health");
      if (ok.status === 200) break;
      if (i === 59) throw new Error("The API did not start.");
    }

    let n = 0;
    const accounts = STAFF.flatMap(([role, count]) => Array.from({ length: count }, () => ({ role, username: `u${++n}` })));

    // The morning rush: twenty people signing in together, with the real hashing cost.
    const burstCpu = processStats(api.pid!).cpu;
    const burstStart = performance.now();
    const burst = await Promise.all(accounts.slice(0, 20).map((a) => call("POST", "/api/auth/login", undefined, { username: a.username, password: PASSWORD })));
    const login_burst = {
      people: 20,
      slowest_ms: Math.round(Math.max(...burst.map((b) => b.ms))),
      wall_ms: Math.round(performance.now() - burstStart),
      cpu_seconds: Math.round((processStats(api.pid!).cpu - burstCpu) * 100) / 100,
      failed: burst.filter((b) => b.status !== 200).length,
    };
    console.log("login burst", login_burst);

    // Everyone else is already signed in. Their sessions are made here so the login limit, which
    // the burst above has just measured, does not decide who gets to take part.
    const users = accounts.map((a, i) => ({
      role: a.role,
      cookie: `token=${jwt.sign({ id: i + 1, username: a.username, name: a.username, role: a.role }, process.env.JWT_SECRET!, { expiresIn: "1h" })}`,
    }));

    console.log("warming up");
    await runPhase(users, 20, [2000, 6000]);
    console.log("normal day: 150 people, a page every 5-15 seconds, 120 seconds");
    const normal = await measured(api.pid!, users, 120, [5000, 15000]);
    console.log(JSON.stringify({ ...normal, endpoints: undefined }));
    console.log("busy moment: everyone clicking every 1-3 seconds, 45 seconds");
    const busy = await measured(api.pid!, users, 45, [1000, 3000]);
    console.log(JSON.stringify({ ...busy, endpoints: undefined }));

    const results = { login_burst, normal, busy };
    if (RESULT_FILE) writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2));
    console.table(normal.endpoints);
  } finally {
    api.kill();
    agent.destroy();
    await sleep(1500);
    await recreate(false);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
