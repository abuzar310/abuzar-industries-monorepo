import { NextRequest, NextResponse } from "next/server";
import { pool, q, tableRef } from "@/server/db";

const TABLES = [
  "documents", "customers", "suppliers", "stock", "expenses", "sessions",
  "ledgers", "vouchers", "collections", "pay_holders", "workers", "attendance", "meta",
];

export async function POST(req: NextRequest) {
  try {
    // Basic auth: owner password check via existing session
    const cookie = req.cookies.get("session")?.value;
    if (!cookie) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

    // Verify they're owner via the bootstrap endpoint logic
    const { requireRole } = await import("@/server/api");
    // We'll just check session directly
    const { q: sql } = await import("@/server/db");

    // Actually, let's use the simplest approach — just check the user is owner
    const sessionRows = await sql<{ data: any }>(
      `select data from unofficial.sessions where id = $1 and deleted_at is null`,
      [cookie]
    );
    if (!sessionRows.length) return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    const user = sessionRows[0].data?.user;
    if (!user || user.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

    const schema = "unofficial";

    // Wipe every table
    for (const table of TABLES) {
      await q(`delete from ${tableRef(schema as any, table)}`);
    }

    // Reset counters
    await q(`delete from ${tableRef(schema as any, "counters")}`);

    return NextResponse.json({ ok: true, message: "All data wiped clean" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
