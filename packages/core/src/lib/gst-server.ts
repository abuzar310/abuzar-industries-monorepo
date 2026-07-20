// Server-only GSTIN lookup. Proxies a third-party GST verification provider so
// the API key stays on the server (never shipped to the browser) and CORS is a
// non-issue. Default provider: Appyflow (https://appyflow.in/verify-gst).
//
// Swap providers by setting GST_API_PROVIDER + GST_API_KEY in the environment;
// only "appyflow" is wired today, but normalise*() keeps the client contract
// stable across providers.
import { GstInfo, GstLookup, cleanGstin, isValidGstinFormat, stateFromGstin } from "./gst";

const json = (body: GstLookup, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Flatten Appyflow's principal-address object into one line. */
function flattenAddr(addr: Record<string, unknown> | undefined): string | undefined {
  if (!addr) return undefined;
  const parts = ["bno", "flno", "bnm", "st", "loc", "city", "dst", "stcd", "pncd"]
    .map((k) => (typeof addr[k] === "string" ? (addr[k] as string).trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/** Map an Appyflow taxpayerInfo payload onto our normalised GstInfo. */
function normaliseAppyflow(gstin: string, tp: Record<string, unknown>): GstInfo {
  const status = typeof tp.sts === "string" ? tp.sts : undefined;
  const pradr = tp.pradr as { addr?: Record<string, unknown> } | undefined;
  return {
    gstin,
    legalName: typeof tp.lgnm === "string" ? tp.lgnm : undefined,
    tradeName: typeof tp.tradeNam === "string" ? tp.tradeNam : undefined,
    status,
    active: (status || "").toLowerCase() === "active",
    address: flattenAddr(pradr?.addr),
    taxpayerType: typeof tp.dty === "string" ? tp.dty : undefined,
    constitution: typeof tp.ctb === "string" ? tp.ctb : undefined,
    registrationDate: typeof tp.rgdt === "string" ? tp.rgdt : undefined,
    state: stateFromGstin(gstin),
  };
}

async function lookupAppyflow(gstin: string, key: string): Promise<GstLookup> {
  const url = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { "content-type": "application/json" } });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) return { ok: false, error: `Provider returned an unreadable response (${res.status}).` };
  // Appyflow signals failures with { error: true, message } (HTTP 200 or 4xx).
  if (data.error) {
    const msg = typeof data.message === "string" ? data.message : "GSTIN not found or invalid.";
    return { ok: false, error: msg };
  }
  const tp = data.taxpayerInfo as Record<string, unknown> | undefined;
  if (!tp) return { ok: false, error: "No taxpayer details returned for this GSTIN." };
  const info = normaliseAppyflow(gstin, tp);
  // Free/trial credits return a canned sample record (always the same taxpayer)
  // with a "sandbox" notice — flag it so the UI never presents it as real.
  const msg = typeof data.message === "string" ? data.message.toLowerCase() : "";
  if (msg.includes("sandbox") || msg.includes("free credit")) info.sandbox = true;
  return { ok: true, info };
}

/** Route handler body: GET /api/gst?gstin=XXXXXXXXXXXXXXX */
export async function handleGstLookup(req: Request): Promise<Response> {
  const gstin = cleanGstin(new URL(req.url).searchParams.get("gstin") || "");
  if (!isValidGstinFormat(gstin)) {
    return json({ ok: false, error: "Not a valid GSTIN (check the number)." }, 400);
  }

  const key = process.env.GST_API_KEY;
  if (!key) {
    return json(
      { ok: false, error: "GST lookup isn't configured — add GST_API_KEY to .env.local." },
      501,
    );
  }

  try {
    const provider = (process.env.GST_API_PROVIDER || "appyflow").toLowerCase();
    if (provider !== "appyflow") {
      return json({ ok: false, error: `Unsupported GST provider "${provider}".` }, 501);
    }
    return json(await lookupAppyflow(gstin, key));
  } catch {
    return json({ ok: false, error: "Lookup failed — the provider was unreachable." }, 502);
  }
}
