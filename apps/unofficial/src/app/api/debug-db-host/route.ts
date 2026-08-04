import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.DATABASE_URL || "";
  try {
    const u = new URL(url);
    return NextResponse.json({ host: u.hostname });
  } catch {
    return NextResponse.json({ host: "parse-failed", raw: url.slice(0, 50) });
  }
}