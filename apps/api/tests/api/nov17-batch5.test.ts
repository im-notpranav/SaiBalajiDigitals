import { beforeAll, describe, expect, it } from "vitest";
import * as xlsx from "xlsx";
import { addMasters, as, makeUser, prisma, uniq } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let superAdmin: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  superAdmin = await makeUser("ADMIN", { is_super_admin: true });
  csm = await makeUser("CSM");
  await addMasters({ media: ["Flex"], locations: ["Hyderabad"] });
  const year_code = String(new Date().getFullYear() % 100).padStart(2, "0");
  await prisma.orderSequence.upsert({ where: { id: 1 }, update: {}, create: { id: 1, year_code, last_number: 12 } });
});

const book = (sheets: Record<string, unknown[][]>) => {
  const wb = xlsx.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows), name);
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
const upload = (u: { id: number; username: string; name: string; role: string }, url: string, file: Buffer) =>
  as(u).post(url).set("Content-Type", "application/octet-stream").send(file);
const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

describe("master library: company sheets", () => {
  it("reads the OMS Clients Data sheet, gives new clients an SBD code, and keeps the details", async () => {
    const a = uniq("Sheet Client A ");
    const b = uniq("Sheet Client B ");
    const file = book({
      "OMS Clients Data": [
        ["S.No", "Client Official Registered Name", "Short Name", "Contact Person", "Contact Number", "Mail ID", "CSM Name"],
        [1, a, "SCA", "Ravi", "9876543210", "ravi@example.com", "Teja"],
        [2, b, "", "", "", "", ""],
        [3, a, "dup", "", "", "", ""],
        [4, "", "", "", "", "", ""],
      ],
    });
    expect((await upload(admin, "/api/master-library/import/preview", file)).status).toBe(403);
    const preview = await upload(superAdmin, "/api/master-library/import/preview", file);
    expect(preview.status).toBe(200);
    const clients = preview.body.sheets.find((s: any) => s.kind === "CLIENT");
    expect(clients.found).toBe(true);
    expect(clients.add).toBe(2);
    expect(await prisma.client.count({ where: { name: a } })).toBe(0);

    const applied = await upload(superAdmin, "/api/master-library/import", file);
    expect(applied.status).toBe(200);
    const row = await prisma.client.findUniqueOrThrow({ where: { name: a } });
    expect(row.short_name).toBe("SCA");
    expect(row.contact_person).toBe("Ravi");
    expect(row.email).toBe("ravi@example.com");
    expect(row.code).toMatch(/^SBD\d{3,}$/);
    const other = await prisma.client.findUniqueOrThrow({ where: { name: b } });
    expect(other.code).toMatch(/^SBD\d{3,}$/);
    expect(other.code).not.toBe(row.code);
  });

  it("a client added by hand gets the next SBD code; only the super admin may add", async () => {
    const name = uniq("Hand Client ");
    expect((await as(admin).post("/api/master-library/clients").send({ name })).status).toBe(403);
    const res = await as(superAdmin).post("/api/master-library/clients").send({ name, contact_person: "Asha" });
    expect(res.status).toBe(201);
    const row = await prisma.client.findUniqueOrThrow({ where: { name } });
    expect(row.code).toMatch(/^SBD\d{3,}$/);
    expect(row.contact_person).toBe("Asha");
  });

  it("a CSM's client request carries full details into the approved client", async () => {
    const name = uniq("Asked Client ");
    const ask = await as(csm)
      .post("/api/master-library/requests")
      .send({ kind: "CLIENT", name, details: { contact_person: "Kiran", contact_number: "9000000001", email: "kiran@example.com", short_name: "AC" } });
    expect(ask.status).toBe(201);
    // Approving stays with any admin.
    const ok = await as(admin).post(`/api/master-library/requests/${ask.body.request.id}/approve`).send({ short_name: "ACL" });
    expect(ok.status).toBe(200);
    const row = await prisma.client.findUniqueOrThrow({ where: { name } });
    expect(row.contact_person).toBe("Kiran");
    expect(row.short_name).toBe("ACL");
    expect(row.code).toMatch(/^SBD\d{3,}$/);
  });
});

describe("users sheet", () => {
  it("adds and updates people; never exports passwords; super admin only", async () => {
    const newName = uniq("NEWOP").toUpperCase();
    const existing = await makeUser("PASTER");
    const before = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    const csmCode = `Z${Date.now().toString(36).slice(-5).toUpperCase()}`;
    const csmName = uniq("NEWCSM").toUpperCase();
    const file = book({
      "OMS User Template": [
        ["Emp Code", "Employee Name", "User Name", "Role Name", "Role Code (Optional)", "Mobile Number", "Email ID", "Password", "Machine"],
        ["Example: 101", "Ravi", "RAVI101", "Operator", "", "9876543210", "", "Change@123", "CNC"],
        ["", "New Operator", newName, "Production Team", "", "9876500001", "", "Secret#123", "Epson"],
        ["", "New CSM", csmName, "Client Service Manager", csmCode, "", "", "Secret#123", ""],
        ["", "Renamed", existing.username, "Oparation Manager", "", "", "", "", ""],
        ["", "No role", uniq("NOROLE").toUpperCase(), "", "", "", "", "Secret#123", ""],
        ["", "Bad role", uniq("BADROLE").toUpperCase(), "Astronaut", "", "", "", "Secret#123", ""],
      ],
    });
    expect((await upload(admin, "/api/users/import?preview=1", file)).status).toBe(403);
    const preview = await upload(superAdmin, "/api/users/import?preview=1", file);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ applied: false, add: 2, update: 1, error_count: 2 });
    expect(await prisma.user.count({ where: { username: newName } })).toBe(0);

    const applied = await upload(superAdmin, "/api/users/import", file);
    expect(applied.status).toBe(200);
    const op = await prisma.user.findUniqueOrThrow({ where: { username: newName }, include: { machine: true } });
    expect(op.role).toBe("PRODUCTION");
    expect(op.machine?.name).toBe("Epson");
    expect(op.phone).toBe("+919876500001");
    const newCsm = await prisma.user.findUniqueOrThrow({ where: { username: csmName }, include: { csmCodes: true } });
    expect(newCsm.csmCodes.map((c) => c.code)).toEqual([csmCode]);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.role).toBe("OPERATION_MANAGER");
    expect(after.name).toBe("Renamed");
    expect(after.password).toBe(before.password);

    const exported = await as(superAdmin).get("/api/users/export").buffer(true).parse(binary);
    expect(exported.status).toBe(200);
    const rows = xlsx.utils.sheet_to_json(xlsx.read(exported.body, { type: "buffer" }).Sheets["OMS User Template"]!, { header: 1 }) as unknown[][];
    const mine = rows.find((r) => r[2] === newName)!;
    expect(mine[3]).toBe("Operator");
    expect(mine[7] ?? "").toBe("");
    expect(mine[8]).toBe("Epson");
  });
});

