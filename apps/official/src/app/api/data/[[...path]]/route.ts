// Official app (Abuzar Industries) — data API bound to the `official` schema.
import type { NextRequest } from "next/server";
import { createDataApi } from "@/server/api";

export const maxDuration = 60;

const api = createDataApi("official");

type Ctx = { params: Promise<{ path?: string[] }> };

export const GET = (req: NextRequest, ctx: Ctx) => api.request(req, ctx.params);
export const POST = (req: NextRequest, ctx: Ctx) => api.request(req, ctx.params);
export const PUT = (req: NextRequest, ctx: Ctx) => api.request(req, ctx.params);
export const DELETE = (req: NextRequest, ctx: Ctx) => api.request(req, ctx.params);
