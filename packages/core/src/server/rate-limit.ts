// Simple in-memory rate limiter for serverless functions.
// Each Vercel instance has its own map — not shared across instances,
// but good enough to stop casual brute force. For production at scale,
// replace with Upstash Redis or Vercel KV.
//
// Limits:
//   login:  5 req/min per IP
//   writes: 30 req/min per user
//   bootstrap: 2 req/min per user

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const minute = 60_000;

function key(prefix: string, id: string): string {
  return `${prefix}:${id}`;
}

function check(key: string, max: number, windowMs: number): { ok: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;
  const remaining = Math.max(0, max - bucket.count);
  if (bucket.count > max) {
    return { ok: false, remaining: 0, resetIn: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, remaining, resetIn: Math.ceil((bucket.resetAt - now) / 1000) };
}

/** Clean up stale entries every 5 minutes — prevents memory leaks from
 *  abandoned buckets (brute force from rotating IPs, etc.). */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now > v.resetAt) buckets.delete(k);
  }
}, 300_000).unref();

/** Rate limit by IP. Max N requests per window (default 5/min). */
export function rateLimitByIp(
  req: Request,
  max = 5,
  windowMs = minute,
): { ok: boolean; remaining: number; resetIn: number } {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "127.0.0.1";
  return check(key("ip", ip), max, windowMs);
}

/** Rate limit by session user ID. Max N requests per window (default 30/min). */
export function rateLimitByUser(
  userId: string,
  max = 30,
  windowMs = minute,
): { ok: boolean; remaining: number; resetIn: number } {
  return check(key("user", userId), max, windowMs);
}

/** HTTP 429 response. */
export function rateLimitResponse(resetIn: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Try again shortly." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(resetIn),
        "X-RateLimit-Limit": "5",
        "X-RateLimit-Reset": String(Math.ceil(Date.now() / 1000) + resetIn),
      },
    },
  );
}
