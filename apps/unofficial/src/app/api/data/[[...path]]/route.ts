// Unofficial app (Safa / Cut Size) — data API bound to the `unofficial` schema.
import type { NextRequest } from "next/server";
import { createDataApi } from "@/server/api";

const api = createDataApi("unofficial");

type Ctx = { params: Promise<{ path?: string[] }> };

export const GET = (req: NextRequest, ctx: Ctx) => api.request(req, ctx.params);
export const POST = (req: NextRequest, ctx: Ctx) => api.request(req, ctx.params);
export const PUT = (req: NextRequest, ctx: Ctx) => api.request(req, ctx.params);
export const DELETE = (req: NextRequest, ctx: Ctx) => api.request(req, ctx.params);
