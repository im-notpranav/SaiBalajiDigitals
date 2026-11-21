import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import * as xlsx from "xlsx";
import { prisma } from "../utils/prisma";
import { indianMobile } from "../utils/validators";
import { linkCsmCode } from "./users.controller";
import { PASSWORD_HASH_ROUNDS } from "../utils/passwords";

/**
 * The staff sheet (OMS User Template): Emp Code, Employee Name, User Name, Role Name, Role
 * Code (Optional), Mobile Number, Email ID, Password, and Machine for operators. The super
 * admin uploads it to add people or update them. An existing username keeps its password unless
 * the Password cell is filled. The download never carries passwords.
 */

const HEADERS = ["Emp Code", "Employee Name", "User Name", "Role Name", "Role Code (Optional)", "Mobile Number", "Email ID", "Password", "Machine"];

const ROLE_LABEL: Record<string, string> = {
  ACCOUNTS: "Accountant",
  ADMIN: "Administrator",
  CSM: "Client Service Manager",
  COST_CONTROL_MANAGER: "Cost Control Manager",
  DRIVER: "Driver",
  HELPER: "Helper",
  OPERATION_MANAGER: "Operation Manager",
  PRODUCTION: "Operator",
  PASTER: "Paster",
  PRODUCTION_MANAGER: "Production Manager",
};

/** Role names as people write them, spelling slips included. */
const ROLE_WORDS: Record<string, string> = {
  accountant: "ACCOUNTS",
  accounts: "ACCOUNTS",
  admin: "ADMIN",
  administrator: "ADMIN",
  "client service manager": "CSM",
  csm: "CSM",
  "cost control manager": "COST_CONTROL_MANAGER",
  "cost control": "COST_CONTROL_MANAGER",
  driver: "DRIVER",
  helper: "HELPER",
  "sub paster": "HELPER",
  "sub-paster": "HELPER",
  "operation manager": "OPERATION_MANAGER",
  "operations manager": "OPERATION_MANAGER",
  "oparation manager": "OPERATION_MANAGER",
  "operational manager": "OPERATION_MANAGER",
  operator: "PRODUCTION",
  "production team": "PRODUCTION",
  production: "PRODUCTION",
  paster: "PASTER",
  "production manager": "PRODUCTION_MANAGER",
};

const COLS: Record<string, string[]> = {
  emp_code: ["emp code", "employee code", "emp. code"],
  name: ["employee name", "name"],
  username: ["user name", "username", "login"],
  role: ["role name", "role"],
  role_code: ["role code (optional)", "role code", "csm code"],
  phone: ["mobile number", "mobile", "phone", "phone number"],
  email: ["email id", "email", "mail id"],
  password: ["password"],
  machine: ["machine", "default machine"],
};

const cellText = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");

interface RowResult {
  row: number;
  username: string;
  name: string;
  action: "add" | "update" | "unchanged" | "error";
  detail: string;
}

/** GET /api/users/template — headings and one example row (skipped on upload). */
export const userTemplate = async (_req: Request, res: Response) => {
  const rows = [HEADERS, ["Example: 101", "Ravi Kumar", "RAVI101", "Operator", "", "9876543210", "ravi@example.com", "Change@123", "CNC"]];
  return sendBook(res, rows, "User_Template.xlsx");
};