describe("order-number blocks", () => {
  const orderBody = (client: string) => ({
    client_name: client,
    date: new Date().toISOString().slice(0, 10),
    stores: [{ store_name: "Main", location: "Hyderabad", items: [{ media: "Flex", width_inches: 12, height_inches: 12, qty: 1, rate: 10 }] }],
  });
  const oldOrder = async (client: string, daysAgo: number) =>
    prisma.order.create({
      data: { order_no: uniq("OLD"), client_name: client, date: new Date(Date.now() - daysAgo * 86400_000), creator_name: "x", status: "Active" },
    });

  it("an order open 90+ days blocks a CSM, not an admin; an exception allows one order", async () => {
    const client = uniq("Blocked Client ");
    await addMasters({ clients: [client] });
    const old = await oldOrder(client, 95);

    const check = await as(csm).get(`/api/order-blocks/check?client=${encodeURIComponent(client)}`);
    expect(check.body.blocked).toBe(true);
    expect(check.body.reasons[0]).toMatchObject({ kind: "PENDING_ORDER", order_no: old.order_no });

    const refused = await as(csm).post("/api/orders").send(orderBody(client));
    expect(refused.status).toBe(403);
    expect(refused.body.blocked).toBe(true);
    expect((await as(admin).post("/api/orders").send(orderBody(client))).status).toBe(201);

    const ask = await as(csm).post("/api/order-blocks/exceptions").send({ client_name: client, reason: "Urgent launch for the client" });
    expect(ask.status).toBe(201);
    expect((await as(csm).post("/api/order-blocks/exceptions").send({ client_name: client, reason: "Asking again" })).status).toBe(409);
    expect((await as(csm).post(`/api/order-blocks/exceptions/${ask.body.exception.id}/approve`).send({})).status).toBe(403);
    expect((await as(admin).post(`/api/order-blocks/exceptions/${ask.body.exception.id}/approve`).send({})).status).toBe(200);

    const allowed = await as(csm).post("/api/orders").send(orderBody(client));
    expect(allowed.status).toBe(201);
    const used = await prisma.orderBlockException.findUniqueOrThrow({ where: { id: ask.body.exception.id } });
    expect(used.used_order_id).toBe(allowed.body.id);
    expect((await as(csm).post("/api/orders").send(orderBody(client))).status).toBe(403);
  });

  it("an unpaid invoice past its days blocks; switching the block off or 0 days lets orders through", async () => {
    const client = uniq("Unpaid Client ");
    await addMasters({ clients: [client] });
    const old = await oldOrder(client, 10);
    await prisma.invoice.create({ data: { order_id: old.id, invoice_no: "INV-1", bill_amount: 100, billing_date: new Date(Date.now() - 130 * 86400_000) } });
    const check = await as(csm).get(`/api/order-blocks/check?client=${encodeURIComponent(client)}`);
    expect(check.body.reasons.map((r: any) => r.kind)).toEqual(["UNPAID_INVOICE"]);
    expect((await as(csm).post("/api/orders").send(orderBody(client))).status).toBe(403);

    const row = await prisma.client.findUniqueOrThrow({ where: { name: client } });
    expect((await as(csm).put(`/api/order-blocks/clients/${row.id}`).send({ payment_block_days: 0 })).status).toBe(403);
    expect((await as(admin).put(`/api/order-blocks/clients/${row.id}`).send({ payment_block_days: 200 })).status).toBe(200);
    expect((await as(csm).post("/api/orders").send(orderBody(client))).status).toBe(201);
    await as(admin).put(`/api/order-blocks/clients/${row.id}`).send({ payment_block_days: 120 });
    expect((await as(csm).post("/api/orders").send(orderBody(client))).status).toBe(403);
    await as(admin).put(`/api/order-blocks/clients/${row.id}`).send({ block_orders: false });
    expect((await as(csm).post("/api/orders").send(orderBody(client))).status).toBe(201);
  });

  it("a refused exception needs a reason", async () => {
    const client = uniq("Refused Client ");
    await addMasters({ clients: [client] });
    await oldOrder(client, 100);
    const ask = await as(csm).post("/api/order-blocks/exceptions").send({ client_name: client, reason: "Please allow this one" });
    expect((await as(admin).post(`/api/order-blocks/exceptions/${ask.body.exception.id}/reject`).send({})).status).toBe(400);
    expect((await as(admin).post(`/api/order-blocks/exceptions/${ask.body.exception.id}/reject`).send({ note: "Clear the old bill first" })).status).toBe(200);
    expect((await as(csm).post("/api/orders").send(orderBody(client))).status).toBe(403);
  });
});
