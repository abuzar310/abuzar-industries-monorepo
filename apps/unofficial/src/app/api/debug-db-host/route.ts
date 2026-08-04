import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.DATABASE_URL || "";
  return NextResponse.json({ 
    host: url ? new URL(url).hostname : "none",
    port: url ? new URL(url).port : "none",
    full: url.replace(/:[^:]+@/, ":****@") // redact password
  });
}
