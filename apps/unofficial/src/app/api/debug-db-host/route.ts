import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.DATABASE_URL || "";
  return NextResponse.json({ safa: url.replace(/:[^:]+@/, ":****@") });
}