/** GET /api/users/export — every active and inactive account, without passwords. */
export const exportUsers = async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { deleted_at: null },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        emp_code: true,
        name: true,
        username: true,
        role: true,
        phone: true,
        email: true,
        machine: { select: { name: true } },
        csmCodes: { where: { is_active: true }, select: { code: true } },
      },
    });
    const body = users.map((u) => [
      u.emp_code ?? "",
      u.name,
      u.username,
      ROLE_LABEL[u.role] ?? u.role,
      u.csmCodes.map((c) => c.code).join(", "),
      (u.phone ?? "").replace(/^\+91/, ""),
      u.email ?? "",
      "",
      u.machine?.name ?? "",
    ]);
    const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    return sendBook(res, [HEADERS, ...body], `Users_${day}.xlsx`);
  } catch (err) {
    console.error("exportUsers", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

function sendBook(res: Response, rows: unknown[][], filename: string) {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(rows);
  ws["!cols"] = [10, 26, 16, 24, 14, 14, 30, 14, 14].map((wch) => ({ wch }));
  xlsx.utils.book_append_sheet(wb, ws, "OMS User Template");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return res.send(xlsx.write(wb, { type: "buffer", bookType: "xlsx" }));
}

/**
 * POST /api/users/import[?preview=1] — adds new usernames and updates existing ones. Rows with
 * a problem are listed and skipped; the others are saved together.
 */
export const importUsers = async (req: Request, res: Response) => {
  try {
    const buf = req.body;
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ message: "No file received." });
    let rows: unknown[][];
    try {
      const wb = xlsx.read(buf, { type: "buffer", sheetRows: 2100, cellFormula: false, cellHTML: false });
      const sheet = wb.Sheets[wb.SheetNames[0]!]!;
      rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false });
    } catch {
      return res.status(400).json({ message: "Could not read that file. Upload the .xlsx user sheet." });
    }
    const headerAt = rows.slice(0, 10).findIndex((r) => r.some((c) => COLS.username!.includes(cellText(c).toLowerCase())));
    if (headerAt === -1) return res.status(400).json({ message: "The sheet needs a User Name column." });
    const heads = rows[headerAt]!.map((h) => cellText(h).toLowerCase());
    const at = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, heads.findIndex((h) => names.includes(h))])) as Record<string, number>;
    const data = rows.slice(headerAt + 1);
    if (data.length > 2000) return res.status(400).json({ message: "Up to 2,000 people at a time." });

    const [existing, machines] = await Promise.all([
      prisma.user.findMany({
        where: { deleted_at: null },
        select: { id: true, username: true, name: true, role: true, phone: true, email: true, emp_code: true, machine_id: true, is_super_admin: true },
      }),
      prisma.machine.findMany({ select: { id: true, name: true } }),
    ]);
    const byUsername = new Map(existing.map((u) => [u.username.toUpperCase(), u]));
    const byEmp = new Map(existing.filter((u) => u.emp_code).map((u) => [u.emp_code!.toUpperCase(), u]));
    const machineBy = new Map(machines.map((m) => [m.name.toLowerCase(), m]));
    const seen = new Set<string>();

    type Plan = { row: number; userId?: number; data: Record<string, unknown>; password?: string; csmCode?: string };
    const plans: Plan[] = [];
    const results: RowResult[] = [];

    data.forEach((r, i) => {
      const row = headerAt + i + 2;
      const get = (k: string) => (at[k]! >= 0 ? cellText(r[at[k]!]) : "");
      const username = get("username").toUpperCase();
      const name = get("name");
      if (!username && !name) return;
      if (get("emp_code").toLowerCase().startsWith("example") || name.toLowerCase().startsWith("example:")) return;
      const err = (detail: string) => results.push({ row, username, name, action: "error", detail });
      if (!/^[A-Z0-9_]{3,50}$/.test(username) || username.startsWith("DELETED_")) return err("User Name must be 3–50 letters, numbers or _.");
      if (seen.has(username)) return err("Same User Name is on an earlier row.");
      seen.add(username);

      const current = byUsername.get(username);
      const roleText = get("role").toLowerCase();
      const role = roleText ? ROLE_WORDS[roleText] : undefined;
      if (roleText && !role) return err(`Role "${get("role")}" is not known.`);
      const update: Record<string, unknown> = {};
      const notes: string[] = [];
      if (name && name !== current?.name) {
        update.name = name.slice(0, 100);
        if (current) notes.push(`name → ${name}`);
      }
      if (role && role !== current?.role) {
        if (current?.is_super_admin) return err("The super admin's role is not changed from a sheet.");
        update.role = role;
        notes.push(`role ${current ? `${ROLE_LABEL[current.role]} → ` : ""}${ROLE_LABEL[role]}`);
      }
      const phoneText = get("phone");
      if (phoneText) {
        const p = indianMobile.safeParse(phoneText);
        if (!p.success) return err("Mobile Number must be a 10-digit Indian mobile number.");
        if (p.data !== current?.phone) {
          update.phone = p.data;
          if (current) notes.push("mobile");
        }
      }
      const email = get("email").toLowerCase();
      if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Email ID is not a valid address.");
        if (email !== current?.email) {
          update.email = email;
          if (current) notes.push("email");
        }
      }
      const emp = get("emp_code");
      if (emp && emp.toUpperCase() !== (current?.emp_code ?? "").toUpperCase()) {
        const owner = byEmp.get(emp.toUpperCase());
        if (owner && owner.id !== current?.id) return err(`Emp Code ${emp} already belongs to ${owner.name}.`);
        update.emp_code = emp.slice(0, 20);
        if (current) notes.push(`emp code ${emp}`);
      }
      const machineText = get("machine");
      if (machineText) {
        const m = machineBy.get(machineText.toLowerCase());
        if (!m) return err(`Machine "${machineText}" is not in the machine list.`);
        if (m.id !== current?.machine_id) {
          update.machine_id = m.id;
          notes.push(`machine ${m.name}`);
        }
      }
      const password = get("password");
      if (password && password.length < 8) return err("Password must be at least 8 characters.");
      const roleCode = get("role_code").toUpperCase();
      const finalRole = (update.role as string | undefined) ?? current?.role;
      if (roleCode && !/^[A-Z0-9]{1,20}$/.test(roleCode)) return err("Role Code can only have letters and numbers.");

      if (!current) {
        if (!name) return err("Employee Name is needed for a new user.");
        if (!role) return err("Role Name is needed for a new user.");
        if (!password) return err("Password is needed for a new user.");
        if (role === "CSM" && !roleCode) return err("Role Code (the CSM code) is needed for a new CSM.");
        plans.push({ row, data: { ...update, username }, password, csmCode: role === "CSM" ? roleCode : undefined });
        results.push({ row, username, name, action: "add", detail: `${ROLE_LABEL[role]}${update.machine_id ? ` · ${machineText}` : ""}` });
        return;
      }
      if (password) notes.push("password");
      const csmCode = finalRole === "CSM" && roleCode ? roleCode : undefined;
      if (csmCode) notes.push(`CSM code ${csmCode}`);
      if (notes.length === 0) {
        results.push({ row, username, name: current.name, action: "unchanged", detail: "" });
        return;
      }
      plans.push({ row, userId: current.id, data: update, password: password || undefined, csmCode });
      results.push({ row, username, name: current.name, action: "update", detail: notes.join(" · ") });
    });

    const preview = req.query.preview === "1" || req.query.preview === "true";
    if (!preview && plans.length > 0) {
      // Hashed before the transaction: bcrypt is slow.
      const hashed = new Map<number, string>();
      for (const p of plans) if (p.password) hashed.set(p.row, await bcrypt.hash(p.password, PASSWORD_HASH_ROUNDS));
      const me = req.user!.id;
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${me.toString()}, true)`;
          for (const p of plans) {
            const pw = hashed.get(p.row);
            const id = p.userId
              ? (
                  await tx.user.update({
                    where: { id: p.userId },
                    data: { ...p.data, ...(pw ? { password: pw, password_changed_at: new Date() } : {}) } as any,
                    select: { id: true },
                  })
                ).id
              : (await tx.user.create({ data: { ...(p.data as any), password: pw! }, select: { id: true } })).id;
            if (p.csmCode) await linkCsmCode(tx, id, p.csmCode);
          }
        },
        { timeout: 120_000 },
      );
    }
    const count = (a: RowResult["action"]) => results.filter((r) => r.action === a).length;
    return res.json({
      applied: !preview,
      add: count("add"),
      update: count("update"),
      unchanged: count("unchanged"),
      error_count: count("error"),
      rows: results.filter((r) => r.action !== "unchanged").sort((a, b) => a.row - b.row).slice(0, 500),
    });
  } catch (err: any) {
    if (err?.status && err?.message) return res.status(err.status).json({ message: err.message });
    if (err?.code === "P2002") return res.status(409).json({ message: "A username, emp code or CSM code in the sheet is already taken." });
    console.error("importUsers", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
