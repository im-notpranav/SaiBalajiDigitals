import { beforeAll, describe, expect, it } from "vitest";
import * as xlsx from "xlsx";
import { addMasters, as, makeUser, prisma, uniq } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
let csm: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  csm = await makeUser("CSM");
  await addMasters({ media: ["Flex", "Vinyl"], locations: ["Hyderabad"] });
  const year_code = String(new Date().getFullYear() % 100).padStart(2, "0");
  await prisma.orderSequence.upsert({ where: { id: 1 }, update: {}, create: { id: 1, year_code, last_number: 12 } });
});

/** A client of its own per test, so rate cards never cross between tests. */
async function freshClient() {
  const name = uniq("Rate Client ");
  await addMasters({ clients: [name] });
  return name;
}

const orderBody = (client: string, rate: number) => ({
  client_name: client,
  date: new Date().toISOString().slice(0, 10),
  stores: [{ store_name: "Main", location: "Hyderabad", items: [{ media: "Flex", width_inches: 120, height_inches: 120, qty: 1, rate }] }],
});

describe("rate cards", () => {
  it("an admin's rate goes live; a CSM's waits for approval", async () => {
    const client = await freshClient();
    const a = await as(admin).post("/api/rate-cards").send({ client_name: client, media: "Flex", rate: 12 });
    expect(a.status).toBe(201);
    expect(a.body.rate.status).toBe("ACTIVE");

    const c = await as(csm).post("/api/rate-cards").send({ client_name: client, media: "Vinyl", rate: 40 });
    expect(c.status).toBe(201);
    expect(c.body.rate.status).toBe("PENDING");
    expect((await as(csm).post("/api/rate-cards").send({ client_name: client, media: "Vinyl", rate: 41 })).status).toBe(409);

    let look = await as(csm).get(`/api/rate-cards/lookup?client=${encodeURIComponent(client)}`);
    expect(look.body.rates.map((r: any) => r.media)).toEqual(["Flex"]);

    expect((await as(csm).post(`/api/rate-cards/${c.body.rate.id}/approve`).send({})).status).toBe(403);
    const ok = await as(admin).post(`/api/rate-cards/${c.body.rate.id}/approve`).send({ rate: 38 });
    expect(ok.status).toBe(200);
    look = await as(csm).get(`/api/rate-cards/lookup?client=${encodeURIComponent(client)}`);
    expect(look.body.rates.find((r: any) => r.media === "Vinyl").rate).toBe(38);
  });

  it("a later dated rate does not price today's order", async () => {
    const client = await freshClient();
    await as(admin).post("/api/rate-cards").send({ client_name: client, media: "Flex", rate: 10, effective_from: "2026-01-01" });
    await as(admin).post("/api/rate-cards").send({ client_name: client, media: "Flex", rate: 15, effective_from: "2099-01-01" });
    const look = await as(csm).get(`/api/rate-cards/lookup?client=${encodeURIComponent(client)}&date=2026-11-22`);
    expect(look.body.rates[0].rate).toBe(10);
  });

  it("a CSM's other rate is billed at the card rate until the admin approves", async () => {
    const client = await freshClient();
    await as(admin).post("/api/rate-cards").send({ client_name: client, media: "Flex", rate: 10 });
    const res = await as(csm).post("/api/orders").send(orderBody(client, 12));
    expect(res.status).toBe(201);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { order_id: res.body.id } });
    expect(Number(line.rate)).toBe(10);
    expect(Number(line.rate_requested)).toBe(12);
    expect(Number(line.amount)).toBe(1000);

    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { order_id: res.body.id, kind: "RATE_CHANGE" } });
    expect(cr.summary).toMatch(/₹12 asked, card ₹10/);
    const ok = await as(admin).post(`/api/change-requests/${cr.id}/approve`).send({});
    expect(ok.status).toBe(200);
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(after.rate)).toBe(12);
    expect(after.rate_requested).toBeNull();
    expect(Number(after.amount)).toBe(1200);
  });

  it("rejecting keeps the card rate; the card rate itself needs no approval", async () => {
    const client = await freshClient();
    await as(admin).post("/api/rate-cards").send({ client_name: client, media: "Flex", rate: 10 });
    const same = await as(csm).post("/api/orders").send(orderBody(client, 10));
    expect(await prisma.changeRequest.count({ where: { order_id: same.body.id } })).toBe(0);

    const off = await as(csm).post("/api/orders").send(orderBody(client, 9));
    const cr = await prisma.changeRequest.findFirstOrThrow({ where: { order_id: off.body.id, kind: "RATE_CHANGE" } });
    expect((await as(admin).post(`/api/change-requests/${cr.id}/reject`).send({ note: "Card rate stands" })).status).toBe(200);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { order_id: off.body.id } });
    expect(Number(line.rate)).toBe(10);
    expect(line.rate_requested).toBeNull();
  });

  it("an admin's order keeps the typed rate", async () => {
    const client = await freshClient();
    await as(admin).post("/api/rate-cards").send({ client_name: client, media: "Flex", rate: 10 });
    const res = await as(admin).post("/api/orders").send(orderBody(client, 14));
    expect(res.status).toBeLessThan(300);
    const line = await prisma.orderItem.findFirstOrThrow({ where: { order_id: res.body.id } });
    expect(Number(line.rate)).toBe(14);
  });

  it("uploads a sheet: preview saves nothing, then rows are added or updated", async () => {
    const client = await freshClient();
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet([
        ["Client", "Line item", "Rate", "Effective from"],
        ["Example: Client name", "Line item name", 1, "2026-01-01"],
        [client, "Flex", 11, "2026-04-01"],
        [client, "Nope media", 5, ""],
        [client, "Vinyl", "abc", ""],
      ]),
      "Rate Card",
    );
    const file = xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const preview = await as(admin).post("/api/rate-cards/import?preview=1").set("Content-Type", "application/octet-stream").send(file);
    expect(preview.status).toBe(200);
    expect(preview.body.row_count).toBe(1);
    expect(preview.body.error_count).toBe(2);
    expect(await prisma.rateCard.count({ where: { client: { name: client } } })).toBe(0);

    const applied = await as(admin).post("/api/rate-cards/import").set("Content-Type", "application/octet-stream").send(file);
    expect(applied.body.added).toBe(1);
    const again = await as(admin).post("/api/rate-cards/import").set("Content-Type", "application/octet-stream").send(file);
    expect(again.body.added).toBe(0);
    expect(again.body.updated).toBe(0);
    expect((await as(csm).post("/api/rate-cards/import").set("Content-Type", "application/octet-stream").send(file)).status).toBe(403);

    const exported = await as(csm)
      .get(`/api/rate-cards/export?client=${encodeURIComponent(client)}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    const back = xlsx.read(exported.body, { type: "buffer" });
    const rows = xlsx.utils.sheet_to_json(back.Sheets["Rate Card"]!, { header: 1 }) as unknown[][];
    expect(rows[1]).toEqual([client, "Flex", 11, "2026-04-01"]);
  });
});
